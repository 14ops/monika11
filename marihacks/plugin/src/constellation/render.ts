/**
 * Canvas 2D renderer for the constellation scene.
 *
 * Draw order each frame:
 *   1. starfield background (procedural twinkle)
 *   2. constellation lines (faint links between own stars)
 *   3. arcs between constellations (glow proportional to strength)
 *   4. particles flowing along arcs
 *   5. agent stars (pulse amplified when active)
 *   6. memory galaxy hits (transient bright stars)
 *   7. labels
 */

import {
  Arc,
  AgentId,
  Constellation,
  Particle,
  SceneState,
  Star,
  colorFor,
} from "./scene";

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  scale: number;        // min(w,h)
  now: number;          // epoch ms
  dt: number;           // ms since last frame
}

const BACKDROP_STARS = 180;

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Deterministic backdrop stars so the field does not shimmer randomly.
let _backdrop: { x: number; y: number; s: number; seed: number }[] | null = null;
function backdrop(w: number, h: number): { x: number; y: number; s: number; seed: number }[] {
  if (_backdrop && _backdrop.length === BACKDROP_STARS) return _backdrop;
  const out = [];
  for (let i = 0; i < BACKDROP_STARS; i++) {
    out.push({
      x: Math.random(),
      y: Math.random(),
      s: 0.2 + Math.random() * 1.1,
      seed: Math.random() * Math.PI * 2,
    });
  }
  _backdrop = out;
  return out;
}

function drawBackdrop(r: RenderContext): void {
  const stars = backdrop(r.w, r.h);
  r.ctx.fillStyle = "#060918";
  r.ctx.fillRect(0, 0, r.w, r.h);
  for (const s of stars) {
    const twinkle = 0.4 + 0.35 * Math.sin(r.now * 0.001 + s.seed);
    r.ctx.fillStyle = `rgba(255,255,255,${twinkle * 0.6})`;
    r.ctx.beginPath();
    r.ctx.arc(s.x * r.w, s.y * r.h, s.s, 0, Math.PI * 2);
    r.ctx.fill();
  }
}

function drawConstellationLinks(r: RenderContext, c: Constellation): void {
  if (c.stars.length < 2) return;
  r.ctx.strokeStyle = hexToRgba(c.color, 0.18 + 0.25 * c.pulse);
  r.ctx.lineWidth = 0.6;
  r.ctx.beginPath();
  for (let i = 0; i < c.stars.length - 1; i++) {
    const a = c.stars[i];
    const b = c.stars[i + 1];
    r.ctx.moveTo(a.x * r.w, a.y * r.h);
    r.ctx.lineTo(b.x * r.w, b.y * r.h);
  }
  r.ctx.stroke();
}

function drawStar(r: RenderContext, s: Star, cPulse: number): void {
  const pulse = Math.max(s.pulse, cPulse);
  const size = s.size * (1 + pulse * 1.4);
  const alpha = 0.75 + 0.25 * pulse;
  const x = s.x * r.w;
  const y = s.y * r.h;

  // halo
  const grad = r.ctx.createRadialGradient(x, y, 0, x, y, size * 4);
  grad.addColorStop(0, hexToRgba(s.color, 0.9 * alpha));
  grad.addColorStop(1, hexToRgba(s.color, 0));
  r.ctx.fillStyle = grad;
  r.ctx.beginPath();
  r.ctx.arc(x, y, size * 4, 0, Math.PI * 2);
  r.ctx.fill();

  // core
  r.ctx.fillStyle = hexToRgba("#ffffff", alpha);
  r.ctx.beginPath();
  r.ctx.arc(x, y, size, 0, Math.PI * 2);
  r.ctx.fill();
}

function drawLabel(r: RenderContext, c: Constellation): void {
  r.ctx.fillStyle = hexToRgba(c.color, 0.75);
  r.ctx.font = "11px var(--font-ui-small, system-ui)";
  r.ctx.textAlign = "center";
  r.ctx.fillText(c.name, c.centroid.x * r.w, (c.centroid.y + 0.14) * r.h);
}

function bezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

function arcControl(
  p0: { x: number; y: number },
  p2: { x: number; y: number }
): { x: number; y: number } {
  const midX = (p0.x + p2.x) / 2;
  const midY = (p0.y + p2.y) / 2;
  const dx = p2.x - p0.x;
  const dy = p2.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  // perpendicular offset scaled by distance for a nice curve
  const nx = -dy / len;
  const ny = dx / len;
  return { x: midX + nx * 0.12, y: midY + ny * 0.12 };
}

