#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { BatchSchema, SceneSchema } from "../../src/core/model.js";
const api = process.env.FEEDBACK_API_URL?.replace(/\/$/, ""),
  session = process.env.FEEDBACK_SESSION_ID,
  token = process.env.FEEDBACK_AGENT_TOKEN;
if (!api || !session || !token) {
  console.error(
    "Set FEEDBACK_API_URL, FEEDBACK_SESSION_ID, and FEEDBACK_AGENT_TOKEN from the studio’s Agent connection panel.",
  );
  process.exit(1);
}
const parsed = new URL(api);
if (
  parsed.protocol !== "https:" &&
  !(
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname)
  )
) {
  console.error(
    "The agent API must use HTTPS, except for localhost emulators.",
  );
  process.exit(1);
}
async function request(path: string, body?: unknown) {
  const response = await fetch(
    `${api}/sessions/${encodeURIComponent(session!)}/${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  const json = (await response.json()) as any;
  if (!response.ok)
    throw new Error(json.error || `Request failed (${response.status}).`);
  return json;
}
async function operation(method: string, args: Record<string, unknown> = {}) {
  const { commandId } = await request("commands", { method, args });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const result = await request(`commands/${commandId}`);
    if (result.status === "complete") {
      if (!result.ok) throw new Error(result.error);
      return result.value;
    }
    if (result.status === "expired")
      throw new Error(
        "The command expired. Keep the installation studio open and try again.",
      );
  }
  throw new Error(
    "The renderer did not acknowledge this command in time. Inspect the studio before retrying.",
  );
}
const server = new McpServer({
  name: "feedback-optical-studio",
  version: "1.0.0",
});
const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
function tool(
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  run: (args: any) => Promise<any>,
) {
  server.tool(name, description, schema, async (args) => {
    try {
      return await run(args);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });
}
tool(
  "get_capabilities",
  "Inspect available optical nodes, exact parameter ranges, six base instruments, and commands.",
  {},
  async () => text(await operation("get_capabilities")),
);
tool(
  "get_scene",
  "Read the current scene and its revision before making atomic control changes.",
  {},
  async () => text(await operation("get_scene")),
);
tool(
  "get_frame",
  "Look at the actual current rendered optical artwork.",
  { width: z.number().int().min(64).max(1280).optional() },
  async (args) => {
    const frame = await operation("get_frame", args);
    return {
      content: [
        {
          type: "image" as const,
          mimeType: "image/jpeg",
          data: frame.dataUrl.split(",")[1],
        },
        { type: "text" as const, text: `Scene revision ${frame.revision}` },
      ],
    };
  },
);
tool(
  "get_metrics",
  "Inspect current cadence, precision, memory use, luminance, spatial variance, and clipping.",
  {},
  async () => text(await operation("get_metrics")),
);
tool(
  "load_scene",
  "Load a base instrument by preset ID, or a complete validated scene. Starts a new evolution.",
  { preset: z.string().optional(), scene: SceneSchema.optional() },
  async (args) => text(await operation("load_scene", args)),
);
tool(
  "apply_commands",
  "Apply a batch atomically. Requires the revision from get_scene; invalid routing or any invalid command rejects the whole batch.",
  BatchSchema.shape,
  async (args) => text(await operation("apply_commands", args)),
);
tool(
  "capture",
  "Trap the current source frame and disconnect continuous source injection.",
  {},
  async () => text(await operation("capture")),
);
tool(
  "freeze",
  "Hold or resume the simulation without clearing its frame memory.",
  { frozen: z.boolean() },
  async (args) => text(await operation("freeze", args)),
);
tool(
  "reset",
  "Clear feedback memory and seed a new evolution using the current patch.",
  {},
  async () => text(await operation("reset")),
);
tool(
  "find_balance",
  "Run one bounded calibration and hold its exposure reference. Visitor mode only; never continuously adjusts.",
  {},
  async () => text(await operation("find_balance")),
);
tool(
  "save_scene",
  "Save the editable setup, source assets, and resumable visual checkpoint into the host’s private local gallery.",
  { name: z.string().max(120).optional() },
  async (args) => text(await operation("save_scene", args)),
);
tool(
  "start_recording",
  "Record the actual canvas silently at its current resolution. Does not enable a microphone.",
  {},
  async () => text(await operation("start_recording")),
);
tool(
  "stop_recording",
  "Stop recording and save the clip with a visual checkpoint in the host gallery.",
  {},
  async () => text(await operation("stop_recording")),
);
tool(
  "upload_asset",
  "Upload a local image, GIF, video, or text file to this granted installation and select it as a source.",
  { path: z.string(), mimeType: z.string().optional() },
  async (args) => {
    const path = resolve(args.path),
      info = await stat(path);
    if (!info.isFile() || info.size > 256 * 1024 * 1024)
      throw new Error("Select a file under 256 MB.");
    const types: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".avif": "image/avif",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".csv": "text/csv",
    };
    const mime = args.mimeType ?? types[extname(path).toLowerCase()];
    if (!mime) throw new Error("Provide a supported file type or mimeType.");
    const ticket = await request("assets", {
      name: basename(path),
      mime,
      bytes: info.size,
    });
    const response = await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: await readFile(path),
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error("The asset upload failed.");
    return text(await operation("upload_asset", { assetId: ticket.assetId }));
  },
);
await server.connect(new StdioServerTransport());
