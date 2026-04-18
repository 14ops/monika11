/**
 * Scene state for the constellation renderer.
 *
 * Each agent owns a named constellation: a cluster of stars with a
 * centroid the arcs connect to. The memory "galaxy" is a cluster of
 * tiny stars that flash when retrievals land. The user is one bright
 * star at the edge.
 */

export type AgentId =
  | "user"
  | "monika_persona"
  | "reasoning_validator"
  | "emotion_classifier"
  | "memory";

export interface Star {
  x: number;          // 0..1 normalized
  y: number;
  size: number;       // base radius in px (post-scale)
  baseTwinkle: number; // 0..1 noise seed
  pulse: number;       // 0..1, decays each frame
  color: string;       // hex
  label?: string;      // optional star label for memory hits
}

export interface Constellation {
  id: AgentId;
  name: string;
  color: string;
  stars: Star[];
  centroid: { x: number; y: number };
  pulse: number;       // 0..1, decays each frame
  lastActivity: number; // epoch ms
}

export interface Particle {
  fromId: AgentId;
  toId: AgentId;
  t: number;          // 0..1 progress along arc
  speed: number;      // progress per ms
  color: string;
  born: number;       // epoch ms
}

export interface Arc {
  fromId: AgentId;
  toId: AgentId;
  strength: number;   // 0..1, decays each frame
  color: string;
}

export interface SceneState {
  constellations: Record<AgentId, Constellation>;
  particles: Particle[];
  arcs: Arc[];
  memoryHits: Star[];  // transient stars in the memory galaxy
}

const palette: Record<AgentId, { name: string; color: string }> = {
  user: { name: "You", color: "#ffd27a" },
  monika_persona: { name: "Monika", color: "#6ef0c8" },
  reasoning_validator: { name: "Reasoning", color: "#7aa8ff" },
  emotion_classifier: { name: "Emotion", color: "#ff8aa8" },
  memory: { name: "Memory", color: "#c9a0ff" },
};

/**
 * Lay stars out in preset constellation shapes. Positions are normalized
 * so the canvas resize math stays trivial.
 */
const shapes: Record<AgentId, { cx: number; cy: number; points: [number, number][] }> = {
  monika_persona: {
    cx: 0.5,
    cy: 0.5,
    // Five-point centered cluster, faint halo of 3 extras
    points: [
      [0, 0],
      [-0.08, -0.06],
      [0.09, -0.04],
      [-0.05, 0.08],
      [0.06, 0.09],
      [-0.12, 0.02],
      [0.13, 0.03],
      [0.0, -0.11],
    ],
  },
  reasoning_validator: {
    cx: 0.22,
    cy: 0.32,
    // Orion-belt-ish: three in a line + a shoulder + foot
    points: [
      [-0.08, 0], [0, 0], [0.08, 0],
      [-0.1, -0.08], [0.1, -0.09],
      [-0.07, 0.1], [0.07, 0.09],
    ],
  },
  emotion_classifier: {
    cx: 0.78,
    cy: 0.3,
    // Cassiopeia-ish zigzag
    points: [
      [-0.1, 0.02], [-0.04, -0.05], [0.01, 0.02], [0.06, -0.05], [0.1, 0.02],
    ],
  },
  memory: {
    cx: 0.5,
    cy: 0.85,
    // Compact galaxy core + spiral hint
    points: [
      [0, 0], [-0.04, -0.02], [0.04, -0.02], [-0.02, 0.03], [0.02, 0.03],
      [-0.07, 0.01], [0.07, 0.01], [-0.09, 0.04], [0.09, 0.04],
    ],
  },
  user: {
    cx: 0.08,
    cy: 0.88,
    points: [[0, 0]],
  },
};

export function buildInitialScene(): SceneState {
  const constellations: Partial<Record<AgentId, Constellation>> = {};
  for (const id of Object.keys(palette) as AgentId[]) {
    const shape = shapes[id];
    const color = palette[id].color;
    const stars: Star[] = shape.points.map((p, i) => ({
      x: shape.cx + p[0],
      y: shape.cy + p[1],
      size: id === "user" ? 3.4 : 2.2 + (i % 3 === 0 ? 1.2 : 0),
      baseTwinkle: Math.random(),
      pulse: 0,
      color,
    }));
    constellations[id] = {
      id,
      name: palette[id].name,
      color,
      stars,
      centroid: { x: shape.cx, y: shape.cy },
      pulse: 0,
      lastActivity: 0,
    };
  }
  return {
    constellations: constellations as Record<AgentId, Constellation>,
    particles: [],
    arcs: [],
    memoryHits: [],
  };
}

export function colorFor(id: AgentId): string {
  return palette[id]?.color ?? "#ffffff";
}

export function nameFor(id: AgentId): string {
  return palette[id]?.name ?? String(id);
}

export function mapAgentId(raw: string | undefined): AgentId {
  switch (raw) {
    case "monika_persona":
    case "reasoning_validator":
    case "emotion_classifier":
    case "memory":
    case "user":
      return raw;
    default:
      return "monika_persona";
  }
}
