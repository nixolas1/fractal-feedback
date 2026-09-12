import { describe, expect, it, vi } from "vitest";
import { directIceServers, resolveIceServers } from "../functions/src/ice";

describe("optional TURN", () => {
  it("defaults to direct connections without reading secrets or calling Twilio", async () => {
    const credentials = vi.fn(() => {
      throw new Error("No secrets configured");
    });
    const fetcher = vi.fn();
    expect(await resolveIceServers({ credentials, fetcher })).toEqual(
      directIceServers(),
    );
    expect(credentials).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses short-lived provider credentials when explicitly enabled", async () => {
    const servers = [
      {
        urls: "turn:relay.example:3478",
        username: "temporary",
        credential: "temporary-key",
      },
    ];
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ice_servers: servers })),
      );
    expect(
      await resolveIceServers({
        provider: "twilio",
        credentials: () => ({ sid: "AC-example", token: "secret" }),
        fetcher,
      }),
    ).toEqual(servers);
    expect(fetcher.mock.calls[0][1].body).toBe("Ttl=3600");
  });
  it.each(["missing", "http", "malformed", "network"])(
    "keeps pairing available after %s relay failure",
    async (failure) => {
      const warn = vi.fn();
      const fetcher = vi.fn(async () => {
        if (failure === "network") throw new Error("secret provider response");
        return failure === "http"
          ? new Response("secret provider response", { status: 401 })
          : new Response('{"ice_servers":[]}');
      });
      const servers = await resolveIceServers({
        provider: "twilio",
        credentials: () =>
          failure === "missing" ? {} : { sid: "AC-example", token: "secret" },
        fetcher,
        warn,
      });
      expect(servers).toEqual(directIceServers());
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).not.toContain("secret");
    },
  );
});
