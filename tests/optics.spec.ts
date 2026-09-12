import { test, expect } from "@playwright/test";
test("unity optical loop retains a source; lower gain fades and higher gain saturates", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  const result = await page.evaluate(async () => {
    const { OpticalEngine } = await import("/src/engine/renderer.ts" as string);
    const { PRESETS } = await import("/src/core/presets.ts" as string);
    const scene = PRESETS[0].make();
    scene.mode = "free";
    scene.simulation = {
      width: 128,
      height: 72,
      fps: 60,
      historyWidth: 128,
      memoryBudgetMB: 64,
    };
    scene.feed = true;
    for (const n of scene.graph.nodes) {
      if (n.kind === "screen")
        Object.assign(n.params, {
          brightness: 0,
          contrast: 1,
          hue: 0,
          saturation: 1,
          gamma: 1,
          black: 0,
          response: 0,
        });
      if (n.kind === "camera")
        Object.assign(n.params, {
          exposure: 0,
          focus: 0,
          sharpness: 0,
          gamma: 1,
          noise: 0,
          warmth: 0,
          shoulder: 0,
        });
      if (n.kind === "optics")
        Object.assign(n.params, {
          distance: 1,
          rotation: 0,
          x: 0,
          y: 0,
          reflection: 0,
          aberration: 0,
          perspective: 0,
        });
      if (n.kind === "mixer") n.params.mix = 1;
    }
    const engine = new OpticalEngine(document.createElement("canvas"), scene);
    const ctx = engine.sources.seedCanvas.getContext("2d")!;
    ctx.fillStyle = "rgb(64,128,192)";
    ctx.fillRect(0, 0, 1280, 720);
    engine.pulse = 0;
    engine.step();
    engine.scene.feed = false;
    const start = { ...engine.measure() };
    for (let i = 0; i < 180; i++) engine.step();
    const held = { ...engine.measure() };
    engine.scene.graph.nodes.find(
      (n: any) => n.kind === "camera",
    )!.params.exposure = -0.1;
    for (let i = 0; i < 100; i++) engine.step();
    const dark = { ...engine.measure() };
    engine.scene.graph.nodes.find(
      (n: any) => n.kind === "camera",
    )!.params.exposure = 0.3;
    for (let i = 0; i < 150; i++) engine.step();
    const bright = { ...engine.measure() };
    const error = engine.gpu.gl.getError();
    engine.dispose();
    return { start, held, dark, bright, error };
  });
  expect(Math.abs(result.start.mean - result.held.mean)).toBeLessThan(0.005);
  expect(result.dark.mean).toBeLessThan(result.held.mean * 0.05);
  expect(result.bright.mean).toBeGreaterThan(0.95);
  expect(result.error).toBe(0);
});
test("checkpoint round trip preserves history and visible image at a fixed boundary", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  const result = await page.evaluate(async () => {
    const s = (window as any).__feedback.studio;
    s.mode("free");
    const scene = structuredClone(s.state.scene);
    scene.simulation = {
      width: 256,
      height: 144,
      fps: 60,
      historyWidth: 128,
      memoryBudgetMB: 64,
    };
    s.commit(scene);
    s.engine.frozen = true;
    for (let i = 0; i < 60; i++) s.engine.step();
    const before = s.engine.preview(256),
      state = s.engine.state();
    const moment = await s.save();
    s.engine.reset();
    for (let i = 0; i < 3; i++) s.engine.step();
    await s.open(moment.id);
    return {
      equal: before === s.engine.preview(256),
      before: state,
      after: s.engine.state(),
      count: moment.buffers.length,
      error: s.state.error,
    };
  });
  expect(result.equal).toBe(true);
  expect(result.after).toEqual(result.before);
  expect(result.count).toBeGreaterThan(30);
  expect(result.error).toBe("");
});
test("balance probe is isolated, latched, and disabled in free mode", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  await page.waitForTimeout(2400);
  const r = await page.evaluate(async () => {
    const s = (window as any).__feedback.studio;
    s.engine.frozen = true;
    const before = s.engine.preview(256),
      frame = s.engine.frame;
    await s.balance();
    const baseline = structuredClone(s.state.scene.baseline),
      after = s.engine.preview(256);
    s.macro("turn", 0.4);
    s.macro("balance", 0.2);
    const held =
      JSON.stringify(s.state.scene.baseline) === JSON.stringify(baseline);
    s.mode("free");
    let error = "";
    try {
      await s.engine.findBalance();
    } catch (e) {
      error = (e as Error).message;
    }
    return { before, after, frame, now: s.engine.frame, held, error };
  });
  expect(r.before).toEqual(r.after);
  expect(r.frame).toBe(r.now);
  expect(r.held).toBe(true);
  expect(r.error).toContain("unassisted");
});

test("mirrored branches and coupled histories change the picture; coupled capture does not depend on node order", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback);
  const result = await page.evaluate(async () => {
    const { OpticalEngine } = await import("/src/engine/renderer.ts" as string),
      { PRESETS } = await import("/src/core/presets.ts" as string);
    const scene = PRESETS[2].make();
    scene.mode = "free";
    scene.modulations = [];
    scene.simulation = {
      width: 128,
      height: 72,
      historyWidth: 96,
      memoryBudgetMB: 64,
      fps: 60,
    };
    const a = new OpticalEngine(document.createElement("canvas"), scene);
    const reversed = structuredClone(scene);
    reversed.graph.nodes.reverse();
    const b = new OpticalEngine(document.createElement("canvas"), reversed);
    for (let i = 0; i < 60; i++) {
      a.step();
      b.step();
    }
    const same = a.preview(128) === b.preview(128);
    const before = a.preview(128);
    const modified = structuredClone(scene);
    for (const n of modified.graph.nodes)
      if (n.kind === "optics") n.params.reflection = 0;
    a.configure(modified);
    a.reset();
    for (let i = 0; i < 60; i++) a.step();
    const different = before !== a.preview(128);
    a.capture();
    for (const item of [...a.sources.items.keys()]) a.sources.remove(item);
    for (let i = 0; i < 10; i++) a.step();
    const continued = a.measure().variance > 0;
    a.dispose();
    b.dispose();
    return { same, different, continued };
  });
  expect(result).toEqual({ same: true, different: true, continued: true });
});

test("standard precision is identified and an over-budget 4K patch is bounded", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback);
  const result = await page.evaluate(async () => {
    const { OpticalEngine } = await import("/src/engine/renderer.ts" as string),
      { PRESETS } = await import("/src/core/presets.ts" as string);
    const original = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name: string) {
      return name === "EXT_color_buffer_float"
        ? null
        : original.call(this, name);
    };
    const scene = PRESETS[2].make();
    scene.simulation = {
      width: 3840,
      height: 2160,
      historyWidth: 1280,
      fps: 60,
      memoryBudgetMB: 64,
    };
    const e = new OpticalEngine(document.createElement("canvas"), scene);
    WebGL2RenderingContext.prototype.getExtension = original;
    e.step();
    const result = { ...e.metrics, error: e.gpu.gl.getError() };
    e.dispose();
    return result;
  });
  expect(result.precision).toBe("Standard precision");
  expect(result.memoryMB).toBeLessThanOrEqual(64);
  expect(result.width).toBeLessThan(3840);
  expect(result.historyWidth).toBeLessThan(1280);
  expect(result.error).toBe(0);
});