function drawArc(r: RenderContext, scene: SceneState, arc: Arc): void {
  const from = scene.constellations[arc.fromId].centroid;
  const to = scene.constellations[arc.toId].centroid;
  const ctrl = arcControl(from, to);

  const alpha = 0.18 + 0.75 * arc.strength;
  r.ctx.strokeStyle = hexToRgba(arc.color, alpha);
  r.ctx.lineWidth = 1 + 2.5 * arc.strength;
  r.ctx.beginPath();
  r.ctx.moveTo(from.x * r.w, from.y * r.h);
  r.ctx.quadraticCurveTo(ctrl.x * r.w, ctrl.y * r.h, to.x * r.w, to.y * r.h);
  r.ctx.stroke();
}

function drawParticle(r: RenderContext, scene: SceneState, p: Particle): void {
  const from = scene.constellations[p.fromId].centroid;
  const to = scene.constellations[p.toId].centroid;
  const ctrl = arcControl(from, to);
  const pos = bezierPoint(p.t, from, ctrl, to);
  const x = pos.x * r.w;
  const y = pos.y * r.h;

  const grad = r.ctx.createRadialGradient(x, y, 0, x, y, 14);
  grad.addColorStop(0, hexToRgba(p.color, 0.9));
  grad.addColorStop(1, hexToRgba(p.color, 0));
  r.ctx.fillStyle = grad;
  r.ctx.beginPath();
  r.ctx.arc(x, y, 14, 0, Math.PI * 2);
  r.ctx.fill();

  r.ctx.fillStyle = "#ffffff";
  r.ctx.beginPath();
  r.ctx.arc(x, y, 2.1, 0, Math.PI * 2);
  r.ctx.fill();
}

function drawMemoryHit(r: RenderContext, s: Star): void {
  drawStar(r, s, s.pulse);
  if (s.label) {
    r.ctx.fillStyle = hexToRgba(s.color, 0.6 * s.pulse);
    r.ctx.font = "10px var(--font-ui-small, system-ui)";
    r.ctx.textAlign = "left";
    r.ctx.fillText(s.label, s.x * r.w + 6, s.y * r.h + 3);
  }
}

export function renderScene(r: RenderContext, scene: SceneState): void {
  drawBackdrop(r);
  for (const c of Object.values(scene.constellations)) {
    drawConstellationLinks(r, c);
  }
  for (const arc of scene.arcs) {
    drawArc(r, scene, arc);
  }
  for (const p of scene.particles) {
    drawParticle(r, scene, p);
  }
  for (const c of Object.values(scene.constellations)) {
    for (const s of c.stars) {
      drawStar(r, s, c.pulse);
    }
    drawLabel(r, c);
  }
  for (const hit of scene.memoryHits) {
    drawMemoryHit(r, hit);
  }
}

export function decayScene(scene: SceneState, dt: number): void {
  const decay = Math.exp(-dt / 600); // ~600ms pulse half-life
  for (const c of Object.values(scene.constellations)) {
    c.pulse *= decay;
    for (const s of c.stars) s.pulse *= decay;
  }
  for (const arc of scene.arcs) arc.strength *= decay;
  // drop fully faded arcs
  scene.arcs = scene.arcs.filter((a) => a.strength > 0.02);
  // advance particles
  for (const p of scene.particles) p.t += p.speed * dt;
  scene.particles = scene.particles.filter((p) => p.t <= 1.05);
  // fade memory hit stars
  for (const h of scene.memoryHits) h.pulse *= decay;
  scene.memoryHits = scene.memoryHits.filter((h) => h.pulse > 0.05);
}

export function pulseAgent(scene: SceneState, id: AgentId, amount = 1): void {
  const c = scene.constellations[id];
  if (!c) return;
  c.pulse = Math.min(1, c.pulse + amount);
  c.lastActivity = Date.now();
}

export function addArc(
  scene: SceneState,
  from: AgentId,
  to: AgentId,
  color?: string
): void {
  scene.arcs.push({
    fromId: from,
    toId: to,
    strength: 1,
    color: color ?? colorFor(to),
  });
  scene.particles.push({
    fromId: from,
    toId: to,
    t: 0,
    speed: 0.0012 + Math.random() * 0.0006, // ms^-1
    color: color ?? colorFor(to),
    born: Date.now(),
  });
}

export function addMemoryHit(scene: SceneState, title: string): void {
  const galaxy = scene.constellations.memory;
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.04 + Math.random() * 0.08;
  scene.memoryHits.push({
    x: galaxy.centroid.x + Math.cos(angle) * radius,
    y: galaxy.centroid.y + Math.sin(angle) * radius * 0.6,
    size: 2.0,
    baseTwinkle: Math.random(),
    pulse: 1,
    color: galaxy.color,
    label: title.length > 24 ? title.slice(0, 22) + "…" : title,
  });
  pulseAgent(scene, "memory", 0.7);
}
