import { test, expect, type Page } from "@playwright/test";

test.skip(
  process.env.FEEDBACK_VIDEO_TEST !== "fractal-feedback",
  "Explicit opt-in: uses temporary phone leases in the deployed Firebase project with the local frontend.",
);

// Drop both embedded and trickled candidates to reproduce a privacy/network
// policy that allows Firebase controls but prevents direct video connectivity.
async function blockVideo(page: Page) {
  // Production only accepts its Hosting origins. Keep that policy unchanged;
  // proxy this explicitly opted-in local test's authenticated API requests.
  await page.route(
    "https://europe-west1-fractal-feedback.cloudfunctions.net/**",
    async (route) => {
      const response = await route.fetch({
        headers: {
          ...route.request().headers(),
          origin: "https://fractal-feedback.web.app",
        },
      });
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "access-control-allow-origin": "http://localhost:5173",
        },
      });
    },
  );
  await page.addInitScript(() => {
    (window as any).blockVideo = true;
    const Peer = RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(Peer, {
      construct(target, args) {
        const pc = new target(...args);
        const add = pc.addIceCandidate.bind(pc);
        pc.addIceCandidate = async (candidate) => {
          if (!(window as any).blockVideo) await add(candidate);
        };
        const describe = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = async (description) => {
          await describe(
            (window as any).blockVideo && description
              ? {
                  ...description,
                  sdp: description.sdp?.replace(/^a=candidate:.*\r?\n/gm, ""),
                }
              : description,
          );
        };
        return pc;
      },
    });
  });
}

async function openHost(page: Page) {
  await blockVideo(page);
  await page.goto("/");
  await page.waitForFunction(() => (window as any).__feedback?.getEngine());
  return page.evaluate(async () => {
    const { hostSession, studio } = (window as any).__feedback;
    const scene = structuredClone(studio.state.scene);
    scene.simulation = {
      width: 256,
      height: 144,
      historyWidth: 96,
      fps: 30,
      memoryBudgetMB: 64,
    };
    studio.commit(scene);
    await hostSession.start();
    return hostSession.state;
  });
}

test("camera starts before ICE connects, restarts the route and reuses the sender after stopping", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = await openHost(page);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
  });
  const phone = await context.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  try {
    await blockVideo(phone);
    await phone.goto(`/?remote=${session.id}&code=${session.code}`);
    await phone
      .getByRole("button", { name: "Connect to the light", exact: true })
      .click();
    await phone.waitForFunction(() => {
      const pc = (window as any).__feedbackRemote?.connection()?.peer;
      return pc?.remoteDescription && pc.signalingState === "stable";
    });
    expect(
      await phone.evaluate(
        () =>
          (window as any).__feedbackRemote.connection().peer.connectionState,
      ),
    ).not.toBe("connected");
    await page.evaluate(() => {
      (window as any).blockVideo = false;
    });
    await phone.evaluate(() => {
      (window as any).blockVideo = false;
    });
    await phone
      .getByRole("button", { name: "Live camera", exact: true })
      .click();
    await expect(
      phone.getByRole("button", { name: "Live camera on", exact: true }),
    ).toBeVisible();
    await expect(phone.locator("header")).toContainText("Connected", {
      timeout: 30000,
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = (window as any).__feedback.studio;
          return s.state.assets.some(
            (a: any) => a.kind === "camera" && a.name === "Phone camera",
          );
        }),
      )
      .toBe(true);
    await expect(phone.locator(".camera-preview")).toContainText(
      "Live landscape",
    );
    const before = await phone.evaluate(
      () =>
        (window as any).__feedbackRemote
          .connection()
          .peer.localDescription.sdp.match(/a=ice-ufrag:(.*)/)[1],
    );
    await phone.evaluate(() =>
      (window as any).__feedbackRemote.connection().retryVideo(),
    );
    await expect
      .poll(() =>
        phone.evaluate(
          () =>
            (window as any).__feedbackRemote.connection().peer.signalingState,
        ),
      )
      .toBe("stable");
    const after = await phone.evaluate(
      () =>
        (window as any).__feedbackRemote
          .connection()
          .peer.localDescription.sdp.match(/a=ice-ufrag:(.*)/)[1],
    );
    expect(after).not.toBe(before);
    await phone
      .getByRole("button", { name: "Turn sensors off", exact: true })
      .click();
    await expect(phone.locator(".camera-preview")).toHaveCount(0);
    await phone
      .getByRole("button", { name: "Live camera", exact: true })
      .click();
    await expect(
      phone.getByRole("button", { name: "Live camera on", exact: true }),
    ).toBeVisible();
    expect(
      await phone.evaluate(
        () =>
          (window as any).__feedbackRemote.connection().peer.getTransceivers()
            .length,
      ),
    ).toBe(1);
    await expect
      .poll(() =>
        phone.evaluate(async () => {
          const pc = (window as any).__feedbackRemote.connection().peer;
          const stats = await pc.getStats();
          return [...stats.values()].some(
            (stat: any) =>
              stat.type === "outbound-rtp" &&
              stat.kind === "video" &&
              stat.framesEncoded > 1,
          );
        }),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => (window as any).__feedback.hostSession.release());
    await context.close();
  }
});

