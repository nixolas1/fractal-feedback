import { z } from "zod";

export const NodeKind = z.enum([
  "source",
  "mixer",
  "screen",
  "optics",
  "camera",
  "history",
  "key",
  "emulsion",
  "output",
]);
export type NodeKind = z.infer<typeof NodeKind>;
export type Parameter = {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
};
const p = (
  label: string,
  min: number,
  max: number,
  value: number,
  step = 0.01,
  unit?: string,
): Parameter => ({ label, min, max, step, default: value, unit });
export const NODE_SPECS: Record<
  NodeKind,
  {
    label: string;
    inputs: string[];
    stateful?: boolean;
    params: Record<string, Parameter>;
  }
> = {
  source: {
    label: "Source",
    inputs: [],
    params: {
      level: p("Level", 0, 2, 1),
      pattern: p("Seed pattern", 0, 5, 0, 1),
    },
  },
  mixer: {
    label: "Signal mixer",
    inputs: ["a", "b", "c"],
    params: {
      mix: p("Source injection", 0, 1, 0.12),
      cross: p("Third input", 0, 1, 0),
      mode: p("Mix / add / difference / brightest", 0, 3, 0, 1),
    },
  },
  screen: {
    label: "Screen",
    inputs: ["signal"],
    stateful: true,
    params: {
      brightness: p("Brightness", -0.2, 0.2, 0, 0.001),
      contrast: p("Contrast", 0.1, 3, 1, 0.001),
      hue: p("Hue", -180, 180, 0, 0.1, "°"),
      saturation: p("Saturation", 0, 3, 1),
      gamma: p("Display gamma", 1, 3, 2.2),
      black: p("Black level", 0, 0.08, 0, 0.0001),
      response: p("Temporal response", 0, 0.95, 0.08),
      rotation: p("Screen angle", -180, 180, 0, 0.1, "°"),
      rotationSpeed: p("Screen rotation speed", -60, 60, 0, 0.1, "°/s"),
    },
  },
  optics: {
    label: "Optical assembly",
    inputs: ["direct", "reflection"],
    params: {
      distance: p("Magnification", 0.75, 1.25, 1.012, 0.0001),
      rotation: p("Camera roll", -180, 180, 1.2, 0.01, "°"),
      rotationSpeed: p("Camera rotation speed", -60, 60, 0, 0.1, "°/s"),
      symmetry: p("Kaleidoscope mirrors", 1, 16, 1, 1),
      x: p("Horizontal position", -0.5, 0.5, 0, 0.001),
      y: p("Vertical position", -0.5, 0.5, 0, 0.001),
      reflection: p("Glass reflection", 0, 1, 0.5),
      reflectionBlend: p("Glass / lightest blend", 0, 1, 0),
      flipX: p("Reflect horizontally", 0, 1, 1, 1),
      flipY: p("Reflect vertically", 0, 1, 0, 1),
      perspective: p("Perspective", -0.65, 0.65, 0),
      reflectionAngle: p("Mirror angle", -180, 180, 60, 0.1, "°"),
      reflectionScale: p("Reflected magnification", 0.7, 1.3, 0.965, 0.001),
      reflectionX: p("Reflected horizontal position", -0.5, 0.5, 0, 0.001),
      reflectionY: p("Reflected vertical position", -0.5, 0.5, 0, 0.001),
      aberration: p("Lens dispersion", 0, 0.008, 0.00025, 0.00005),
    },
  },
  camera: {
    label: "Camera",
    inputs: ["light"],
    params: {
      exposure: p("Exposure", -3, 3, 0, 0.001, "EV"),
      focus: p("Defocus", 0, 3, 0.35),
      sharpness: p("Sensor sharpening", 0, 2, 0.45),
      gamma: p("Camera gamma", 1, 3, 2.2),
      noise: p("Sensor noise", 0, 0.03, 0.000002, 0.000001),
      warmth: p("White balance", -1, 1, 0),
      shoulder: p("Highlight roll-off", 0, 1, 0),
    },
  },
  history: {
    label: "Frame memory",
    inputs: ["write"],
    stateful: true,
    params: { frames: p("Additional delay", 0, 30, 0, 1, "f") },
  },
  key: {
    label: "Luma / chroma key",
    inputs: ["foreground", "background"],
    params: {
      mode: p("Luma / green / blue", 0, 2, 0, 1),
      threshold: p("Threshold", 0, 1, 0.3),
      softness: p("Softness", 0.001, 0.5, 0.1),
      invert: p("Invert", 0, 1, 0, 1),
    },
  },
  emulsion: {
    label: "Emulsion field",
    inputs: ["signal", "seed"],
    stateful: true,
    params: {
      flow: p("Advection", 0, 4, 1.1),
      diffusion: p("Diffusion", 0, 1, 0.18),
      feed: p("Image feed", 0, 0.2, 0.014),
      decay: p("Decay", 0.94, 1.04, 1.001, 0.0001),
    },
  },
  output: {
    label: "Output",
    inputs: ["signal"],
    params: {
      exposure: p("Viewing monitor exposure", -2, 3, 0.8, 0.01, "EV"),
      gamma: p("Viewing monitor gamma", 0.6, 2, 1.1),
    },
  },
};
export const GraphNodeSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .refine((id) => !["__proto__", "prototype", "constructor"].includes(id)),
    kind: NodeKind,
    label: z.string().max(100),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    params: z.record(z.number().finite()),
    sourceId: z.string().optional(),
  })
  .strict()
  // Version-one moments predate motor speeds and kaleidoscope mirrors.
  .transform((node) => ({
    ...node,
    params: {
      ...(node.kind === "screen" ? { rotation: 0, rotationSpeed: 0 } : {}),
      ...(node.kind === "optics"
        ? { rotationSpeed: 0, symmetry: 1, reflectionBlend: 0 }
        : {}),
      ...node.params,
    } as Record<string, number>,
  }));
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export const GraphEdgeSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    input: z.string(),
  })
  .strict();
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema).min(1).max(36),
  edges: z.array(GraphEdgeSchema).max(96),
});
export type Graph = z.infer<typeof GraphSchema>;
export const MacrosSchema = z.object({
  distance: z.number().min(-1).max(1),
  turn: z.number().min(-1).max(1),
  balance: z.number().min(-1).max(1),
  contrast: z.number().min(-1).max(1).default(0),
  color: z.number().min(-1).max(1),
  memory: z.number().min(0).max(1),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  cameraSpin: z.number().min(-30).max(30).default(0),
  cameraBSpin: z.number().min(-30).max(30).default(0),
  screenSpin: z.number().min(-30).max(30).default(0),
});
export type Macros = z.infer<typeof MacrosSchema>;
export type MacroKey = keyof Macros;
export type MacroControl = {
  key: MacroKey;
  label: string;
  min: number;
  max: number;
  hint: string;
  unit?: string;
  step?: number;
};
export const MACROS: MacroControl[] = [
  {
    key: "distance",
    label: "Distance",
    min: -1,
    max: 1,
    hint: "Move through the image",
  },
  {
    key: "turn",
    label: "Angle",
    min: -1,
    max: 1,
    hint: "Adjust the camera angle; use rotation speed for continuous motion",
  },
  {
    key: "contrast",
    label: "Contrast",
    min: -1,
    max: 1,
    hint: "Screen contrast inside the feedback loop; lower to fade, raise to sustain detail",
  },
  {
    key: "balance",
    label: "Balance",
    min: -1,
    max: 1,
    hint: "Exposure relative to the held reference",
  },
  {
    key: "color",
    label: "Color",
    min: -1,
    max: 1,
    hint: "Shift the screen hue",
  },
  {
    key: "memory",
    label: "Memory",
    min: 0,
    max: 1,
    hint: "Lengthen the feedback path",
  },
];
export const ROTATION_MACROS: MacroControl[] = [
  {
    key: "cameraSpin",
    label: "Camera A",
    min: -30,
    max: 30,
    step: 0.1,
    unit: "°/s",
    hint: "Continuous rotation of camera A; negative values reverse direction, zero stops the motor",
  },
  {
    key: "cameraBSpin",
    label: "Camera B",
    min: -30,
    max: 30,
    step: 0.1,
    unit: "°/s",
    hint: "Independent rotation of camera B in a two-camera instrument",
  },
  {
    key: "screenSpin",
    label: "Screen",
    min: -30,
    max: 30,
    step: 0.1,
    unit: "°/s",
    hint: "Rotate the screens independently of both cameras",
  },
];
export const MacroTargetSchema = z.enum([
  "distance",
  "turn",
  "balance",
  "contrast",
  "color",
  "memory",
  "x",
  "y",
  "cameraSpin",
  "cameraBSpin",
  "screenSpin",
]);
export const ModulationSchema = z.object({
  id: z.string(),
  target: MacroTargetSchema,
  source: z.enum([
    "sine",
    "triangle",
    "audio",
    "bass",
    "treble",
    "motion",
    "color",
    "roll",
    "tiltX",
    "tiltY",
  ]),
  depth: z.number().min(-1).max(1),
  rate: z.number().min(0.01).max(10),
  enabled: z.boolean(),
});
export type Modulation = z.infer<typeof ModulationSchema>;
export const AutomationSchema = z.object({
  playing: z.boolean(),
  loop: z.boolean(),
  duration: z.number().nonnegative(),
  points: z
    .array(z.object({ time: z.number().nonnegative(), values: MacrosSchema }))
    .max(36000),
});
export const SceneSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    name: z.string().max(120),
    preset: z.string(),
    mode: z.enum(["visitor", "free"]),
    graph: GraphSchema,
    macros: MacrosSchema,
    baseline: z.record(z.number().min(-3).max(3)),
    linked: z.boolean(),
    feed: z.boolean(),
    source: z.string(),
    seed: z.number().int(),
    simulation: z.object({
      width: z.number().int().min(64).max(3840),
      height: z.number().int().min(36).max(2160),
      fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
      historyWidth: z.number().int().min(64).max(1280),
      memoryBudgetMB: z.number().min(64).max(768),
    }),
    modulations: z.array(ModulationSchema).max(24),
    automation: AutomationSchema,
    assets: z.array(z.string()).max(64),
  })
  .strict();
