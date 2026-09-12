import { test, expect } from "@playwright/test";
test("live cameras fill the landscape frame without stretching", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  const frames = await page.evaluate(async () => {
    const { SourceManager } = await import("/src/engine/source.ts" as string);
    const manager = new SourceManager();
    manager.attach((window as any).__feedback.getEngine().gpu);
    const frames = [];
    try {
      for (const [width, height] of [
        [360, 640],
        [960, 360],
      ]) {
        const camera = document.createElement("canvas");
        camera.width = width;
        camera.height = height;
        const ctx = camera.getContext("2d")!;
        ctx.fillStyle = "#f08030";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#2040ff";
        ctx.fillRect((width - 100) / 2, (height - 100) / 2, 100, 100);
        const asset = await manager.camera(camera.captureStream(10));
        manager.texture(asset.id, 0);
        const frame = manager.items.get(asset.id).canvas;
        const pixels = frame.getContext("2d");
        const color = (x: number, y: number) =>
          [...pixels.getImageData(x, y, 1, 1).data].slice(0, 3);
        frames.push({
          size: [frame.width, frame.height],
          corners: [
            [0, 0],
            [1279, 0],
            [0, 719],
            [1279, 719],
          ].map(([x, y]) => color(x, y)),
          center: color(640, 360),
          squareWidth: Array.from({ length: 1280 }, (_, x) =>
            color(x, 360),
          ).filter((pixel) => pixel[2] > 200).length,
          squareHeight: Array.from({ length: 720 }, (_, y) =>
            color(640, y),
          ).filter((pixel) => pixel[2] > 200).length,
        });
      }
    } finally {
      manager.dispose();
    }
    return frames;
  });
  for (const frame of frames) {
    expect(frame.size).toEqual([1280, 720]);
    // Browser video conversion can round color channels by a value or two.
    for (const color of frame.corners)
      color.forEach((channel, i) =>
        expect(Math.abs(channel - [240, 128, 48][i])).toBeLessThanOrEqual(2),
      );
    frame.center.forEach((channel, i) =>
      expect(Math.abs(channel - [32, 64, 255][i])).toBeLessThanOrEqual(2),
    );
    expect(Math.abs(frame.squareWidth - frame.squareHeight)).toBeLessThan(2);
  }
});

test("GIF disposal, explicit timing, aspect fit, seeking, and saved playback position", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback);
  const result = await page.evaluate(async () => {
    const { SourceManager } = await import("/src/engine/source.ts" as string);
    const manager = new SourceManager();
    const blob = await (await fetch("/tests/fixtures/disposal.gif")).blob();
    const asset = await manager.addFile(blob, "disposal.gif");
    const item = manager.items.get(asset.id);
    const match: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      if (i > 0) manager.advanceGif(item, item.gifDue);
      const expected = await createImageBitmap(
        await (await fetch(`/tests/fixtures/gif-frame-${i}.png`)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(expected, 0, 0);
      const a = item.gifCanvas.getContext("2d").getImageData(0, 0, 8, 8).data,
        b = ctx.getImageData(0, 0, 8, 8).data;
      match.push(a.every((v: number, j: number) => b[j] === v));
      expected.close();
    }
    manager.seek(asset.id, 0.14);
    manager.pause(asset.id);
    const snapshots = await manager.snapshotAssets([asset.id]);
    const before = item.gifCanvas.toDataURL();
    const restored = new SourceManager();
    await restored.load(snapshots[0]);
    const other = restored.items.get(asset.id);
    const after = other.gifCanvas.toDataURL();
    const edge = [
      ...item.canvas.getContext("2d").getImageData(0, 0, 1, 1).data,
    ];
    const sizes = [item.canvas.width, item.canvas.height];
    const delays = item.frames.map((f: any) => f.delay);
    const result = {
      match,
      equal: before === after,
      index: other.gifIndex,
      paused: other.paused,
      delays,
      edge,
      sizes,
    };
    manager.dispose();
    restored.dispose();
    return result;
  });
  expect(result.match).toEqual([true, true, true, true]);
  expect(result.delays).toEqual([40, 80, 120, 160]);
  expect(result.equal).toBe(true);
  expect(result.index).toBe(2);
  expect(result.paused).toBe(true);
  expect(result.edge).toEqual([0, 0, 0, 255]);
  expect(result.sizes).toEqual([1280, 720]);
});
test("video seeking, runtime recording codec, checkpoint package, and stopped live-source restoration", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback);
  const result = await page.evaluate(async () => {
    const s = (window as any).__feedback.studio;
    s.mode("free");
    const scene = structuredClone(s.state.scene);
    scene.simulation = {
      width: 128,
      height: 72,
      historyWidth: 96,
      fps: 60,
      memoryBudgetMB: 64,
    };
    s.commit(scene);
    await s.camera();
    s.engine.step();
    const cameraId = s.state.scene.source;
    const cameraMoment = await s.save();
    s.sources.remove(cameraId);
    await s.open(cameraMoment.id);
    const stillLive = s.sources.status(s.state.scene.source)?.live;
    await s.recording(false);
    await new Promise((r) => setTimeout(r, 500));
    await s.recording();
    const moment = s.state.moments[0];
    const clip = moment.recording;
    await s.addFiles([
      new File([clip], clip.type.includes("mp4") ? "clip.mp4" : "clip.webm", {
        type: clip.type,
      }),
    ]);
    const id = s.state.scene.source;
    s.sources.pause(id);
    s.sources.seek(id, 0.15);
    await new Promise((r) => setTimeout(r, 100));
    s.engine.step();
    const videoMoment = await s.save();
    const savedPosition = (await import("/src/services/storage.ts" as string))
      .storage;
    const archived = await savedPosition.export(videoMoment.id),
      imported = await savedPosition.import(archived);
    await s.open(imported.id);
    const position = s.sources.items.get(s.state.scene.source)?.video
      ?.currentTime;
    let codecError = "";
    try {
      await s.addFiles([
        new File(["not a video"], "bad.mp4", { type: "video/mp4" }),
      ]);
    } catch (e) {
      codecError = (e as Error).message;
    }
    return {
      stillLive,
      bytes: clip.size,
      mime: clip.type,
      position,
      codecError,
      hasAssets: imported.assets.length > 0,
      error: s.state.error,
    };
  });
  expect(result.stillLive).toBe(false);
  expect(result.bytes).toBeGreaterThan(100);
  expect(result.mime).toMatch(/^video\/(webm|mp4)/);
  expect(result.position).toBeCloseTo(0.15, 1);
  expect(result.codecError).toContain("cannot decode");
  expect(result.hasAssets).toBe(true);
  expect(result.error).toBe("");
});
