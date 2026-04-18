# Memory Manager — Local RAG with ChromaDB
# ChromaDB is optional: install with pip install just-monika[memory]

try:
    from monika.memory.store import MemoryManager

    MEMORY_AVAILABLE = True
except ImportError:
    MEMORY_AVAILABLE = False
    MemoryManager = None  # type: ignore[assignment, misc]

__all__ = ["MemoryManager", "MEMORY_AVAILABLE"]
