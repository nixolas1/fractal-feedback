import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("tests/artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
await page.goto("http://localhost:5173");
await page.waitForFunction(() => window.__feedback?.getEngine());
await page.waitForTimeout(3000);
for (const id of [
  "fold",
  "drift",
  "mutual",
  "captive",
  "time-loom",
  "emulsion",
]) {
  await page.evaluate(async (id) => {
    await window.__feedback.studio.preset(id);
  }, id);
  await page.waitForTimeout(5000);
  console.log(
    id,
    await page.evaluate(() => ({
      metrics: window.__feedback.getEngine().measure(),
      baseline: window.__feedback.studio.state.scene.baseline,
      error: window.__feedback.studio.state.error,
    })),
  );
  await page.screenshot({ path: `tests/artifacts/${id}.png` });
}
await browser.close();
