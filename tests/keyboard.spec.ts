import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  await page.evaluate(() => {
    const studio = (window as any).__feedback.studio;
    const scene = structuredClone(studio.state.scene);
    scene.simulation = {
      width: 256,
      height: 144,
      historyWidth: 96,
      fps: 60,
      memoryBudgetMB: 64,
    };
    studio.commit(scene);
    studio.freeze();
  });
});

test("single keys select every performance slider and bracket keys reach panel sliders", async ({
  page,
}) => {
  const mappings = [
    ["1", "Linked distance"],
    ["2", "Angle"],
    ["3", "Contrast"],
    ["4", "Balance"],
    ["5", "Color"],
    ["6", "Memory"],
    ["7", "Camera A distance"],
    ["8", "Camera B distance"],
    ["9", "Camera A"],
    ["0", "Camera B"],
    ["-", "Screen"],
  ];
  for (const [key, name] of mappings) {
    const slider = page.getByRole("slider", { name, exact: true });
    const before = Number(await slider.inputValue());
    await page.keyboard.press(key);
    await page.keyboard.press(".", { delay: 60 });
    expect(Number(await slider.inputValue()), name).toBeGreaterThan(before);
    await page.keyboard.press("Home");
    expect(await slider.inputValue()).toBe(await slider.getAttribute("min"));
    await page.keyboard.press("End");
    expect(await slider.inputValue()).toBe(await slider.getAttribute("max"));
    await page.keyboard.press("Backspace");
    expect(Number(await slider.inputValue())).toBe(
      name.includes("distance") && name.startsWith("Camera") ? 1 : 0,
    );
  }
  await page.keyboard.press("i");
  await page.keyboard.press("-");
  await page.keyboard.press("]");
  const contrast = page.getByRole("slider", {
    name: "Injection contrast",
    exact: true,
  });
  await page.keyboard.press(".", { delay: 60 });
  expect(Number(await contrast.inputValue())).toBeGreaterThan(1);
  await page.keyboard.press("Backspace");
  await expect(contrast).toHaveValue("1");
  await page.keyboard.press("]");
  const size = page.getByRole("slider", { name: "Type size", exact: true });
  await page.keyboard.press(".", { delay: 60 });
  expect(Number(await size.inputValue())).toBeGreaterThan(86);
  expect(Number.isInteger(Number(await size.inputValue()))).toBe(true);
  await page.keyboard.press("]");
  const tracking = page.getByRole("slider", {
    name: "Letter spacing",
    exact: true,
  });
  await page.keyboard.press(".", { delay: 60 });
  expect(Number(await tracking.inputValue())).toBeGreaterThan(0);
  await page.keyboard.press("[");
  await page.keyboard.press("Backspace");
  await expect(size).toHaveValue("86");
  await page
    .getByLabel("Text source", { exact: true })
    .fill("wasd p r i h space");
  await expect(page.getByLabel("Text source", { exact: true })).toHaveValue(
    "wasd p r i h space",
  );
  expect(
    await page.evaluate(
      () => (window as any).__feedback.studio.state.recording,
    ),
  ).toBe(false);
  await page
    .getByLabel("Injection contrast value", { exact: true })
    .fill("2.5");
  await page
    .getByLabel("Injection contrast value", { exact: true })
    .press("Enter");
  await expect(contrast).toHaveValue("2.5");
  await page.keyboard.press("Escape");
  await page.keyboard.press("h");
  await expect(
    page.getByRole("heading", { name: "Play from the keyboard" }),
  ).toBeVisible();
});

test("WASD and arrows move separate cameras; focused controls and browser chords keep their keys", async ({
  page,
}) => {
  const positions = () =>
    page.evaluate(() =>
      (window as any).__feedback.studio.state.scene.graph.nodes
        .filter((n: any) => n.kind === "optics")
        .map((n: any) => ({ id: n.id, x: n.params.x, y: n.params.y })),
    );
  const before = await positions();
  await page.keyboard.press("d", { delay: 60 });
  await page.keyboard.press("w", { delay: 60 });
  const a = await positions();
  expect(a[0].x).toBeGreaterThan(before[0].x);
  expect(a[0].y).toBeLessThan(before[0].y);
  expect(a[1]).toEqual(before[1]);
  await page.keyboard.press("ArrowRight", { delay: 60 });
  await page.keyboard.press("ArrowDown", { delay: 60 });
  const b = await positions();
  expect(b[0]).toEqual(a[0]);
  expect(b[1].x).toBeGreaterThan(before[1].x);
  expect(b[1].y).toBeGreaterThan(before[1].y);
  await page.keyboard.press("Control+d");
  expect(await positions()).toEqual(b);
  const slider = page.getByRole("slider", { name: "Angle", exact: true });
  await slider.focus();
  await page.keyboard.press("ArrowRight", { delay: 60 });
  expect(Number(await slider.inputValue())).toBeGreaterThan(0);
  expect(await positions()).toEqual(b);
  await page.locator(".art-canvas").dispatchEvent("pointerdown");
  await page.keyboard.press("p");
  expect(
    await page.evaluate(() => (window as any).__feedback.studio.state.frozen),
  ).toBe(false);
  await page.keyboard.down("p");
  await page.keyboard.down("p");
  await page.keyboard.up("p");
  expect(
    await page.evaluate(() => (window as any).__feedback.studio.state.frozen),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "tests/artifacts/keyboard-mobile.png" });
});