export type Scene = z.infer<typeof SceneSchema>;
export const SensorSchema = z
  .object({
    tiltX: z.number().min(-1).max(1).optional(),
    tiltY: z.number().min(-1).max(1).optional(),
    roll: z.number().min(-1).max(1).optional(),
    audio: z.number().min(0).max(1).optional(),
    bass: z.number().min(0).max(1).optional(),
    treble: z.number().min(0).max(1).optional(),
    motion: z.number().min(0).max(1).optional(),
    color: z.number().min(-1).max(1).optional(),
  })
  .strict();
export type SensorSample = z.infer<typeof SensorSchema>;
export const CommandSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("macros"), values: MacrosSchema.partial() })
    .strict(),
  z
    .object({
      type: z.literal("parameter"),
      node: z.string(),
      key: z.string(),
      value: z.number().finite(),
    })
    .strict(),
  z.object({ type: z.literal("graph"), graph: GraphSchema }).strict(),
  z
    .object({ type: z.literal("mode"), mode: z.enum(["visitor", "free"]) })
    .strict(),
  z.object({ type: z.literal("feed"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("linked"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("modulations"),
      values: z.array(ModulationSchema).max(24),
    })
    .strict(),
]);
export type ControlCommand = z.infer<typeof CommandSchema>;
export const BatchSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  commands: z.array(CommandSchema).min(1).max(100),
});
export const defaultMacros: Macros = {
  distance: 0,
  turn: 0,
  balance: 0,
  contrast: 0,
  color: 0,
  memory: 0,
  x: 0,
  y: 0,
  cameraSpin: 0,
  cameraBSpin: 0,
  screenSpin: 0,
};
export const clone = <T>(value: T): T => structuredClone(value);

