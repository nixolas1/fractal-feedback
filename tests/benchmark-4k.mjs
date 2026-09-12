import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("tests/artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const recordOnly = process.argv.includes("--record-only");
const results = recordOnly
    ? JSON.parse(await readFile("docs/benchmark-4k-2026-09-12.json", "utf8"))
        .results
    : [],
  recordings = [];
try {
  await page.goto("http://localhost:5173/tests/harness/index.html");
  await page.waitForFunction(() => window.harness);
  for (const preset of recordOnly
    ? []
    : [
        "drift",
        "fold",
        "mutual",
        "captive",
        "time-loom",
        "emulsion",
        "kaleidoscope",
        "branches",
      ]) {
    await page.evaluate(async (id) => {
      const { PRESETS } = await import("/src/core/presets.ts");
      window.harness.engine.configure(
        PRESETS.find((p) => p.id === id).make(),
        true,
      );
    }, preset);
    await page.waitForTimeout(2000);
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(1000);
      samples.push(
        await page.evaluate(() => ({ ...window.harness.engine.metrics })),
      );
    }
    const last = samples.at(-1);
    const result = {
      preset,
      width: last.width,
      height: last.height,
      targetFps: last.targetFps,
      meanFPS: samples.reduce((sum, s) => sum + s.fps, 0) / samples.length,
      minFPS: Math.min(...samples.map((s) => s.fps)),
      memoryMB: last.memoryMB,
      precision: last.precision,
      renderer: last.renderer,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    if (last.width !== 3840 || last.height !== 2160 || result.meanFPS < 29)
      errors.push(`${preset}: did not sustain native 4K at 30+ fps`);
  }
  for (const fps of [60, 30]) {
    await page.evaluate(async (fps) => {
      const { PRESETS } = await import("/src/core/presets.ts");
      const { CanvasRecorder } = await import("/src/services/recorder.ts");
      const scene = PRESETS.find((p) => p.id === "kaleidoscope").make();
      scene.simulation.fps = fps;
      scene.simulation.autoCadence = false;
      window.harness.engine.configure(scene, true);
      window.harness.engine.frozen = false;
      window.recordTest = new CanvasRecorder();
      window.harness.engine.onFrame = () => window.recordTest.frame();
    }, fps);
    await page.waitForTimeout(2000);
    await page.evaluate(
      async (fps) =>
        window.recordTest.start(window.harness.engine.canvas, fps, false, true),
      fps,
    );
    await page.waitForTimeout(5000);
    const clip = await page.evaluate(async () => {
      const blob = await window.recordTest.stop();
      const metrics = { ...window.harness.engine.metrics };
      window.harness.engine.frozen = true;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      Object.assign(video.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "960px",
        height: "540px",
      });
      document.body.append(video);
      const url = URL.createObjectURL(blob);
      video.src = url;
      const ended = new Promise((resolve, reject) => {
        video.onended = resolve;
        video.onerror = () =>
          reject(new Error("The recording could not be decoded."));
      });
      await video.play();
      await ended;
      const quality = video.getVideoPlaybackQuality();
      const decoded = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        frames: quality.totalVideoFrames,
        dropped: quality.droppedVideoFrames,
        fps: quality.totalVideoFrames / video.duration,
      };
      video.remove();
      URL.revokeObjectURL(url);
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      return { data, mime: blob.type, metrics, decoded };
    });
    const path = `tests/artifacts/kaleidoscope-4k-${fps}.${clip.mime.includes("mp4") ? "mp4" : "webm"}`;
    await writeFile(path, Buffer.from(clip.data.split(",")[1], "base64"));
    const recording = {
      requestedFps: fps,
      mime: clip.mime,
      renderFps: clip.metrics.fps,
      ...clip.decoded,
    };
    recordings.push(recording);
    console.log(JSON.stringify(recording));
    if (
      clip.decoded.width !== 3840 ||
      clip.decoded.height !== 2160 ||
      clip.decoded.fps < fps * 0.9
    )
      errors.push(`Recording did not sustain native 4K/${fps}`);
  }
} catch (error) {
  errors.push(String(error));
  throw error;
} finally {
  await writeFile(
    "docs/benchmark-4k-2026-09-12.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        method:
          "Native 4K, 2 seconds warmup plus 6 one-second render samples per preset. Separate 5-second Kaleidoscope recordings at 60 and 30 fps decoded in Chromium: dimensions, duration, totalVideoFrames and droppedVideoFrames from getVideoPlaybackQuality(). No other browser tests running.",
        results,
        recordings,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
if (errors.length) {
  console.error(errors);
  process.exitCode = 1;
}
