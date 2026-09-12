import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:4173");
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  await new Promise((r) =>
    navigator.serviceWorker.controller
      ? r()
      : navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => r(),
          { once: true },
        ),
  );
});
await page.context().setOffline(true);
await page.reload();
await page.getByRole("button", { name: "Free mode", exact: true }).click();
await page.getByText("The optical bench", { exact: true }).waitFor();
await page
  .getByRole("button", { name: "Close panel", exact: true })
  .last()
  .click();
await page.getByRole("button", { name: "Save moment", exact: true }).click();
await page
  .getByText("Moment saved to your gallery.", { exact: true })
  .waitFor();
console.log(
  JSON.stringify({
    offline: true,
    patchLoaded: true,
    saveWorked: true,
    errors,
  }),
);
await browser.close();
if (errors.length) process.exitCode = 1;
