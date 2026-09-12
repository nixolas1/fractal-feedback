import { test, expect } from "@playwright/test";
test("performance controls, literal Unicode text, media errors, and free-mode patching", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Text source" })
    .fill("光\nEverything returns\n<script>alert(1)</script>");
  await page.getByRole("button", { name: "Use these words" }).click();
  await expect(
    page.getByRole("button", { name: "Capture source", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close panel", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Capture source", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as any).__feedback.studio.state.scene.feed,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Freeze", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Free mode", exact: true }).click();
  await expect(
    page.getByText("The optical bench", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find balance", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test("image imports preserve aspect ratio and unsupported files produce an actionable error", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  const result = await page.evaluate(async () => {
    const s = (window as any).__feedback.studio;
    const c = document.createElement("canvas");
    c.width = 90;
    c.height = 180;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f08030";
    ctx.fillRect(0, 0, 90, 180);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!)));
    await s.addFiles([new File([blob], "portrait.png", { type: "image/png" })]);
    const item = s.sources.items.get(s.state.scene.source);
    const image = item.canvas
      .getContext("2d")
      .getImageData(0, 0, 1280, 720).data;
    let error = "";
    try {
      await s.addFiles([
        new File(["wrong"], "audio.mp3", { type: "audio/mpeg" }),
      ]);
    } catch (e) {
      error = (e as Error).message;
    }
    return {
      edge: [...image.slice(0, 3)],
      center: [
        ...image.slice((360 * 1280 + 640) * 4, (360 * 1280 + 640) * 4 + 3),
      ],
      error,
    };
  });
  expect(result.edge).toEqual([0, 0, 0]);
  expect(result.center).toEqual([240, 128, 48]);
  expect(result.error).toContain("image, GIF");
});
test("phone layout fits a narrow touch viewport and unavailable sensors keep touch usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?remote=demo&code=demo");
  await expect(
    page.getByRole("button", { name: "Connect to the light", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "tests/artifacts/remote.png" });
});