test("Space overrides a screen, preserves contrast and image edges, then releases into frame memory", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { NODE_SPECS } = await import("/src/core/model.ts" as string);
    const studio = (window as any).__feedback.studio;
    const node = (id: string, kind: string) => ({
      id,
      kind,
      label: id,
      position: { x: 0, y: 0 },
      params: Object.fromEntries(
        Object.entries(NODE_SPECS[kind].params).map(([key, value]: any) => [
          key,
          value.default,
        ]),
      ),
    });
    const screen = node("display", "screen");
    Object.assign(screen.params, { contrast: 1, gamma: 1, response: 0 });
    const camera = node("camera", "camera");
    Object.assign(camera.params, {
      exposure: 0,
      focus: 0,
      sharpness: 0,
      noise: 0,
      gamma: 1,
    });
    const scene = structuredClone(studio.state.scene);
    scene.macros = {
      ...scene.macros,
      contrast: 0,
      balance: 0,
      color: 0,
      screenSpin: 0,
      memory: 0,
    };
    scene.mode = "free";
    scene.feed = false;
    scene.graph = {
      nodes: [
        screen,
        { ...screen, id: "other", label: "Other screen" },
        camera,
        node("history", "history"),
        node("output", "output"),
      ],
      edges: [
        { id: "1", from: "history", to: "display", input: "signal" },
        { id: "2", from: "display", to: "camera", input: "light" },
        { id: "3", from: "camera", to: "history", input: "write" },
        { id: "4", from: "history", to: "output", input: "signal" },
      ],
    };
    studio.commit(scene);
    for (let i = 0; i < 10; i++) studio.engine.step();
  });
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 144;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(64,64,64)";
    ctx.fillRect(0, 0, 128, 144);
    ctx.fillStyle = "rgb(192,192,192)";
    ctx.fillRect(128, 0, 128, 144);
    return canvas.toDataURL().split(",")[1];
  });
  await page.keyboard.press("i");
  await page
    .getByLabel("Screen image from gallery", { exact: true })
    .setInputFiles({
      name: "contrast.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "Image ready." }),
  ).toBeVisible();
  await page
    .getByLabel("Target screen", { exact: true })
    .selectOption("display");
  await page.getByLabel("Injection contrast value", { exact: true }).fill("2");
  await page
    .getByLabel("Injection contrast value", { exact: true })
    .press("Enter");
  const staged = await page.evaluate(() => {
    const s = (window as any).__feedback.studio;
    return {
      source: s.state.scene.source,
      feed: s.state.scene.feed,
      frame: s.engine.frame,
      scene: s.state.scene.screenImage,
    };
  });
  expect(staged.source).toBe("seed");
  expect(staged.feed).toBe(false);
  expect(staged.frame).toBe(10);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  const restoredImage = await page.evaluate(async () => {
    const { storage } = await import("/src/services/storage.ts" as string);
    const s = (window as any).__feedback.studio;
    const saved = await storage.save(s.engine, s.state.scene, () => {});
    const imported = await storage.import(await storage.export(saved.id));
    const selected = imported.scene.screenImage.source;
    return {
      selected,
      active: imported.state.screenInjection.source,
      asset: (await storage.getAsset(selected))?.name,
      preserved: imported.scene.assets.includes(selected),
      source: imported.scene.source,
    };
  });
  expect(restoredImage.active).toBe(restoredImage.selected);
  expect(restoredImage.asset).toBe("contrast.png");
  expect(restoredImage.preserved).toBe(true);
  expect(restoredImage.source).toBe("seed");
  const result = await page.evaluate(async () => {
    const e = (window as any).__feedback.getEngine();
    const queued = e.state();
    const { CheckpointStateSchema } = await import(
      "/src/core/protocol.ts" as string
    );
    const saved = CheckpointStateSchema.parse(queued);
    const buffers = [...e.buffers()];
    e.step();
    const pixels = (id: string) => {
      const m = e.memory.get(id);
      return Array.from(
        e.gpu.read(m.targets[id === "history" ? 31 + m.front : m.front]),
      ) as number[];
    };
    const screen = pixels("display"),
      other = pixels("other"),
      camera = pixels("camera");
    const scale = e.gpu.float ? 1 : 255;
    for (let i = 0; i < 24; i++) e.step();
    const memory = pixels("history");
    const continued = e.preview(256);
    e.reset();
    for (const buffer of buffers) e.restoreBuffer(buffer);
    e.restoreState(saved);
    for (let i = 0; i < 25; i++) e.step();
    return {
      queued,
      screen: [screen[0] / scale, screen[255 * 4] / scale],
      cameraMax: Math.max(...camera.filter((_, i) => i % 4 !== 3)) / scale,
      otherMax: Math.max(...other.filter((_, i) => i % 4 !== 3)),
      memoryMax: Math.max(...memory.filter((_, i) => i % 4 !== 3)) / scale,
      finished: e.state(),
      restored: e.preview(256) === continued,
      error: e.gpu.gl.getError(),
    };
  });
  expect(result.queued.frame).toBe(10);
  expect(result.queued.screenInjection.remaining).toBe(12);
  expect(result.screen[0]).toBeLessThan(0.01);
  expect(result.screen[1]).toBeGreaterThan(0.99);
  expect(result.otherMax).toBe(0);
  expect(result.cameraMax).toBeGreaterThan(0.99);
  expect(result.memoryMax).toBeGreaterThan(0.99);
  expect(result.finished.screenInjection).toBeUndefined();
  expect(result.finished.frame).toBe(35);
  expect(result.error).toBe(0);
  expect(result.restored).toBe(true);
});

