import { z } from "zod";

const IceServer = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export const directIceServers = () => [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/** Local candidates are always tried first. STUN discovers direct routes; it does not relay media. */
export async function resolveIceServers(options: {
  provider?: string;
  credentials: () => { sid?: string; token?: string };
  fetcher?: typeof fetch;
  warn?: (message: string) => void;
}) {
  if (options.provider !== "twilio") return directIceServers();
  try {
    const { sid, token } = options.credentials();
    if (!sid || !token) throw new Error("Missing TURN credentials");
    const response = await (options.fetcher ?? fetch)(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "Ttl=3600",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error("TURN request failed");
    const { ice_servers } = z
      .object({ ice_servers: z.array(IceServer).min(1) })
      .parse(await response.json());
    return ice_servers;
  } catch {
    // Do not log provider responses or credentials. A relay outage must not block LAN pairing.
    options.warn?.(
      "Optional TURN relay unavailable; using direct WebRTC and cloud control fallback.",
    );
    return directIceServers();
  }
}
