import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFile, rm } from "node:fs/promises";
test.skip(
  !process.env.FEEDBACK_CLOUD_TEST,
  "Requires the isolated Firebase emulators and Vite --mode emulator on port 5174.",
);

test("exclusive phone lease, real WebRTC camera transfer, fallback controls, host override and handover", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  const session = await page.evaluate(async () => {
    const { hostSession } = (window as any).__feedback;
    await hostSession.start();
    return hostSession.state;
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    phone = await context.newPage();
  await phone.goto(
    `http://localhost:5174/?remote=${session.id}&code=${session.code}`,
  );
  await phone.getByRole("button", { name: "Connect to the light" }).click();
  await expect(phone.locator("header")).toContainText("Connected", {
    timeout: 30000,
  });
  await phone.getByLabel("Turn value", { exact: true }).fill("0.31");
  await phone.getByLabel("Turn value", { exact: true }).press("Tab");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__feedback.studio.state.scene.macros.turn,
      ),
    )
    .toBe(0.31);
  await phone.evaluate(() =>
    Object.defineProperty(window, "DeviceOrientationEvent", {
      configurable: true,
      value: class {
        static requestPermission = async () => "denied";
      },
    }),
  );
  await phone.getByRole("button", { name: "Tilt", exact: true }).click();
  await expect(phone.getByRole("alert")).toContainText(
    "Touch controls still work",
  );
  await phone.getByRole("button", { name: "Live camera", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__feedback.studio.state.assets.some(
          (a: any) => a.kind === "camera" && a.name === "Phone camera",
        ),
      ),
    )
    .toBe(true);
  const otherContext = await browser.newContext(),
    other = await otherContext.newPage();
  await other.goto(
    `http://localhost:5174/?remote=${session.id}&code=${session.code}`,
  );
  await other.getByRole("button", { name: "Connect to the light" }).click();
  await expect(other.getByRole("alert")).toContainText("already controlling");
  // Force the optional video connection down: controls must still use RTDB.
  await phone.evaluate(() => {
    const c = (window as any).__feedbackRemote.connection();
    c.samples?.close();
    c.actions?.close();
  });
  await phone.getByLabel("Distance value", { exact: true }).fill("0.22");
  await phone.getByLabel("Distance value", { exact: true }).press("Tab");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__feedback.studio.state.scene.macros.distance,
      ),
    )
    .toBe(0.22);
  await page.evaluate(() => (window as any).__feedback.hostSession.release());
  await expect(
    phone.getByRole("button", { name: "Connect to the light" }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Connect to the light" }).click();
  await expect(
    other.getByRole("button", { name: "Capture", exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Release the instrument" }).click();
  await page.evaluate(() =>
    (window as any).__feedback.hostSession.refreshCode(),
  );
  await phone.getByRole("button", { name: "Connect to the light" }).click();
  await expect(phone.getByRole("alert")).toContainText("expired");
  await context.close();
  await otherContext.close();
});

test("HTTP and stdio MCP can create and save art; scopes, stale revisions, revocation and offline status are enforced", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  const setup = await page.evaluate(async () => {
    const { studio: s, hostSession: h, cloud } = (window as any).__feedback;
    s.mode("free");
    const scene = structuredClone(s.state.scene);
    scene.simulation = {
      width: 256,
      height: 144,
      historyWidth: 128,
      fps: 60,
      memoryBudgetMB: 64,
    };
    s.commit(scene);
    await h.start();
    const grant = await cloud.api(`sessions/${h.state.id}/grants`, {
      scopes: ["read", "control", "asset", "save", "record"],
    });
    return { id: h.state.id, grant, url: cloud.url };
  });
  await page.waitForTimeout(1100);
  const base = `${setup.url}/v1/sessions/${setup.id}`,
    headers = {
      Authorization: `Bearer ${setup.grant.token}`,
      "Content-Type": "application/json",
    };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["mcp/dist/mcp/src/index.js"],
    cwd: process.cwd(),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (p): p is [string, string] => p[1] !== undefined,
        ),
      ),
      FEEDBACK_API_URL: `${setup.url}/v1`,
      FEEDBACK_SESSION_ID: setup.id,
      FEEDBACK_AGENT_TOKEN: setup.grant.token,
    },
  });
  const client = new Client({
    name: "feedback-verification",
    version: "1.0.0",
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(14);
    const sceneResult: any = await client.callTool({
      name: "get_scene",
      arguments: {},
    });
    const original = JSON.parse(sceneResult.content[0].text);
    expect(original.scene.automation.points).toEqual([]);
    expect(original.scene.assets).toEqual([]);
    const loaded: any = await client.callTool({
      name: "load_scene",
      arguments: { scene: original.scene },
    });
    expect(loaded.isError, loaded.content?.[0]?.text).not.toBe(true);
    const reloaded: any = await client.callTool({
      name: "get_scene",
      arguments: {},
    });
    const before = JSON.parse(reloaded.content[0].text);
    expect(before.scene).toEqual(original.scene);
    const changed: any = await client.callTool({
      name: "apply_commands",
      arguments: {
        expectedRevision: before.revision,
        commands: [{ type: "macros", values: { turn: 0.18, color: 0.12 } }],
      },
    });
    expect(changed.isError).not.toBe(true);
    const stale: any = await client.callTool({
      name: "apply_commands",
      arguments: {
        expectedRevision: before.revision,
        commands: [{ type: "macros", values: { turn: 0.99 } }],
      },
    });
    expect(stale.isError).toBe(true);
    const frame: any = await client.callTool({
      name: "get_frame",
      arguments: { width: 256 },
    });
    expect(frame.content[0].type).toBe("image");
    expect(frame.content[0].data.length).toBeGreaterThan(100);
    const fixture = "tests/artifacts/agent-unicode.txt";
    await writeFile(fixture, "光\nThe image remembers.");
    const uploaded: any = await client.callTool({
      name: "upload_asset",
      arguments: { path: fixture },
    });
    expect(uploaded.isError, uploaded.content?.[0]?.text).not.toBe(true);
    await rm(fixture);
    await client.callTool({ name: "capture", arguments: {} });
    await client.callTool({ name: "freeze", arguments: { frozen: true } });
    const saved: any = await client.callTool({
      name: "save_scene",
      arguments: { name: "Made through MCP" },
    });
    expect(saved.isError, saved.content?.[0]?.text).not.toBe(true);
    expect(
      await page.evaluate(() =>
        (window as any).__feedback.studio.state.moments.some(
          (m: any) => m.name === "Made through MCP",
        ),
      ),
    ).toBe(true);
    const readGrant = await page.evaluate(async () => {
      const { cloud, hostSession: h } = (window as any).__feedback;
      return cloud.api(`sessions/${h.state.id}/grants`, { scopes: ["read"] });
    });
    const denied = await fetch(`${base}/commands`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${readGrant.token}` },
      body: JSON.stringify({ method: "reset", args: {} }),
    });
    expect(denied.status).toBe(403);
    await page.evaluate(async (id) => {
      const { cloud, hostSession: h } = (window as any).__feedback;
      await cloud.api(
        `sessions/${h.state.id}/grants/${id}`,
        {},
        false,
        "DELETE",
      );
    }, setup.grant.id);
    const revoked = await fetch(`${base}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({ method: "get_scene", args: {} }),
    });
    expect(revoked.status).toBe(401);
    await page.close();
    await new Promise((r) => setTimeout(r, 600));
    const offline = await fetch(`${base}/commands`, {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${readGrant.token}` },
      body: JSON.stringify({ method: "get_scene", args: {} }),
    });
    expect(offline.status).toBe(409);
    expect((await offline.json()).error).toContain("offline");
  } finally {
    await client.close();
    await transport.close();
  }
});

test("private cloud moments resolve immutable view/remix grants, and revoked links and expired media fail", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  const share = await page.evaluate(async () => {
    const { studio: s, cloud } = (window as any).__feedback;
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
    s.engine.step();
    const moment = await s.save();
    await cloud.anonymous();
    cloud.userName = () => "Emulator owner";
    const saved = await cloud.share(moment);
    return { token: saved.shareToken, cloudId: saved.cloudId, url: cloud.url };
  });
  const endpoint = `${share.url}/v1/shares/${share.token}`;
  const view = await (await fetch(endpoint)).json();
  expect(view.allowRemix).toBe(false);
  expect(view.archive).toBeUndefined();
  expect((await fetch(view.thumbnail)).status).toBe(200);
  await page.evaluate(async (token) => {
    await (window as any).__feedback.cloud.api(
      `shares/${token}`,
      { allowRemix: true },
      false,
      "PATCH",
    );
  }, share.token);
  const remix = await (await fetch(endpoint)).json();
  expect(remix.archive).toBeTruthy();
  expect((await fetch(remix.archive)).status).toBe(200);
  await page.evaluate(async (token) => {
    await (window as any).__feedback.cloud.api(
      `shares/${token}`,
      { revoked: true },
      false,
      "PATCH",
    );
  }, share.token);
  expect((await fetch(endpoint)).status).toBe(404);
  // A signed asset capability expires separately, even if already handed to a viewer.
  await page.waitForTimeout(61000);
  expect((await fetch(view.thumbnail)).status).toBe(403);
});
