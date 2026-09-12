import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const b = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal"],
});
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto("http://localhost:8768/tests/harness/index.html");
await p.waitForFunction(() => window.harness);
const results = [];
for (const width of [1920, 3840])
  for (let index = 0; index < 6; index++) {
    await p.evaluate(
      ({ index, width }) =>
        window.harness.preset(index, width, width === 3840 ? 768 : 384),
      { index, width },
    );
    await p.waitForTimeout(2000);
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await p.waitForTimeout(1000);
      samples.push(
        await p.evaluate(() => ({ ...window.harness.engine.metrics })),
      );
    }
    const m = samples.at(-1),
      fps = samples.map((s) => s.fps);
    const result = {
      instrument: [
        "Drift",
        "Fold",
        "Mutual",
        "Captive",
        "Time loom",
        "Emulsion",
      ][index],
      requestedWidth: width,
      width: m.width,
      height: m.height,
      historyWidth: m.historyWidth,
      precision: m.precision,
      memoryMB: m.memoryMB,
      renderer: m.renderer,
      meanFPS: fps.reduce((a, b) => a + b, 0) / fps.length,
      minFPS: Math.min(...fps),
    };
    results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(
      "tests/artifacts/benchmark.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          browser: await b.version(),
          method:
            "10 one-second samples after 2 seconds warmup. A separate core soak was also running.",
          errors,
          results,
        },
        null,
        2,
      ),
    );
  }
await b.close();
if (errors.length) process.exitCode = 1;
