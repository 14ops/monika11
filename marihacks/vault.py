"""
Obsidian vault indexer.

Reads every .md in a vault folder, chunks by heading, embeds into
Monika's memory. Optionally uses watchdog to live-reindex files on
change so the constellation stays in sync with the user's notes.

Chunk strategy:
  - Split on H1/H2 headings, keep heading as title metadata
  - If no headings, treat whole file as one chunk
  - Max ~1200 chars per chunk, hard cap so embeddings stay sane
  - Each chunk id = sha1(path + heading + slice_index)

Metadata per chunk:
  path:   relative vault path
  title:  heading text or filename
  kind:   "note"
  tags:   space-joined obsidian tags
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
from pathlib import Path
from typing import Iterable

from marihacks.events import BUS, make_event

logger = logging.getLogger(__name__)

HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)
TAG_RE = re.compile(r"(?<!\S)#([A-Za-z0-9_\-/]+)")
MAX_CHUNK_CHARS = 1200


def _stable_id(parts: Iterable[str]) -> str:
    joined = "\u0001".join(parts)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:20]


def _split_on_headings(text: str) -> list[tuple[str, str]]:
    """Return [(heading, body), ...]. Heading is '' if none present before text."""
    matches = list(HEADING_RE.finditer(text))
    if not matches:
        return [("", text.strip())]
    sections: list[tuple[str, str]] = []
    # Preamble before first heading (if any)
    first_start = matches[0].start()
    preamble = text[:first_start].strip()
    if preamble:
        sections.append(("", preamble))
    for i, m in enumerate(matches):
        heading = m.group(2).strip()
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end].strip()
        if body:
            sections.append((heading, body))
    return sections


def _hard_split(body: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Greedy char-budget splitter with paragraph awareness."""
    if len(body) <= max_chars:
        return [body]
    out: list[str] = []
    buf = ""
    for para in body.split("\n\n"):
        if len(buf) + len(para) + 2 <= max_chars:
            buf = (buf + "\n\n" + para).strip()
        else:
            if buf:
                out.append(buf)
            if len(para) <= max_chars:
                buf = para
            else:
                for i in range(0, len(para), max_chars):
                    out.append(para[i : i + max_chars])
                buf = ""
    if buf:
        out.append(buf)
    return out


class VaultIndexer:
    """
    Walk an Obsidian vault and feed chunks into the MemoryManager.

    Usage:
        idx = VaultIndexer(vault_path, memory)
        idx.full_reindex()
        idx.watch()   # blocks; call in a thread
    """

    def __init__(
        self,
        vault_path: str | Path,
        memory,
        exclude: tuple[str, ...] = (".obsidian", ".trash", "node_modules"),
    ):
        self.vault_path = Path(vault_path).expanduser().resolve()
        self.memory = memory
        self.exclude = exclude
        self._observer = None

    # --- public API ------------------------------------------------------

    def full_reindex(self) -> int:
        """Walk the vault once, reindex every markdown file. Returns chunk count."""
        if not self.vault_path.exists():
            logger.warning("Vault path does not exist: %s", self.vault_path)
            return 0
        total = 0
        start = time.time()
        for md_path in self._iter_markdown():
            total += self._index_file(md_path)
        dur = time.time() - start
        logger.info("Indexed %d chunks from %s in %.1fs", total, self.vault_path, dur)
        BUS.publish_sync(
            make_event(
                "vault_indexed",
                path=str(self.vault_path),
                chunks=total,
                duration_s=round(dur, 2),
            )
        )
        return total

    def watch(self) -> None:
        """Start a watchdog observer. Blocks; call from a daemon thread."""
        try:
            from watchdog.events import FileSystemEventHandler
            from watchdog.observers import Observer
        except ImportError:
            logger.warning("watchdog not installed; skipping live reindex")
            return

        idx = self

        class _Handler(FileSystemEventHandler):
            def on_created(self, event):
                self._handle(event, "created")

            def on_modified(self, event):
                self._handle(event, "modified")

            def on_deleted(self, event):
                if event.is_directory:
                    return
                path = Path(event.src_path)
                if path.suffix.lower() != ".md":
                    return
                rel = idx._rel(path)
                idx.memory.delete_notes_for_path(rel)
                BUS.publish_sync(make_event("vault_deleted", path=rel))

            def on_moved(self, event):
                if event.is_directory:
                    return
                src = Path(event.src_path)
                dest = Path(event.dest_path)
                if src.suffix.lower() == ".md":
                    idx.memory.delete_notes_for_path(idx._rel(src))
                if dest.suffix.lower() == ".md":
                    idx._index_file(dest)

            def _handle(self, event, kind: str):
                if event.is_directory:
                    return
                p = Path(event.src_path)
                if p.suffix.lower() != ".md":
                    return
                if idx._is_excluded(p):
                    return
                idx._index_file(p)

        self._observer = Observer()
        self._observer.schedule(_Handler(), str(self.vault_path), recursive=True)
        self._observer.start()
        logger.info("Watching vault: %s", self.vault_path)
        try:
            while True:
                time.sleep(1)
        finally:
            self._observer.stop()
            self._observer.join()

    # --- internals -------------------------------------------------------

    def _iter_markdown(self) -> Iterable[Path]:
        for p in self.vault_path.rglob("*.md"):
            if self._is_excluded(p):
                continue
            yield p

    def _is_excluded(self, path: Path) -> bool:
        try:
            rel_parts = path.relative_to(self.vault_path).parts
        except ValueError:
            return True
        return any(part in self.exclude for part in rel_parts)

    def _rel(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.vault_path)).replace("\\", "/")
        except ValueError:
            return str(path)

    def _index_file(self, path: Path) -> int:
        try:
            text = path.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning("read failed for %s: %s", path, e)
            return 0
        rel = self._rel(path)
        # Drop prior chunks for this file to avoid stale duplicates on edit.
        self.memory.delete_notes_for_path(rel)

        filename_title = path.stem
        tags = " ".join(sorted(set(TAG_RE.findall(text))))
        sections = _split_on_headings(text)
        count = 0
        for section_idx, (heading, body) in enumerate(sections):
            title = heading or filename_title
            for slice_idx, piece in enumerate(_hard_split(body)):
                if not piece.strip():
                    continue
                note_id = _stable_id([rel, heading, str(section_idx), str(slice_idx)])
                self.memory.upsert_note(
                    note_id=note_id,
                    title=title,
                    text=piece,
                    metadata={
                        "path": rel,
                        "heading": heading,
                        "filename": filename_title,
                        "tags": tags,
                        "section_idx": section_idx,
                        "slice_idx": slice_idx,
                    },
                )
                count += 1
        BUS.publish_sync(
            make_event("vault_upsert", path=rel, chunks=count)
        )
        return count