test("held inputs integrate linear time without OS repeats or slider step rounding", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const macros = () =>
    page.evaluate(() => (window as any).__feedback.studio.state.scene.macros);
  await page.keyboard.press("3");
  await page.keyboard.down(".");
  expect((await macros()).contrast).toBe(0);
  await page.clock.runFor(100);
  await page.evaluate(() => {
    for (let i = 0; i < 50; i++)
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ".",
          code: "Period",
          repeat: true,
        }),
      );
  });
  await page.clock.runFor(23);
  await page.keyboard.up(".");
  expect((await macros()).contrast).toBeCloseTo(0.0492, 7);
  await page.clock.runFor(300);
  expect((await macros()).contrast).toBeCloseTo(0.0492, 7);
  await page.keyboard.down(",");
  await page.clock.runFor(123);
  await page.keyboard.up(",");
  expect((await macros()).contrast).toBeCloseTo(0, 7);

  const angle = page.getByRole("slider", { name: "Angle", exact: true });
  await angle.focus();
  await page.keyboard.down("ArrowUp");
  await page.clock.runFor(123);
  await page.keyboard.up("ArrowUp");
  expect((await macros()).turn).toBeCloseTo(0.0492, 7);
  await page.locator(".art-canvas").dispatchEvent("pointerdown");

  const positions = () =>
    page.evaluate(() =>
      (window as any).__feedback.studio.state.scene.graph.nodes
        .filter((n: any) => n.kind === "optics")
        .map((n: any) => ({ x: n.params.x, y: n.params.y })),
    );
  const before = await positions();
  for (const key of ["d", "w", "ArrowRight", "ArrowDown"])
    await page.keyboard.down(key);
  await page.clock.runFor(123);
  for (const key of ["d", "w", "ArrowRight", "ArrowDown"])
    await page.keyboard.up(key);
  const after = await positions();
  expect(after[0].x - before[0].x).toBeCloseTo(0.01845, 7);
  expect(after[0].y - before[0].y).toBeCloseTo(-0.01845, 7);
  expect(after[1].x - before[1].x).toBeCloseTo(0.01845, 7);
  expect(after[1].y - before[1].y).toBeCloseTo(0.01845, 7);

  await page.keyboard.down("a");
  await page.keyboard.down("d");
  await page.clock.runFor(123);
  await page.keyboard.up("a");
  await page.keyboard.up("d");
  expect(await positions()).toEqual(after);
  await page.keyboard.press("3");
  await page.keyboard.press("End");
  await page.keyboard.down(".");
  await page.clock.runFor(500);
  await page.keyboard.up(".");
  await page.keyboard.down(",");
  await page.clock.runFor(123);
  await page.keyboard.up(",");
  expect((await macros()).contrast).toBeCloseTo(0.9508, 7);
});

test("focus loss, hidden pages, and a busy studio clear held keys without later catch-up", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const position = () =>
    page.evaluate(
      () =>
        (window as any).__feedback.studio.state.scene.graph.nodes.find(
          (n: any) => n.id === "optics-a",
        ).params.x,
    );
  for (const interruption of ["blur", "hidden", "busy", "typing"]) {
    await page.locator(".art-canvas").dispatchEvent("pointerdown");
    await page.keyboard.down("d");
    await page.clock.runFor(100);
    if (interruption === "typing")
      await page.getByLabel("Angle value", { exact: true }).focus();
    else
      await page.evaluate((kind) => {
        if (kind === "blur") window.dispatchEvent(new Event("blur"));
        if (kind === "hidden") {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        }
        if (kind === "busy")
          (window as any).__feedback.studio.update({ busy: "Saving" });
      }, interruption);
    const stopped = await position();
    await page.clock.runFor(200);
    await page.evaluate(() => {
      delete (document as any).hidden;
      (window as any).__feedback.studio.update({ busy: "" });
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", code: "KeyD", repeat: true }),
      );
    });
    await page.clock.runFor(200);
    await page.keyboard.up("d");
    expect(await position(), interruption).toBe(stopped);
  }
});
