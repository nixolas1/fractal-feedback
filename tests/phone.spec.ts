import { test, expect } from "@playwright/test";

test("camera motion affects a built-in instrument and fades out after sensors stop", async ({
  page,
}) => {
  await page.goto("/tests/harness/index.html");
  await page.waitForFunction(() => (window as any).harness);
  const result = await page.evaluate(() => {
    const e = (window as any).harness.engine;
    e.frozen = true;
    const scene = structuredClone(e.scene);
    scene.simulation = {
      width: 256,
      height: 144,
      historyWidth: 96,
      fps: 60,
      memoryBudgetMB: 64,
    };
    e.configure(scene, true);
    for (let i = 0; i < 60; i++) e.step();
    const before = e.preview(256);
    e.configure(scene, true);
    e.setSensor({ motion: 1 });
    for (let i = 0; i < 60; i++) e.step();
    const moving = e.preview(256),
      distance = e.effectiveMacros().distance;
    e.setSensor({ motion: 0 });
    for (let i = 0; i < 90; i++) e.step();
    return {
      changed: before !== moving,
      distance,
      released: e.effectiveMacros().distance,
    };
  });
  expect(result.changed).toBe(true);
  expect(result.distance).toBeGreaterThan(0.7);
  expect(result.released).toBeLessThan(0.001);
});

test("native landscape capture falls back from 4K60 to 4K30, shares analysis, and releases the device", async ({
  page,
}) => {
  await page.goto("/?remote=test&code=test");
  const result = await page.evaluate(async () => {
    const { Sensors } = await import("/src/services/sensors.ts" as string);
    const canvas = document.createElement("canvas");
    canvas.width = 3840;
    canvas.height = 2160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#303030";
    ctx.fillRect(0, 0, 3840, 2160);
    const stream = canvas.captureStream(30);
    const requests: any[] = [],
      samples: any[] = [];
    const original = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      requests.push(constraints);
      if (requests.length === 1)
        throw new DOMException("60 fps unavailable", "OverconstrainedError");
      return stream;
    };
    const sensor = new Sensors((s: any) => samples.push(s));
    try {
      const camera = await sensor.camera();
      const analysis = await sensor.cameraMotion();
      await new Promise((r) => setTimeout(r, 150));
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 3840, 2160);
      await new Promise((r) => setTimeout(r, 150));
      sensor.stop();
      return {
        requests,
        shared: camera === analysis,
        motion: Math.max(...samples.map((s) => s.motion ?? 0)),
        track: stream.getVideoTracks()[0].readyState,
        last: samples.at(-1),
      };
    } finally {
      sensor.stop();
      navigator.mediaDevices.getUserMedia = original;
    }
  });
  expect(result.requests).toHaveLength(2);
  expect(result.requests[0].video).toMatchObject({
    width: { exact: 3840 },
    height: { exact: 2160 },
    frameRate: { min: 60 },
  });
  expect(result.requests[1].video.frameRate.min).toBe(30);
  expect(result.shared).toBe(true);
  expect(result.motion).toBeGreaterThan(0.5);
  expect(result.track).toBe("ended");
  expect(result.last.motion).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(async () => {
      const { landscapeCamera } = await import(
        "/src/services/camera.ts" as string
      );
      try {
        await landscapeCamera();
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    }),
  ).toContain("sideways");
});

