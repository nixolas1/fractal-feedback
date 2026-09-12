// Explicit opt-in: creates temporary owned data in the deployed project, then removes it.
import { chromium, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
if (process.env.FEEDBACK_PRODUCTION_TEST !== "fractal-feedback")
  throw new Error(
    "Set FEEDBACK_PRODUCTION_TEST=fractal-feedback to test the deployed project.",
  );
const origin = "https://fractal-feedback.web.app",
  api = "https://europe-west1-fractal-feedback.cloudfunctions.net/api/v1";
const bucket = "fractal-feedback.firebasestorage.app";
await mkdir("tests/artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-angle=metal",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let bearer, uid, metadataUrl, shareToken, client;
const objects = [];
const results = { date: new Date().toISOString(), origin };
async function ownerRequest(path, body, method = "POST") {
  const response = await fetch(`${api}/${path}`, {
    method,
    headers: { Authorization: bearer, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `Owner API ${method} ${path.split("/")[0]} failed: ${response.status} ${await response.text()}`,
    );
  return response.json();
}
async function command(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  if (result.isError) throw new Error(`MCP ${name}: ${result.content[0].text}`);
  return result.content[0].type === "text"
    ? JSON.parse(result.content[0].text)
    : result;
}
try {
  await page.goto(origin);
  await expect(page.getByLabel("Live optical feedback artwork")).toBeVisible();
  for (const name of ["Contrast", "Camera A", "Camera B", "Screen"])
    await expect(page.getByRole("slider", { name, exact: true })).toBeVisible();
  assert.equal(
    await page.evaluate(() => !!window.__feedback),
    false,
    "Production build must not expose test hooks",
  );
  await expect(page.locator(".caption-right small")).toContainText(
    "3840 × 2160",
  );
  await page.keyboard.press("3");
  await page.keyboard.press(".", { delay: 100 });
  assert.ok(
    Number(
      await page.getByLabel("Contrast value", { exact: true }).inputValue(),
    ) > 0,
  );
  await page.keyboard.press("Backspace");
  const aPosition = page.getByLabel("Camera A horizontal position", {
    exact: true,
  });
  const bPosition = page.getByLabel("Camera B horizontal position", {
    exact: true,
  });
  const aBefore = Number(await aPosition.inputValue()),
    bBefore = Number(await bPosition.inputValue());
  await page.keyboard.press("d", { delay: 100 });
  assert.ok(Number(await aPosition.inputValue()) > aBefore);
  assert.equal(Number(await bPosition.inputValue()), bBefore);
  await page.keyboard.press("ArrowRight", { delay: 100 });
  assert.ok(Number(await bPosition.inputValue()) > bBefore);
  await page.keyboard.press("i");
  const imageBuffer = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 3840;
      canvas.height = 2160;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, 3840, 2160);
      ctx.strokeStyle = "white";
      ctx.lineWidth = 32;
      ctx.beginPath();
      ctx.moveTo(1920, 180);
      ctx.lineTo(3500, 1980);
      ctx.lineTo(340, 1980);
      ctx.closePath();
      ctx.stroke();
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await page
    .getByLabel("Screen image from gallery", { exact: true })
    .setInputFiles({
      name: "deployment-screen.png",
      mimeType: "image/png",
      buffer: imageBuffer,
    });
  await expect(
    page.getByRole("status").filter({ hasText: "Image ready." }),
  ).toBeVisible();
  await page
    .getByLabel("Injection contrast value", { exact: true })
    .fill("1.5");
  await page
    .getByLabel("Injection contrast value", { exact: true })
    .press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  await expect(
    page.getByText("Image on screen. The loop captures its light.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("p");
  results.keyboard =
    "Native 4K output, slider selection/adjustment, independent WASD/arrows, staged image contrast, Space injection and P freeze passed on the hosted build.";
  await page.getByRole("button", { name: "Pair phone", exact: true }).click();
  const created = page.waitForResponse(
    (r) => r.url() === `${api}/sessions` && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Open phone pairing" }).click();
  const response = await created;
  assert.equal(response.status(), 200, "Hosted session creation");
  const session = await response.json();
  bearer = await response.request().headerValue("authorization");
  uid = JSON.parse(
    Buffer.from(bearer.split(".")[1], "base64url").toString(),
  ).sub;
  const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    phone = await phoneContext.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(`${origin}/?remote=${session.id}&code=${session.code}`);
  const claimed = phone.waitForResponse(
    (r) => r.url().endsWith("/claim") && r.request().method() === "POST",
  );
  await phone
    .getByRole("button", { name: "Connect to the light", exact: true })
    .click();
  const claim = await (await claimed).json();
  assert.ok(claim.iceServers.length);
  assert.ok(
    !JSON.stringify(claim.iceServers).includes("turn:"),
    "Default must not require TURN",
  );
  await expect(phone.locator("header")).toContainText("Connected", {
    timeout: 45000,
  });
  await phone.getByLabel("Angle value", { exact: true }).fill("0.27");
  await phone.getByLabel("Angle value", { exact: true }).press("Tab");
  await expect(page.getByLabel("Angle value", { exact: true })).toHaveValue(
    "0.27",
  );
  await phone.getByLabel("Camera A value", { exact: true }).fill("12");
  await phone.getByLabel("Camera A value", { exact: true }).press("Tab");
  await expect(page.getByLabel("Camera A value", { exact: true })).toHaveValue(
    "12",
  );
  await phone
    .getByLabel("Camera A distance value", { exact: true })
    .fill("1.2");
  await phone
    .getByLabel("Camera A distance value", { exact: true })
    .press("Tab");
  await expect(
    page.getByLabel("Camera A distance value", { exact: true }),
  ).toHaveValue("1.2");
  await phone
    .getByLabel("Impulse image from gallery", { exact: true })
    .setInputFiles({
      name: "phone-impulse.png",
      mimeType: "image/png",
      buffer: imageBuffer,
    });
  await expect(
    phone.getByRole("button", { name: "Send image now", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await phone
    .getByRole("button", { name: "Send image now", exact: true })
    .click();
  await expect(
    page.getByText(
      "Phone image injected. Its captured light continues in the loop.",
      { exact: true },
    ),
  ).toBeVisible();
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.getByRole("button", { name: "Live camera", exact: true }).click();
  await expect(
    phone.getByRole("button", { name: "Live camera on", exact: true }),
  ).toBeVisible();
  await expect(phone.locator(".camera-preview")).toContainText(
    "Live landscape",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close panel" })
    .click();
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await expect(
    page.locator(".source-list").getByText("Phone camera", { exact: true }),
  ).toBeVisible({
    timeout: 15000,
  });
  await phone
    .getByRole("button", { name: "Release the instrument", exact: true })
    .click();
  await phoneContext.close();
  results.phone =
    "Direct WebRTC, distance and motor controls, full-resolution image preload/manual impulse, landscape camera action and release passed in two desktop browser contexts.";
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close panel" })
    .click();
  await page
    .getByRole("button", { name: "Agent connection", exact: true })
    .click();
  await page.getByRole("button", { name: "Create agent grant" }).click();
  await expect(page.getByLabel("Access token")).toBeVisible();
  const token = await page.getByLabel("Access token").inputValue();
  client = new Client({ name: "production-verification", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["mcp/dist/mcp/src/index.js"],
      env: {
        ...process.env,
        FEEDBACK_API_URL: api,
        FEEDBACK_SESSION_ID: session.id,
        FEEDBACK_AGENT_TOKEN: token,
      },
      stderr: "pipe",
    }),
  );
  const caps = await command("get_capabilities");
  assert.ok(caps.presets.some((preset) => preset.id === "kaleidoscope"));
  assert.ok(caps.presets.some((preset) => preset.id === "branches"));
  assert.ok(caps.macros.some((macro) => macro.key === "screenSpin"));
  const { scene } = await command("get_scene");
  scene.mode = "free";
  scene.simulation = {
    width: 256,
    height: 144,
    historyWidth: 96,
    fps: 60,
    memoryBudgetMB: 64,
  };
  await command("load_scene", { scene });
  await writeFile(
    "tests/artifacts/production-agent.txt",
    "Light remembers.\n光",
  );
  await command("upload_asset", {
    path: "tests/artifacts/production-agent.txt",
  });
  await command("capture");
  await command("freeze", { frozen: true });
  const saved = await command("save_scene", {
    name: "Deployment verification",
  });
  assert.ok(saved.id);
  results.mcp =
    "Real stdio MCP read, scene load, signed asset upload/import, capture, freeze and save passed.";
  await page
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await client.close();
  client = undefined;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close panel" })
    .click();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  const moment = page
    .locator(".moment-card")
    .filter({ hasText: "Deployment verification" });
  await expect(moment).toBeVisible();
  const archiveDownload = page.waitForEvent("download");
  await moment.getByRole("button", { name: "Moment", exact: true }).click();
  const archive = await archiveDownload;
  await archive.saveAs("tests/artifacts/production-moment.feedback");
  const imageDownload = page.waitForEvent("download");
  await moment.getByRole("button", { name: "Download still" }).click();
  const image = await imageDownload;
  await image.saveAs("tests/artifacts/production-moment.png");
  const id = crypto.randomUUID(),
    base = `users/${uid}/moments/${id}`;
  for (const [name, path, mime] of [
    [
      "moment.feedback",
      "tests/artifacts/production-moment.feedback",
      "application/octet-stream",
    ],
    ["thumbnail.png", "tests/artifacts/production-moment.png", "image/png"],
  ]) {
    const object = `${base}/${name}`,
      data = Array.from(await readFile(path));
    objects.push(object);
    const status = await page.evaluate(
      async ({ bucket, object, data, mime, bearer }) => {
        const r = await fetch(
          `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(object)}`,
          {
            method: "POST",
            headers: {
              Authorization: bearer.replace(/^Bearer /, "Firebase "),
              "Content-Type": mime,
            },
            body: new Uint8Array(data),
          },
        );
        return r.status;
      },
      { bucket, object, data, mime, bearer },
    );
    assert.equal(status, 200, "Browser Storage upload with CORS");
  }
  metadataUrl = `https://firestore.googleapis.com/v1/projects/fractal-feedback/databases/(default)/documents/${base}`;
  const fields = {
    name: { stringValue: "Deployment verification" },
    owner: { stringValue: uid },
    created: { integerValue: String(Date.now()) },
    width: { integerValue: "256" },
    height: { integerValue: "144" },
    bytes: {
      integerValue: String(
        (await readFile("tests/artifacts/production-moment.feedback")).length,
      ),
    },
    recordingType: { nullValue: null },
    hasRecording: { booleanValue: false },
  };
  assert.equal(
    (
      await fetch(metadataUrl, {
        method: "PATCH",
        headers: { Authorization: bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      })
    ).status,
    200,
    "Private cloud metadata save",
  );
  assert.equal(
    (await fetch(metadataUrl)).status,
    403,
    "Private metadata is owner-only",
  );
  shareToken = (
    await ownerRequest("shares", { momentId: id, allowRemix: true })
  ).token;
  const shared = await (await fetch(`${api}/shares/${shareToken}`)).json();
  assert.ok(shared.archive);
  assert.ok(shared.thumbnail);
  const signed = await page.evaluate(
    async (data) => ({
      image: (await fetch(data.thumbnail)).status,
      archive: (await fetch(data.archive)).status,
    }),
    shared,
  );
  assert.deepEqual(signed, { image: 200, archive: 200 });
  const viewer = await browser.newPage();
  await viewer.goto(`${origin}/?share=${shareToken}`);
  await expect(viewer.locator(".shared-art img")).toBeVisible();
  await expect
    .poll(() =>
      viewer.locator(".shared-art img").evaluate((i) => i.naturalWidth),
    )
    .toBe(256);
  await viewer.close();
  await ownerRequest(`shares/${shareToken}`, { revoked: true }, "PATCH");
  assert.equal((await fetch(`${api}/shares/${shareToken}`)).status, 404);
  shareToken = undefined;
  results.cloud =
    "Browser Storage upload/CORS, private Firestore metadata, real GCS signed URLs, shared viewer/remix access and share revocation passed.";
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close panel" })
    .click();
  await page.screenshot({ path: "tests/artifacts/production-studio.png" });
  assert.deepEqual(errors, []);
  results.errors = [];
  results.completed = true;
  console.log(JSON.stringify(results, null, 2));
} finally {
  await client?.close().catch(() => {});
  if (shareToken && bearer)
    await ownerRequest(
      `shares/${shareToken}`,
      { revoked: true },
      "PATCH",
    ).catch(() => {});
  for (const object of objects)
    await fetch(
      `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(object)}`,
      {
        method: "DELETE",
        headers: { Authorization: bearer.replace(/^Bearer /, "Firebase ") },
      },
    );
  if (metadataUrl)
    await fetch(metadataUrl, {
      method: "DELETE",
      headers: { Authorization: bearer },
    });
  await writeFile(
    "tests/artifacts/production-smoke.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