export function compileGraph(input: Graph): GraphNode[] {
  const graph = GraphSchema.parse(input);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  if (nodes.size !== graph.nodes.length)
    throw new Error("Node IDs must be unique.");
  if (graph.nodes.filter((n) => n.kind === "output").length !== 1)
    throw new Error("Connect exactly one output.");
  const sockets = new Set<string>();
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    const from = nodes.get(e.from),
      to = nodes.get(e.to);
    if (!from || !to) throw new Error("A cable refers to a missing node.");
    if (!NODE_SPECS[to.kind].inputs.includes(e.input))
      throw new Error(`Unknown input ${e.input}.`);
    if (from.kind === "output")
      throw new Error("Output cannot feed another node.");
    const key = `${e.to}/${e.input}`;
    if (sockets.has(key))
      throw new Error(
        "Each input accepts one cable. Use a mixer to combine signals.",
      );
    if (edgeIds.has(e.id)) throw new Error("Cable IDs must be unique.");
    sockets.add(key);
    edgeIds.add(e.id);
  }
  for (const n of graph.nodes) {
    for (const key of Object.keys(NODE_SPECS[n.kind].params))
      if (n.params[key] === undefined)
        throw new Error(`Missing ${n.label} parameter: ${key}.`);
    for (const [key, value] of Object.entries(n.params)) {
      const spec = NODE_SPECS[n.kind].params[key];
      if (!spec || value < spec.min || value > spec.max)
        throw new Error(`Invalid ${n.label} parameter: ${key}.`);
    }
  }
  const order: GraphNode[] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id))
      throw new Error(
        "This creates an instantaneous loop. Route through frame memory first.",
      );
    visiting.add(id);
    const n = nodes.get(id)!;
    if (n.kind !== "history")
      for (const e of graph.edges.filter((e) => e.to === id)) visit(e.from);
    visiting.delete(id);
    visited.add(id);
    order.push(n);
  }
  for (const n of graph.nodes) visit(n.id);
  return order;
}
export function validateScene(value: unknown): Scene {
  const scene = SceneSchema.parse(value);
  compileGraph(scene.graph);
  return scene;
}
export function applyBatch(scene: Scene, commands: ControlCommand[]): Scene {
  const next = clone(scene);
  for (const input of commands) {
    const c = CommandSchema.parse(input);
    if (c.type === "macros") Object.assign(next.macros, c.values);
    if (c.type === "parameter") {
      const node = next.graph.nodes.find((n) => n.id === c.node);
      if (!node) throw new Error("Node not found.");
      node.params[c.key] = c.value;
    }
    if (c.type === "graph") next.graph = c.graph;
    if (c.type === "mode") {
      if (c.mode === "free" && next.mode === "visitor") {
        for (const node of next.graph.nodes.filter((n) => n.kind === "camera"))
          node.params.exposure = Math.max(
            -3,
            Math.min(3, node.params.exposure + (next.baseline[node.id] ?? 0)),
          );
        next.baseline = {};
      }
      next.mode = c.mode;
    }
    if (c.type === "feed") next.feed = c.enabled;
    if (c.type === "linked") next.linked = c.enabled;
    if (c.type === "modulations") next.modulations = c.values;
  }
  return validateScene(next);
}
export function interpolateAutomation(
  points: Scene["automation"]["points"],
  time: number,
): Macros | null {
  if (!points.length) return null;
  if (time <= points[0].time) return { ...points[0].values };
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  const a = points[lo],
    b = points[Math.min(lo + 1, points.length - 1)];
  const t =
    b.time === a.time ? 0 : Math.min(1, (time - a.time) / (b.time - a.time));
  return Object.fromEntries(
    Object.keys(a.values).map((k) => [
      k,
      a.values[k as MacroKey] * (1 - t) + b.values[k as MacroKey] * t,
    ]),
  ) as Macros;
}