test("gallery selection, contrast, WebRTC preload and shake override the source without resetting feedback", async ({
  page,
}) => {
  await page.goto("/?remote=test&code=test");
  await page.waitForFunction(() => (window as any).__feedbackRemote);
  await page.evaluate(async () => {
    const { PhoneConnection, hostSession, studio } = (window as any)
      .__feedbackRemote;
    const { ImageTransfer } = await import(
      "/src/remote/image-transfer.ts" as string
    );
    Object.defineProperty(DeviceMotionEvent, "requestPermission", {
      configurable: true,
      value: async () => "granted",
    });
    studio.state.scene.simulation = {
      width: 128,
      height: 72,
      historyWidth: 96,
      memoryBudgetMB: 64,
      fps: 60,
    };
    studio.mount(document.createElement("canvas"));
    studio.engine.frozen = true;
    for (let i = 0; i < 45; i++) studio.engine.step();
    const a = new RTCPeerConnection(),
      b = new RTCPeerConnection();
    a.onicecandidate = (e) => {
      if (e.candidate) void b.addIceCandidate(e.candidate);
    };
    b.onicecandidate = (e) => {
      if (e.candidate) void a.addIceCandidate(e.candidate);
    };
    const channel = a.createDataChannel("images", { ordered: true });
    const sender = new ImageTransfer(channel);
    b.ondatachannel = (e) =>
      new ImageTransfer(e.channel, async (id: string, image: Blob) => {
        const asset = await studio.sources.addFile(image, "Phone impulse.jpg");
        hostSession.impulseImage = { id, asset };
      });
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription!);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription!);
    await new Promise<void>((resolve) => {
      if (channel.readyState === "open") resolve();
      else channel.onopen = () => resolve();
    });
    hostSession.update({
      controller: "test-phone",
      epoch: 1,
      expires: Date.now() + 60000,
    });
    PhoneConnection.prototype.join = async function () {
      this.onStatus?.("Connected");
      this.onScene?.({
        scene: "kaleidoscope",
        feed: true,
        frozen: false,
        macros: studio.state.scene.macros,
      });
    };
    PhoneConnection.prototype.prepareImage = (image: Blob) =>
      sender.send(image);
    PhoneConnection.prototype.action = (type: string, value?: string) =>
      hostSession.receive(
        {
          id: crypto.randomUUID(),
          uid: "test-phone",
          epoch: 1,
          type,
          ...(value ? { value } : {}),
        },
        true,
      );
    (window as any).phoneTest = {
      studio,
      hostSession,
      a,
      b,
      frame: studio.engine.frame,
      baseline: structuredClone(studio.state.scene.baseline),
    };
  });
  await page
    .getByRole("button", { name: "Connect to the light", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Send image now", exact: true }),
  ).toBeDisabled();
  const photo = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 3840;
    canvas.height = 2160;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#606060";
    ctx.fillRect(0, 0, 1920, 2160);
    ctx.fillStyle = "#a0a0a0";
    ctx.fillRect(1920, 0, 1920, 2160);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!)));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page
    .getByLabel("Impulse image from gallery", { exact: true })
    .setInputFiles({
      name: "gallery.png",
      mimeType: "image/png",
      buffer: Buffer.from(photo),
    });
  await page
    .getByRole("spinbutton", { name: "Image contrast value", exact: true })
    .fill("2");
  await page
    .getByRole("spinbutton", { name: "Image contrast value", exact: true })
    .press("Enter");
  await expect(
    page.getByText("Image ready · Enable Impulse, then shake to send it.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).phoneTest.studio.state.scene.source,
    ),
  ).toBe("seed");
  await page.getByRole("button", { name: "Impulse", exact: true }).click();
  await page.evaluate(() => {
    // A phone that reports only accelerationIncludingGravity must still work.
    window.dispatchEvent(
      new DeviceMotionEvent("devicemotion", {
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
      }),
    );
    window.dispatchEvent(
      new DeviceMotionEvent("devicemotion", {
        accelerationIncludingGravity: { x: 20, y: 0, z: 9.81 },
      }),
    );
  });
  await expect(page.getByText("1 impulse sent", { exact: true })).toBeVisible();
  const state = await page.evaluate(() => {
    const { studio: s, frame, baseline } = (window as any).phoneTest;
    const item = s.sources.items.get(s.state.scene.source),
      ctx = item.canvas.getContext("2d");
    const before = s.engine.preview(128);
    s.engine.step();
    return {
      size: [item.canvas.width, item.canvas.height],
      dark: ctx.getImageData(100, 100, 1, 1).data[0],
      light: ctx.getImageData(3800, 100, 1, 1).data[0],
      frame: s.engine.frame,
      initialFrame: frame,
      source: s.state.scene.source,
      feed: s.state.scene.feed,
      pulse: s.engine.impulse,
      changed: before !== s.engine.preview(128),
      baseline: s.state.scene.baseline,
      originalBaseline: baseline,
    };
  });
  expect(state.size).toEqual([3840, 2160]);
  expect(state.dark).toBeLessThan(70);
  expect(state.light).toBeGreaterThan(185);
  expect(state.source).not.toBe("seed");
  expect(state.feed).toBe(false);
  expect(state.frame).toBe(state.initialFrame + 1);
  expect(state.changed).toBe(true);
  expect(state.baseline).toEqual(state.originalBaseline);
  expect(state.pulse).toBeGreaterThan(0);
  await expect(
    page.getByLabel("Impulse image from camera", { exact: true }),
  ).toHaveAttribute("capture", "environment");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "tests/artifacts/phone-impulse.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(async () => {
      const { studio, hostSession } = (window as any).phoneTest;
      const image = studio.state.scene.screenImage.source;
      await studio.source("seed");
      hostSession.discardImpulseImage();
      return studio.sources.items.has(image);
    }),
  ).toBe(true);
  await page.evaluate(() => {
    const t = (window as any).phoneTest;
    t.a.close();
    t.b.close();
    t.studio.unmount();
  });
});
