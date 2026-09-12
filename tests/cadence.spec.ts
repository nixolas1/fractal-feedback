import { test, expect } from "@playwright/test";

test("sustained slow frames switch to 30 fps while preserving resolution, memory, and motor time", async ({
  page,
}) => {
  await page.goto("/tests/harness/index.html");
  await page.waitForFunction(() => (window as any).harness);
  const result = await page.evaluate(() => {
    const e = (window as any).harness.engine;
    e.frozen = false;
    cancelAnimationFrame(e.raf);
    const scene = structuredClone(e.scene);
    scene.simulation = {
      width: 128,
      height: 72,
      fps: 60,
      autoCadence: true,
      historyWidth: 96,
      memoryBudgetMB: 64,
    };
    scene.macros.cameraSpin = 12;
    e.configure(scene, true);
    const target = e.memory.get("camera-a").targets[0];
    const start = e.reportAt;
    for (let i = 1; i <= 160; i++) {
      e.tick(start + i * 25); // Simulate sustained delivery at only 40 Hz.
      cancelAnimationFrame(e.raf);
    }
    const fallback = e.state();
    const fps = e.metrics.targetFps;
    const width = e.canvas.width,
      height = e.canvas.height;
    const next = structuredClone(e.scene);
    next.simulation.autoCadence = false;
    next.simulation.fps = 30;
    e.configure(next);
    const preserved = e.state();
    for (let i = 0; i < 30; i++) e.step();
    const later = e.state();
    const sameMemory = target === e.memory.get("camera-a").targets[0];
    e.dispose();
    return { fallback, preserved, later, fps, width, height, sameMemory };
  });
  expect(result.fps).toBe(30);
  expect([result.width, result.height]).toEqual([128, 72]);
  expect(result.sameMemory).toBe(true);
  expect(result.preserved).toEqual(result.fallback);
  expect(result.later.time - result.preserved.time).toBeCloseTo(1, 8);
  expect(
    result.later.rotations["optics-a"] - result.preserved.rotations["optics-a"],
  ).toBeCloseTo(12, 7);
});
