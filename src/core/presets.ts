import {
  NODE_SPECS,
  defaultMacros,
  type Graph,
  type GraphNode,
  type NodeKind,
  type Scene,
} from "./model";
export type Preset = {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  color: string;
  topology: string;
  autoBalance?: boolean;
  make: () => Scene;
};
function node(
  id: string,
  kind: NodeKind,
  label: string,
  x: number,
  y: number,
  params: Record<string, number> = {},
): GraphNode {
  return {
    id,
    kind,
    label,
    position: { x, y },
    params: {
      ...Object.fromEntries(
        Object.entries(NODE_SPECS[kind].params).map(([k, v]) => [k, v.default]),
      ),
      ...params,
    },
  };
}
const edge = (from: string, to: string, input: string) => ({
  id: `${from}-${to}-${input}`,
  from,
  to,
  input,
});
function assembly(suffix: string, folded: boolean, roll = 1.3): Graph {
  const s = suffix;
  const y = s === "b" ? 560 : 0;
  const nodes = [
    node(`history-${s}`, "history", `Memory ${s.toUpperCase()}`, 0, y),
    node(`mix-${s}`, "mixer", `Injection ${s.toUpperCase()}`, 240, y, {
      mix: 0.065,
    }),
    node(`upper-${s}`, "screen", `Upper screen ${s.toUpperCase()}`, 480, y, {
      brightness: 0,
      contrast: 1.012,
      hue: 0.18,
      saturation: 1.001,
    }),
    node(`optics-${s}`, "optics", `Glass + lens ${s.toUpperCase()}`, 760, y, {
      reflection: folded ? 0.49 : 0,
      rotation: roll,
      reflectionAngle: 0,
      reflectionScale: folded ? 0.97 : 1,
      distance: 1.013,
    }),
    node(`camera-${s}`, "camera", `Camera ${s.toUpperCase()}`, 1000, y, {
      exposure: 0,
      sharpness: 1.05,
      focus: 0.15,
      noise: 0,
    }),
  ];
  const edges = [
    edge(`history-${s}`, `mix-${s}`, "a"),
    edge("seed", `mix-${s}`, "b"),
    edge(`mix-${s}`, `upper-${s}`, "signal"),
    edge(`upper-${s}`, `optics-${s}`, "direct"),
    edge(`optics-${s}`, `camera-${s}`, "light"),
    edge(`camera-${s}`, `history-${s}`, "write"),
  ];
  if (folded) {
    nodes.push(
      node(
        `lower-${s}`,
        "screen",
        `Lower screen ${s.toUpperCase()}`,
        480,
        y + 210,
        { brightness: 0, contrast: 1.012, hue: -0.1, saturation: 1.001 },
      ),
    );
    edges.push(
      edge(`mix-${s}`, `lower-${s}`, "signal"),
      edge(`lower-${s}`, `optics-${s}`, "reflection"),
    );
  }
  return { nodes, edges };
}
function makePreset(id: string): Scene {
  const folded = [
    "fold",
    "mutual",
    "emulsion",
    "kaleidoscope",
    "branches",
  ].includes(id);
  const a = assembly("a", folded, id === "drift" ? 4.5 : 22.5);
  const graph: Graph = {
    nodes: [
      node("seed", "source", "Light source", 0, -230, {
        pattern:
          id === "captive" ? 2 : id === "time-loom" || id === "drift" ? 1 : 0,
      }),
      ...a.nodes,
    ],
    edges: [...a.edges],
  };
  let out = "camera-a";
  if (id === "drift") {
    Object.assign(graph.nodes.find((n) => n.id === "optics-a")!.params, {
      distance: 1.025,
      x: 0.006,
    });
    Object.assign(graph.nodes.find((n) => n.id === "camera-a")!.params, {
      sharpness: 0.3,
    });
    graph.nodes.find((n) => n.id === "mix-a")!.params.mix = 0.08;
  }

  if (id === "mutual" || id === "kaleidoscope") {
    const b = assembly("b", true, -17.5);
    graph.nodes.push(...b.nodes);
    graph.edges.push(...b.edges);
    graph.edges = graph.edges.filter(
      (e) => !(["lower-a", "lower-b"].includes(e.to) && e.input === "signal"),
    );
    graph.edges.push(
      edge("history-b", "lower-a", "signal"),
      edge("history-a", "lower-b", "signal"),
    );
    graph.nodes.push(
      node("duet", "mixer", "Camera mix", 1250, 200, { mix: 0.48 }),
    );
    graph.edges.push(
      edge("camera-a", "duet", "a"),
      edge("camera-b", "duet", "b"),
    );
    out = "duet";
  }
  if (id === "captive") {
    graph.nodes.find((n) => n.id === "optics-a")!.params = {
      ...graph.nodes.find((n) => n.id === "optics-a")!.params,
      distance: 1.0015,
      rotation: 1.8,
    };
    graph.nodes.find((n) => n.id === "mix-a")!.params.mix = 0.26;
    graph.nodes.find((n) => n.id === "upper-a")!.params.contrast = 1;
    Object.assign(graph.nodes.find((n) => n.id === "camera-a")!.params, {
      sharpness: 0,
      focus: 0.2,
    });
  }
  if (id === "time-loom") {
    graph.nodes.push(
      node("long-memory", "history", "Long exposure", 0, 300, { frames: 16 }),
      node("time-key", "key", "Temporal luma weave", 250, 300, {
        threshold: 0.12,
        softness: 0.22,
      }),
    );
    graph.edges.push(
      edge("camera-a", "long-memory", "write"),
      edge("long-memory", "time-key", "foreground"),
      edge("history-a", "time-key", "background"),
    );
    graph.edges = graph.edges.filter(
      (e) => !(e.to === "mix-a" && e.input === "a"),
    );
    graph.edges.push(edge("time-key", "mix-a", "a"));
    graph.nodes.find((n) => n.id === "history-a")!.params.frames = 5;
    Object.assign(graph.nodes.find((n) => n.id === "optics-a")!.params, {
      rotation: -0.7,
      x: 0.007,
      distance: 1.015,
    });
  }
  if (id === "emulsion") {
    graph.nodes.push(node("emulsion", "emulsion", "Living emulsion", 240, 320));
    graph.edges = graph.edges.filter(
      (e) => !(e.to === "mix-a" && e.input === "a"),
    );
    graph.edges.push(
      edge("history-a", "emulsion", "signal"),
      edge("seed", "emulsion", "seed"),
      edge("emulsion", "mix-a", "a"),
    );
    Object.assign(graph.nodes.find((n) => n.id === "optics-a")!.params, {
      reflection: 0.22,
      rotation: 0.1,
      distance: 1.002,
    });
  }
  if (id === "kaleidoscope" || id === "branches") {
    graph.nodes.find((n) => n.id === "seed")!.params.pattern =
      id === "branches" ? 5 : 4;
    for (const n of graph.nodes) {
      if (n.kind === "mixer" && n.id.startsWith("mix-"))
        Object.assign(n.params, { mode: 3, mix: 0.95 });
      if (n.kind === "screen")
        Object.assign(n.params, {
          contrast: 1.04,
          brightness: -0.06,
          response: 0,
          hue: n.id.startsWith("upper") ? 0.4 : -0.15,
          saturation: 1,
        });
      if (n.kind === "camera")
        Object.assign(n.params, {
          exposure: -0.04,
          focus: 0,
          sharpness: 0.7,
          noise: 0,
        });
      if (n.kind === "optics")
        Object.assign(
          n.params,
          id === "branches"
            ? {
                symmetry: 1,
                distance: 0.78,
                rotation: 30,
                reflectionScale: 1,
                x: 0.16,
                reflectionX: -0.44,
                reflectionAngle: 0,
                reflection: 0.5,
                reflectionBlend: 0.7,
                aberration: 0,
              }
            : {
                symmetry: 6,
                distance: n.id.endsWith("-b") ? 1.045 : 1.07,
                rotation: n.id.endsWith("-b") ? -3 : 2.2,
                reflectionScale: 0.88,
                reflectionX: 0.08,
                reflectionAngle: 25,
                reflection: 0.5,
                reflectionBlend: 0.7,
                aberration: 0,
              },
        );
    }
  }
  graph.nodes.push(node("output", "output", "Viewing monitor", 1500, 0));
  if (id === "kaleidoscope" || id === "branches")
    Object.assign(graph.nodes.find((n) => n.id === "output")!.params, {
      exposure: 0.25,
      gamma: 1,
    });
  graph.edges.push(edge(out, "output", "signal"));
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: PRESET_NAMES[id] || id,
    preset: id,
    mode: "visitor",
    graph,
    macros: {
      ...defaultMacros,
      ...(id === "kaleidoscope"
        ? { cameraSpin: 3, cameraBSpin: -2, screenSpin: 1 }
        : {}),
      ...(id === "branches" ? { cameraSpin: 0.6 } : {}),
    },
    baseline: {},
    linked: true,
    feed: true,
    source: "seed",
    seed: 74219,
    simulation: {
      width: 3840,
      height: 2160,
      fps: 60,
      autoCadence: true,
      historyWidth: 480,
      memoryBudgetMB: 1536,
    },
    modulations: [
      {
        id: "camera-motion",
        source: "motion",
        target: "distance",
        depth: 0.8,
        rate: 0.1,
        enabled: true,
      },
      {
        id: "sound-exposure",
        source: "audio",
        target: "balance",
        depth: 0.18,
        rate: 0.1,
        enabled: true,
      },
      {
        id: "sound-color",
        source: "treble",
        target: "color",
        depth: 0.15,
        rate: 0.1,
        enabled: true,
      },
      {
        id: "camera-color",
        source: "color",
        target: "color",
        depth: 0.4,
        rate: 0.1,
        enabled: true,
      },
      ...(["captive", "kaleidoscope", "branches"].includes(id)
        ? []
        : [
            {
              id: "slow-camera-drift",
              source: "sine" as const,
              target: "turn" as const,
              depth: 0.045,
              rate: 0.024,
              enabled: true,
            },
          ]),
    ],
    automation: { playing: false, loop: true, duration: 0, points: [] },
    assets: [],
  };
}
const PRESET_NAMES: Record<string, string> = {
  drift: "Drift",
  fold: "Fold",
  mutual: "Mutual",
  captive: "Captive",
  "time-loom": "Time loom",
  emulsion: "Emulsion",
  kaleidoscope: "Kaleidoscope",
  branches: "Branches",
};
export const PRESETS: Preset[] = [
  {
    id: "drift",
    name: "Drift",
    subtitle: "An image, returning",
    description:
      "A single camera looks into its own screen. Small movements become long, luminous echoes.",
    color: "#b1d4e8",
    topology: "One optical loop",
    make: () => makePreset("drift"),
  },
  {
    id: "fold",
    name: "Fold",
    subtitle: "Light meets its reflection",
    description:
      "Two screens meet in a sheet of glass. Each reflection branches into the next.",
    color: "#abd9be",
    topology: "Mirrored optical loop",
    make: () => makePreset("fold"),
  },
  {
    id: "mutual",
    name: "Mutual",
    subtitle: "Two worlds making each other",
    description:
      "Two camera assemblies exchange their images. A movement in one changes them both.",
    color: "#c6b3e5",
    topology: "Two coupled loops",
    make: () => makePreset("mutual"),
  },
  {
    id: "captive",
    name: "Captive",
    subtitle: "Keep something in the light",
    description:
      "Bring in an image. Capture it, disconnect the source, and see how long its memory lasts.",
    color: "#e0c9a9",
    topology: "Source capture + recursion",
    make: () => makePreset("captive"),
  },
  {
    id: "time-loom",
    name: "Time loom",
    subtitle: "Weave the passing moments",
    description:
      "Distant frames meet the present through a luma key. Motion becomes a material.",
    color: "#ddafc6",
    topology: "Keyed delay network",
    make: () => makePreset("time-loom"),
  },
  {
    id: "emulsion",
    name: "Emulsion",
    subtitle: "An image becoming liquid",
    description:
      "Light moves through an advecting image field, gathering into currents and dissolving again.",
    color: "#bfcba2",
    topology: "Optics + diffusion field",
    make: () => makePreset("emulsion"),
  },
  {
    id: "kaleidoscope",
    name: "Kaleidoscope",
    subtitle: "Two cameras. Turning mirrors. Endless detail.",
    description:
      "Six mirrored sectors and two independently rotating cameras build nested patterns. A continuous geometric source keeps the loop alive.",
    color: "#eacb86",
    topology: "Two rotating loops + six mirrors",
    autoBalance: false,
    make: () => makePreset("kaleidoscope"),
  },
  {
    id: "branches",
    name: "Branches",
    subtitle: "Each image makes two smaller worlds",
    description:
      "Two shrinking, mirrored copies make a branching fractal from a simple triangle seed. Keep the source flowing to sustain it, or capture to let it fade.",
    color: "#83decf",
    topology: "Contracting mirrored feedback",
    autoBalance: false,
    make: () => makePreset("branches"),
  },
];
export function newNode(kind: NodeKind, count: number) {
  return node(
    `${kind}-${crypto.randomUUID().slice(0, 8)}`,
    kind,
    NODE_SPECS[kind].label,
    200 + (count % 4) * 200,
    200 + Math.floor(count / 4) * 160,
  );
}
