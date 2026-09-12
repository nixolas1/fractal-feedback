import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
const duration = Number(process.env.SOAK_SECONDS || 3600) * 1000;
await mkdir("tests/artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-precise-memory-info"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8767/tests/harness/index.html");
await page.waitForFunction(() => window.harness);
const started = Date.now(),
  samples = [];
let minute = 0;
while (Date.now() - started < duration) {
  await page.waitForTimeout(10000);
  const value = await page.evaluate(() => ({
    metrics: { ...window.harness.engine.metrics },
    heap: performance.memory?.usedJSHeapSize,
    events: [...window.harness.events],
    glError: window.harness.engine.gpu.gl.getError(),
    lost: window.harness.engine.lost,
  }));
  samples.push({ elapsed: Date.now() - started, ...value });
  const nextMinute = Math.floor((Date.now() - started) / 60000);
  if (nextMinute !== minute) {
    minute = nextMinute;
    await page.evaluate((n) => window.harness.preset(n % 6), minute);
    if (minute % 10 === 0) await page.evaluate(() => window.harness.lose());
    console.log(
      `Soak ${minute} min · ${value.metrics.fps.toFixed(1)} fps · ${value.metrics.memoryMB} MB GPU budget`,
    );
  }
  await writeFile(
    "tests/artifacts/soak.json",
    JSON.stringify(
      {
        started,
        duration: Date.now() - started,
        completed: false,
        errors,
        samples,
      },
      null,
      2,
    ),
  );
}
await writeFile(
  "tests/artifacts/soak.json",
  JSON.stringify(
    {
      started,
      duration: Date.now() - started,
      completed: true,
      errors,
      samples,
    },
    null,
    2,
  ),
);
await browser.close();
console.log("One-hour renderer soak finished.");
if (
  errors.length ||
  samples.some((x) => x.glError !== 0 && !x.lost) ||
  samples.some((x) => x.events.some((e) => e.type === "error"))
)
  process.exitCode = 1;
