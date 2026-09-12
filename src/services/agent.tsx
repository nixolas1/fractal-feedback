import { useEffect, useState } from "react";
import { onChildAdded, ref, set, remove } from "firebase/database";
import { Copy, Cable, KeyRound, Unlink } from "lucide-react";
import { z } from "zod";
import { studio, attempt } from "../core/studio";
import {
  NODE_SPECS,
  BatchSchema,
  SceneSchema,
  validateScene,
} from "../core/model";
import { PRESETS } from "../core/presets";
import { hostSession, useHostSession } from "../remote/session";
import { cloud } from "./cloud";
export const OPERATIONS = [
  "get_capabilities",
  "get_scene",
  "get_frame",
  "get_metrics",
  "upload_asset",
  "load_scene",
  "apply_commands",
  "capture",
  "freeze",
  "reset",
  "find_balance",
  "save_scene",
  "start_recording",
  "stop_recording",
] as const;
export async function executeOperation(method: string, args: any = {}) {
  if (!studio.engine || studio.state.lost)
    throw new Error(
      "Renderer offline. Open the studio on the installation computer.",
    );
  if (method === "get_capabilities")
    return {
      version: 1,
      nodes: NODE_SPECS,
      presets: PRESETS.map(({ id, name, description }) => ({
        id,
        name,
        description,
      })),
      operations: OPERATIONS,
      precision: studio.engine.metrics.precision,
      scope: "active-browser",
    };
  if (method === "get_scene")
    return { scene: studio.state.scene, revision: studio.state.revision };
  if (method === "get_frame")
    return {
      mimeType: "image/jpeg",
      dataUrl: studio.engine.preview(
        Math.min(1280, Math.max(64, Number(args.width) || 640)),
      ),
      revision: studio.state.revision,
    };
  if (method === "get_metrics")
    return {
      ...studio.engine.measure(),
      calibration: studio.engine.lastCalibration,
    };
  if (method === "apply_commands") {
    const batch = BatchSchema.parse(args);
    return studio.commands(batch.commands, batch.expectedRevision);
  }
  if (method === "load_scene") {
    if (args.preset) {
      if (!PRESETS.some((p) => p.id === args.preset))
        throw new Error("Unknown preset.");
      await studio.preset(args.preset);
    } else await studio.loadScene(validateScene(args.scene));
    return { revision: studio.state.revision };
  }
  if (method === "capture") {
    studio.capture();
    return { revision: studio.state.revision };
  }
  if (method === "freeze") {
    const desired = z.boolean().optional().parse(args.frozen);
    if (desired === undefined || desired !== studio.state.frozen)
      studio.freeze();
    return { frozen: studio.state.frozen };
  }
  if (method === "reset") {
    studio.reset();
    return { frame: studio.engine.frame };
  }
  if (method === "find_balance") {
    if (studio.state.scene.mode === "free")
      throw new Error(
        "Free mode is unassisted. Adjust camera exposure directly.",
      );
    await studio.balance();
    return {
      baseline: studio.state.scene.baseline,
      mode: studio.state.scene.mode,
    };
  }
  if (method === "save_scene") {
    if (args.name) {
      const scene = structuredClone(studio.state.scene);
      scene.name = z.string().max(120).parse(args.name);
      studio.commit(scene);
    }
    const moment = await studio.save();
    return { id: moment.id, name: moment.name, bytes: moment.bytes };
  }
  if (method === "start_recording") {
    if (studio.state.recording) throw new Error("Already recording.");
    await studio.recording(false);
    return { recording: true, mime: studio.recorder.mime };
  }
  if (method === "stop_recording") {
    if (!studio.state.recording) throw new Error("No active recording.");
    await studio.recording();
    return { recording: false };
  }
  if (method === "upload_asset") {
    const id = z.string().parse(args.assetId);
    const result = await cloud.api<{ url: string; name: string; mime: string }>(
      `sessions/${hostSession.state.id}/assets/${encodeURIComponent(id)}`,
    );
    const response = await fetch(result.url);
    if (!response.ok)
      throw new Error("The uploaded asset could not be retrieved.");
    const file = new File([await response.blob()], result.name, {
      type: result.mime,
    });
    await studio.addFiles([file]);
    return {
      assetId: studio.state.scene.source,
      revision: studio.state.revision,
    };
  }
  throw new Error(`Unknown operation: ${method}`);
}
export function attachAgentHost() {
  let off: (() => void) | undefined,
    subscribed = "",
    queue = Promise.resolve();
  const seen = new Set<string>();
  const subscribe = hostSession.subscribe(() => {
    const id = hostSession.state.id;
    if (id === subscribed || !cloud.db) return;
    off?.();
    if (!id) {
      subscribed = "";
      return;
    }
    subscribed = id;
    off?.();
    off = onChildAdded(ref(cloud.db, `sessions/${id}/inbox`), (snapshot) => {
      const command = snapshot.val();
      if (!command || seen.has(snapshot.key!)) return;
      seen.add(snapshot.key!);
      queue = queue
        .catch(() => {})
        .then(async () => {
          let result: any;
          try {
            if (command.expires < Date.now())
              throw new Error(
                "Command expired before the renderer received it.",
              );
            if (
              command.epoch !== hostSession.state.epoch &&
              hostSession.state.controller
            )
              throw new Error("Controller changed. Acquire control again.");
            await cloud.api(`sessions/${id}/commands/${snapshot.key}`, {});
            // RTDB drops empty collections and nulls from nested objects. Keep scene payloads as JSON.
            const args =
              typeof command.argsJson === "string"
                ? JSON.parse(command.argsJson)
                : command.args;
            const value = await executeOperation(command.method, args);
            result = {
              ok: true,
              valueJson: JSON.stringify(value ?? null),
              finished: Date.now(),
              actor: command.actor,
            };
          } catch (error) {
            result = {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              finished: Date.now(),
              actor: command.actor,
            };
          }
          await set(
            ref(cloud.db!, `sessions/${id}/outbox/${snapshot.key}`),
            result,
          );
          await remove(snapshot.ref);
        });
    });
  });
  if (import.meta.env.DEV)
    (window as any).__feedback = {
      studio,
      cloud,
      hostSession,
      execute: executeOperation,
      getEngine: () => studio.engine,
    };
  return () => {
    subscribe();
    off?.();
  };
}
export function AgentPanel() {
  const host = useHostSession(),
    [grant, setGrant] = useState<{ id: string; token: string } | null>(null),
    [creating, setCreating] = useState(false);
  async function create() {
    setCreating(true);
    try {
      await hostSession.start();
      if (hostSession.state.controller) await hostSession.release();
      const result = await cloud.api<{ id: string; token: string }>(
        `sessions/${hostSession.state.id}/grants`,
        { scopes: ["read", "control", "save", "asset", "record"] },
      );
      setGrant(result);
    } finally {
      setCreating(false);
    }
  }
  return (
    <>
      <div className="drawer-intro">
        <h2>Another pair of hands</h2>
        <p>
          Let an agent see the image, adjust the instrument, and save what it
          discovers.
        </p>
      </div>
      <div className="agent-symbol">
        <Cable size={36} strokeWidth={1} />
      </div>
      {!cloud.configured ? (
        <p className="muted">
          External agent access becomes available when this installation has a
          Firebase connection. The project includes an HTTP API and a stdio MCP
          adapter.
        </p>
      ) : (
        <>
          <p className="muted">
            Create a temporary grant for this open studio. It can read the
            canvas, patch the apparatus, import media, and save locally.
            Publishing is not included.
          </p>
          <button
            className="button primary"
            disabled={creating}
            onClick={() => attempt(create)}
          >
            <KeyRound size={16} />
            {creating ? "Creating grant…" : "Create agent grant"}
          </button>
          {grant && (
            <>
              <label className="field-label">
                API endpoint
                <input readOnly value={`${cloud.url}/v1`} />
              </label>
              <label className="field-label">
                Session
                <input readOnly value={host.id} />
              </label>
              <label className="field-label">
                Access token
                <input readOnly type="password" value={grant.token} />
              </label>
              <button
                className="button"
                onClick={() =>
                  attempt(async () => {
                    await navigator.clipboard.writeText(
                      JSON.stringify(
                        {
                          FEEDBACK_API_URL: `${cloud.url}/v1`,
                          FEEDBACK_SESSION_ID: host.id,
                          FEEDBACK_AGENT_TOKEN: grant.token,
                        },
                        null,
                        2,
                      ),
                    );
                    studio.message("Agent environment copied.");
                  })
                }
              >
                <Copy size={15} /> Copy connection details
              </button>
              <button
                className="button"
                onClick={() =>
                  attempt(async () => {
                    await cloud.api(
                      `sessions/${host.id}/grants/${grant.id}`,
                      {},
                      false,
                      "DELETE",
                    );
                    setGrant(null);
                    studio.message("Agent access revoked.");
                  })
                }
              >
                <Unlink size={15} /> Revoke access
              </button>
            </>
          )}
        </>
      )}
      <section>
        <h3>One instrument, one command layer</h3>
        <p className="muted small">
          The agent uses the same validated scene graph and controls as you. It
          can inspect a frame after every adjustment. Closing this studio takes
          its renderer offline.
        </p>
        <pre className="code-sample">node mcp/dist/mcp/src/index.js</pre>
        <p className="muted small">
          Pass the connection details as environment variables to the MCP
          adapter. See the project’s agent documentation for examples.
        </p>
      </section>
    </>
  );
}