test("blocked video gives a finite status and retry while cloud controls and camera cleanup keep working", async ({
  page,
  browser,
}) => {
  const session = await openHost(page);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
  });
  const phone = await context.newPage();
  const errors: string[] = [];
  phone.on("pageerror", (error) => errors.push(error.message));
  try {
    await blockVideo(phone);
    await phone.goto(`/?remote=${session.id}&code=${session.code}`);
    await phone
      .getByRole("button", { name: "Connect to the light", exact: true })
      .click();
    await phone
      .getByRole("button", { name: "Live camera", exact: true })
      .click();
    await expect(
      phone.getByRole("button", { name: "Live camera on", exact: true }),
    ).toBeVisible();
    await expect(phone.locator(".camera-preview")).toContainText(
      "Preview only",
    );
    await expect(phone.getByLabel("Video connection")).toContainText(
      "Video could not connect",
      { timeout: 35000 },
    );
    await expect(phone.getByLabel("Video connection")).toContainText(
      "WebRTC IP handling policy",
    );
    await phone.getByLabel("Angle value", { exact: true }).fill("0.31");
    await phone.getByLabel("Angle value", { exact: true }).press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__feedback.studio.state.scene.macros.turn,
        ),
      )
      .toBe(0.31);
    await phone
      .getByRole("button", { name: "Retry video connection", exact: true })
      .click();
    await expect(phone.getByLabel("Video connection")).toContainText(
      "Retrying the video connection",
    );
    await expect(phone.getByLabel("Video connection")).toContainText(
      "Video could not connect",
      { timeout: 20000 },
    );
    await phone.evaluate(() => {
      (window as any).cameraTestTrack = (
        window as any
      ).__feedbackRemote.connection().cameraTrack;
    });
    await phone
      .getByRole("button", { name: "Turn sensors off", exact: true })
      .click();
    await expect(phone.locator(".camera-preview")).toHaveCount(0);
    expect(
      await phone.evaluate(() => (window as any).cameraTestTrack.readyState),
    ).toBe("ended");
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => (window as any).__feedback.hostSession.release());
    await context.close();
  }
});

test("a lost signaling connection times out camera setup and permits immediate sensor shutdown", async ({
  page,
  browser,
}) => {
  const session = await openHost(page);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
  });
  const phone = await context.newPage();
  try {
    await blockVideo(phone);
    await phone.goto(`/?remote=${session.id}&code=${session.code}`);
    await phone
      .getByRole("button", { name: "Connect to the light", exact: true })
      .click();
    await phone.waitForFunction(() => {
      const pc = (window as any).__feedbackRemote?.connection()?.peer;
      return pc?.remoteDescription && pc.signalingState === "stable";
    });
    await phone.evaluate(async () => {
      // Let the initial answer reach Firebase before cutting off signaling.
      await (window as any).__feedbackRemote.connection().signaling;
      const { cloud } = await import("/src/services/cloud.ts" as string);
      const { goOffline } = await import(
        "/node_modules/.vite/deps/firebase_database.js" as string
      );
      goOffline(cloud.db);
    });
    await phone
      .getByRole("button", { name: "Live camera", exact: true })
      .click();
    await expect(phone.locator(".camera-preview")).toBeVisible();
    await phone.evaluate(() => {
      (window as any).cameraTestTrack = (
        window as any
      ).__feedbackRemote.connection().cameraTrack;
    });
    await expect(
      phone.getByRole("button", { name: "Turn sensors off", exact: true }),
    ).toBeEnabled();
    await phone
      .getByRole("button", { name: "Turn sensors off", exact: true })
      .click();
    expect(
      await phone.evaluate(() => (window as any).cameraTestTrack.readyState),
    ).toBe("ended");
    await expect(phone.locator(".camera-preview")).toHaveCount(0);
    await expect(phone.getByRole("alert")).toContainText(
      "Video setup timed out",
      { timeout: 15000 },
    );
    await expect(
      phone.getByRole("button", { name: "Live camera", exact: true }),
    ).toBeEnabled();
  } finally {
    await page.evaluate(() => (window as any).__feedback.hostSession.release());
    await context.close();
  }
});
