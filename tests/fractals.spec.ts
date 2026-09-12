import { test, expect } from "@playwright/test";

test("rotating fractal presets retain visible detail through a full camera revolution", async ({
  page,
}) => {
  await page.goto("/tests/harness/index.html");
  await page.waitForFunction(() => (window as any).harness);
  const results = await page.evaluate(async () => {
    const { PRESETS } = await import("/src/core/presets.ts" as string);
    const engine = (window as any).harness.engine;
    engine.frozen = true;
    const results = [];
    for (const id of ["kaleidoscope", "branches"]) {
      const scene = PRESETS.find((p: any) => p.id === id).make();
      scene.simulation = {
        width: 320,
        height: 180,
        historyWidth: 128,
        fps: 60,
        memoryBudgetMB: 64,
      };
      engine.configure(scene, true);
      const samples = [];
      let first = "";
      for (let i = 1; i <= 7200; i++) {
        engine.step();
        if (i % 120 === 0) samples.push({ ...engine.measure() });
        if (i === 120) first = engine.preview(320);
      }
      const moving = first !== engine.preview(320);
      engine.capture();
      engine.scene.macros.balance = -1;
      engine.scene.macros.contrast = -1;
      for (let i = 0; i < 240; i++) engine.step();
      const faded = engine.measure().mean;
      results.push({
        id,
        samples,
        moving,
        faded,
        error: engine.gpu.gl.getError(),
      });
    }
    return results;
  });
  for (const result of results) {
    for (const sample of result.samples) {
      expect(sample.mean, `${result.id} frame ${sample.frame}`).toBeGreaterThan(
        0.01,
      );
      expect(
        sample.variance,
        `${result.id} frame ${sample.frame}`,
      ).toBeGreaterThan(0.001);
      expect(sample.clipped).toBeLessThan(0.1);
    }
    expect(result.moving).toBe(true);
    expect(result.faded).toBeLessThan(0.002);
    expect(result.error).toBe(0);
  }
});

test("camera and screen motors integrate independently, stop without jumping, and restore their phases", async ({
  page,
}) => {
  await page.goto("/tests/harness/index.html");
  await page.waitForFunction(() => (window as any).harness);
  const result = await page.evaluate(async () => {
    const { PRESETS } = await import("/src/core/presets.ts" as string);
    const engine = (window as any).harness.engine;
    engine.frozen = true;
    const rotations = [];
    for (const fps of [24, 30, 60]) {
      const scene = PRESETS.find((p: any) => p.id === "kaleidoscope").make();
      scene.simulation = {
        width: 128,
        height: 72,
        historyWidth: 96,
        fps,
        memoryBudgetMB: 64,
      };
      scene.macros.cameraSpin = 12;
      scene.macros.cameraBSpin = -8;
      scene.macros.screenSpin = 5;
      engine.configure(scene, true);
      for (let i = 0; i < fps; i++) engine.step();
      const initial = engine.state();
      const buffers = [...engine.buffers()];
      engine.scene.macros.cameraBSpin = 0;
      for (let i = 0; i < fps; i++) engine.step();
      const stopped = engine.state();
      engine.scene.macros.cameraSpin = -12;
      for (let i = 0; i < fps; i++) engine.step();
      const reversed = engine.state();
      engine.configure(scene);
      engine.reset();
      for (const buffer of buffers) engine.restoreBuffer(buffer);
      engine.restoreState(initial);
      const restored = engine.state();
      rotations.push({ fps, initial, stopped, reversed, restored });
    }
    return rotations;
  });
  for (const row of result) {
    expect(row.initial.rotations["optics-a"]).toBeCloseTo(12, 7);
    expect(row.initial.rotations["optics-b"]).toBeCloseTo(-8, 7);
    expect(row.initial.rotations["upper-a"]).toBeCloseTo(5, 7);
    expect(row.initial.rotations["lower-b"]).toBeCloseTo(5, 7);
    expect(row.stopped.rotations["optics-a"]).toBeCloseTo(24, 7);
    expect(row.stopped.rotations["optics-b"]).toBeCloseTo(-8, 7);
    expect(row.reversed.rotations["optics-a"]).toBeCloseTo(12, 7);
    expect(row.reversed.rotations["upper-a"]).toBeCloseTo(15, 7);
    expect(row.restored).toEqual(row.initial);
  }
});

test("each motor and contrast change the rendered image with a still source", async ({
  page,
}) => {
  await page.goto("/tests/harness/index.html");
  await page.waitForFunction(() => (window as any).harness);
  const images = await page.evaluate(async () => {
    const { PRESETS } = await import("/src/core/presets.ts" as string);
    const engine = (window as any).harness.engine;
    engine.frozen = true;
    const images: Record<string, string> = {};
    for (const key of [
      "none",
      "cameraSpin",
      "cameraBSpin",
      "screenSpin",
      "contrast",
    ]) {
      const scene = PRESETS.find((p: any) => p.id === "kaleidoscope").make();
      scene.simulation = {
        width: 256,
        height: 144,
        historyWidth: 128,
        fps: 60,
        memoryBudgetMB: 64,
      };
      scene.macros.cameraSpin =
        scene.macros.cameraBSpin =
        scene.macros.screenSpin =
          0;
      if (key !== "none") scene.macros[key] = key === "contrast" ? -0.5 : 8;
      engine.configure(scene, true);
      for (let i = 0; i < 120; i++) engine.step();
      images[key] = engine.preview(256);
    }
    return images;
  });
  for (const key of ["cameraSpin", "cameraBSpin", "screenSpin", "contrast"])
    expect(images[key], key).not.toEqual(images.none);
});

test("main shelf exposes contrast and three motors, freezes them, and resumes source feeding", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  for (const name of ["Contrast", "Camera A", "Camera B", "Screen"])
    await expect(page.getByRole("slider", { name, exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Camera A value", exact: true })
    .fill("7");
  await page
    .getByRole("spinbutton", { name: "Camera A value", exact: true })
    .press("Enter");
  expect(
    await page.evaluate(
      () => (window as any).__feedback.studio.state.scene.macros.cameraSpin,
    ),
  ).toBe(7);
  await page.getByRole("button", { name: "Freeze", exact: true }).click();
  const before = await page.evaluate(() =>
    (window as any).__feedback.getEngine().state(),
  );
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => (window as any).__feedback.getEngine().state()),
  ).toEqual(before);
  await page
    .getByRole("button", { name: "Capture source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume source", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as any).__feedback.studio.state.scene.feed,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const name of ["Contrast", "Camera A", "Camera B", "Screen"])
    await expect(page.getByRole("slider", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: "tests/artifacts/fractals-mobile.png" });
});
