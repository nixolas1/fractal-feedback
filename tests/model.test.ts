import { describe, expect, it } from "vitest";
import {
  applyBatch,
  clone,
  compileGraph,
  defaultMacros,
  interpolateAutomation,
  CommandSchema,
  validateScene,
} from "../src/core/model";
import { PRESETS } from "../src/core/presets";
describe("causal optical graph", () => {
  it("compiles every instrument with causal feedback routing", () => {
    const graphs = PRESETS.map((p) => {
      const s = p.make();
      validateScene(s);
      return s.graph;
    });
    expect(
      new Set(graphs.map((g) => JSON.stringify(g.nodes.map((n) => n.kind))))
        .size,
    ).toBeGreaterThanOrEqual(5);
    for (const g of graphs) expect(compileGraph(g).length).toBe(g.nodes.length);
  });
  it("rejects an instantaneous optical loop", () => {
    const graph = PRESETS[0].make().graph;
    graph.edges = graph.edges.filter(
      (e) => e.to !== "mix-a" || e.input !== "a",
    );
    graph.edges.push({ id: "bad", from: "camera-a", to: "mix-a", input: "a" });
    expect(() => compileGraph(graph)).toThrow(/instantaneous/);
  });
  it("accepts cross-coupled cameras only across memory", () => {
    const graph = PRESETS[2].make().graph;
    const order = compileGraph(graph);
    expect(order.filter((n) => n.kind === "history")).toHaveLength(2);
    for (const memory of order.filter((n) => n.kind === "history"))
      expect(order.indexOf(memory)).toBeLessThan(
        order.findIndex((n) => n.id === `camera-${memory.id.slice(-1)}`),
      );
  });
  it("rejects duplicate inputs and unknown parameter values", () => {
    const s = PRESETS[0].make();
    s.graph.edges.push({ ...s.graph.edges[0], id: "duplicate" });
    expect(() => validateScene(s)).toThrow(/one cable/);
    const scene = PRESETS[0].make();
    scene.graph.nodes.find((n) => n.kind === "camera")!.params.exposure =
      Infinity;
    expect(() => validateScene(scene)).toThrow();
  });
  it("validates an entire batch before applying any change", () => {
    const s = PRESETS[0].make(),
      before = clone(s);
    expect(() =>
      applyBatch(s, [
        { type: "macros", values: { turn: 0.7 } },
        { type: "parameter", node: "camera-a", key: "exposure", value: 100 },
      ]),
    ).toThrow();
    expect(s).toEqual(before);
  });
  it("interpolates a recorded gesture between samples and holds the last sample", () => {
    const points = [
      { time: 0, values: { ...defaultMacros } },
      { time: 2, values: { ...defaultMacros, turn: 1 } },
    ];
    expect(interpolateAutomation(points, 1)?.turn).toBe(0.5);
    expect(interpolateAutomation(points, 8)?.turn).toBe(1);
  });
  it("loads old scenes and gesture lanes with stationary motors and unchanged optical behavior", () => {
    const scene = PRESETS[1].make();
    const legacy = JSON.parse(JSON.stringify(scene));
    for (const key of [
      "contrast",
      "cameraSpin",
      "cameraBSpin",
      "screenSpin",
      "cameraDistance",
      "cameraBDistance",
    ])
      delete legacy.macros[key];
    for (const node of legacy.graph.nodes) {
      delete node.params.rotationSpeed;
      delete node.params.symmetry;
      delete node.params.reflectionBlend;
      delete node.params.screenDistance;
      if (node.kind === "screen") delete node.params.rotation;
    }
    legacy.automation.points = [{ time: 0, values: { ...legacy.macros } }];
    const loaded = validateScene(legacy);
    expect(loaded.macros).toEqual(defaultMacros);
    expect(loaded.automation.points[0].values).toEqual(defaultMacros);
    expect(
      loaded.graph.nodes.find((n) => n.kind === "optics")!.params,
    ).toMatchObject({
      rotationSpeed: 0,
      symmetry: 1,
      reflectionBlend: 0,
    });
    expect(legacy.macros).not.toHaveProperty("cameraSpin");
  });
  it("keeps partial control messages partial and validates each motor independently", () => {
    expect(
      CommandSchema.parse({ type: "macros", values: { turn: 0.2 } }),
    ).toEqual({
      type: "macros",
      values: { turn: 0.2 },
    });
    const scene = PRESETS.find((p) => p.id === "kaleidoscope")!.make();
    const next = applyBatch(scene, [
      {
        type: "macros",
        values: {
          contrast: 0.3,
          cameraSpin: 12,
          cameraBSpin: -8,
          screenSpin: 0,
        },
      },
    ]);
    expect(next.macros).toMatchObject({
      contrast: 0.3,
      cameraSpin: 12,
      cameraBSpin: -8,
      screenSpin: 0,
    });
    expect(() =>
      applyBatch(scene, [{ type: "macros", values: { cameraSpin: 31 } }]),
    ).toThrow();
  });
});
