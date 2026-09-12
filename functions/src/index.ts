import { randomBytes, createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase, getDatabaseWithUrl } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import { resolveIceServers } from "./ice.js";
import { OperationRequestSchema } from "../../src/core/protocol.js";
import {
  BatchSchema,
  SceneSchema,
  compileGraph,
} from "../../src/core/model.js";
initializeApp();
const db =
    process.env.FUNCTIONS_EMULATOR === "true"
      ? getDatabaseWithUrl(
          `https://${process.env.GCLOUD_PROJECT}-default-rtdb.firebaseio.com`,
        )
      : getDatabase(),
  firestore = getFirestore(),
  bucket = () => getStorage().bucket();
const turnEnabled = process.env.TURN_PROVIDER === "twilio";
// Conditional declaration keeps a default deployment entirely free of secret prompts/bindings.
const twilioSid = turnEnabled ? defineSecret("TWILIO_ACCOUNT_SID") : undefined,
  twilioToken = turnEnabled ? defineSecret("TWILIO_AUTH_TOKEN") : undefined;
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function check(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new ApiError(status, message);
}
type Actor = {
  uid: string;
  grantId?: string;
  session?: string;
  scopes: string[];
};
async function actor(header: string | undefined): Promise<Actor> {
  const value = header?.replace(/^Bearer\s+/i, "");
  check(value, 401, "Authentication is required.");
  if (value.startsWith("fb_")) {
    const id = hash(value),
      snapshot = await firestore.doc(`agentGrants/${id}`).get();
    const grant = snapshot.data();
    check(
      grant && !grant.revoked && grant.expires > Date.now(),
      401,
      "Agent grant expired or revoked.",
    );
    return {
      uid: grant.owner,
      grantId: id,
      session: grant.session,
      scopes: grant.scopes,
    };
  }
  try {
    const decoded = await getAuth().verifyIdToken(value);
    return { uid: decoded.uid, scopes: ["owner"] };
  } catch {
    throw new ApiError(401, "Sign in again to continue.");
  }
}
async function session(id: string) {
  Id.parse(id);
  const snapshot = await db.ref(`sessions/${id}`).get();
  const data = snapshot.val();
  check(
    data && data.expires > Date.now(),
    404,
    "This installation session has expired.",
  );
  return data;
}
function own(a: Actor, s: any) {
  check(
    !a.grantId && s.owner === a.uid,
    403,
    "Only the installation owner can do this.",
  );
}
function access(a: Actor, s: any, id: string, scope: string) {
  check(
    s.owner === a.uid &&
      (!a.grantId || (a.session === id && a.scopes.includes(scope))),
    403,
    "This grant does not allow that operation.",
  );
}
async function limit(key: string, max: number, windowMs = 60000) {
  const ref = firestore.doc(`rateLimits/${hash(key)}`),
    now = Date.now();
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref),
      data = snap.data();
    const count = data && data.start > now - windowMs ? data.count + 1 : 1;
    check(count <= max, 429, "Too many requests. Please wait a moment.");
    tx.set(ref, {
      start: data && data.start > now - windowMs ? data.start : now,
      count,
      expires: now + windowMs * 2,
    });
  });
}
async function iceServers() {
  return resolveIceServers({
    provider: turnEnabled ? "twilio" : "none",
    credentials: () => ({
      sid: twilioSid?.value(),
      token: twilioToken?.value(),
    }),
    warn: console.warn,
  });
}
async function signed(
  path: string,
  action: "read" | "write" = "read",
  contentType?: string,
  generation?: string,
  bytes?: number,
) {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    const key = token();
    await firestore.doc(`emulatorAssetTickets/${hash(key)}`).set({
      path,
      action,
      ...(generation ? { generation } : {}),
      ...(bytes ? { bytes } : {}),
      contentType: contentType ?? "application/octet-stream",
      expires: Date.now() + (action === "read" ? 60000 : 300000),
    });
    return `http://${process.env.EMULATOR_PUBLIC_HOST ?? "127.0.0.1"}:5001/${process.env.GCLOUD_PROJECT}/europe-west1/api/v1/emulator-assets/${key}`;
  }
  const [url] = await bucket()
    .file(path, generation ? { generation } : undefined)
    .getSignedUrl({
      action,
      expires: Date.now() + (action === "read" ? 60000 : 300000),
      version: "v4",
      ...(contentType ? { contentType } : {}),
      ...(bytes
        ? { extensionHeaders: { "content-length": String(bytes) } }
        : {}),
    });
  return url;
}
const methods: Record<string, string> = {
  get_capabilities: "read",
  get_scene: "read",
  get_frame: "read",
  get_metrics: "read",
  upload_asset: "asset",
  load_scene: "control",
  apply_commands: "control",
  capture: "control",
  freeze: "control",
  reset: "control",
  find_balance: "control",
  save_scene: "save",
  start_recording: "record",
  stop_recording: "record",
};
export const api = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
    secrets: twilioSid && twilioToken ? [twilioSid, twilioToken] : [],
    maxInstances: 10,
  },
  async (req, res) => {
    const origin = req.headers.origin;
    const allowed = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .filter(Boolean);
    const project = process.env.GCLOUD_PROJECT;
    const local = process.env.FUNCTIONS_EMULATOR === "true";
    if (origin) {
      const ok =
        allowed.includes(origin) ||
        origin === `https://${project}.web.app` ||
        origin === `https://${project}.firebaseapp.com` ||
        (local &&
          /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.[\d.]+)(:\d+)?$/.test(
            origin,
          ));
      if (!ok) {
        res.status(403).json({ error: "This origin is not allowed." });
        return;
      }
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      const parts = req.path.split("/").filter(Boolean);
      check(parts.shift() === "v1", 404, "Unknown API version.");
      const [resource, id, action, subId] = parts;
      if (local && resource === "emulator-assets" && id) {
        const ticket = (
          await firestore.doc(`emulatorAssetTickets/${hash(id)}`).get()
        ).data();
        check(ticket && ticket.expires > Date.now(), 403, "Asset URL expired.");
        const file = bucket().file(ticket.path);
        if (req.method === "PUT" && ticket.action === "write") {
          check(
            req.rawBody.length < 8 * 1024 * 1024,
            413,
            "Emulator proxy limit: 8 MB. Production uploads go directly to Storage.",
          );
          check(
            !ticket.bytes || req.rawBody.length === ticket.bytes,
            413,
            "Upload size differs from its declared size.",
          );
          await file.save(req.rawBody, { contentType: ticket.contentType });
          res.status(200).send("");
          return;
        }
        check(
          req.method === "GET" && ticket.action === "read",
          403,
          "Asset URL does not allow this operation.",
        );
        const [metadata] = await file.getMetadata();
        check(
          !ticket.generation ||
            String(metadata.generation) === ticket.generation,
          404,
          "This immutable asset revision is no longer available.",
        );
        res.set(
          "Content-Type",
          metadata.contentType ?? "application/octet-stream",
        );
        res.set("Content-Length", String(metadata.size));
        file
          .createReadStream()
          .on("error", () => res.destroy())
          .pipe(res);
        return;
      }
      check(
        !req.rawBody || req.rawBody.length < 2 * 1024 * 1024,
        413,
        "Request body is too large. Use the asset upload endpoint.",
      );
      if (resource === "shares" && id && req.method === "GET") {
        const grant = (
          await firestore.doc(`shareGrants/${hash(id)}`).get()
        ).data();
        check(
          grant && !grant.revoked,
          404,
          "This shared moment is no longer available.",
        );
        const item = (
          await firestore
            .doc(`users/${grant.owner}/moments/${grant.momentId}`)
            .get()
        ).data();
        check(item, 404, "Moment not found.");
        const base = `users/${grant.owner}/moments/${grant.momentId}`;
        res.json({
          name: grant.metadata?.name ?? item.name,
          width: grant.metadata?.width ?? item.width,
          height: grant.metadata?.height ?? item.height,
          thumbnail: await signed(
            `${base}/thumbnail.png`,
            "read",
            undefined,
            grant.generations?.["thumbnail.png"],
          ),
          ...(item.hasRecording
            ? {
                recording: await signed(
                  `${base}/recording`,
                  "read",
                  undefined,
                  grant.generations?.recording,
                ),
              }
            : {}),
          allowRemix: grant.allowRemix,
          ...(grant.allowRemix
            ? {
                archive: await signed(
                  `${base}/moment.feedback`,
                  "read",
                  undefined,
                  grant.generations?.["moment.feedback"],
                ),
              }
            : {}),
        });
        return;
      }
      const a = await actor(req.headers.authorization);
      if (resource === "shares") {
        check(!a.grantId, 403, "Sharing requires the owner.");
        if (req.method === "POST" && !id) {
          await limit(`share:${a.uid}`, 20);
          const body = z
            .object({ momentId: Id, allowRemix: z.boolean() })
            .parse(req.body);
          const item = await firestore
            .doc(`users/${a.uid}/moments/${body.momentId}`)
            .get();
          check(
            item.exists,
            404,
            "Save the moment to your cloud gallery first.",
          );
          const metadata = item.data()!,
            generations: Record<string, string> = {};
          for (const file of [
            "thumbnail.png",
            "moment.feedback",
            ...(metadata.hasRecording ? ["recording"] : []),
          ]) {
            const [object] = await bucket()
              .file(`users/${a.uid}/moments/${body.momentId}/${file}`)
              .getMetadata();
            generations[file] = String(object.generation);
          }
          const raw = token();
          await firestore.doc(`shareGrants/${hash(raw)}`).set({
            owner: a.uid,
            momentId: body.momentId,
            metadata,
            generations,
            allowRemix: body.allowRemix,
            revoked: false,
            created: Date.now(),
          });
          res.json({ token: raw });
          return;
        }
        if (req.method === "PATCH" && id) {
          const reference = firestore.doc(`shareGrants/${hash(id)}`),
            grant = (await reference.get()).data();
          check(
            grant?.owner === a.uid,
            403,
            "Only the owner can change this link.",
          );
          const body = z
            .object({
              revoked: z.literal(true).optional(),
              allowRemix: z.boolean().optional(),
            })
            .strict()
            .parse(req.body);
          await reference.update(body);
          res.json({ ok: true });
          return;
        }
      }
      if (resource === "sessions" && !id && req.method === "POST") {
        check(!a.grantId, 403, "Agents cannot create installation sessions.");
        await limit(`session:${a.uid}`, 10);
        const id = token(),
          code = token();
        await db.ref(`sessions/${id}`).set({
          owner: a.uid,
          created: Date.now(),
          expires: Date.now() + 86400000,
          codeHash: hash(code),
          codeExpires: Date.now() + 600000,
          epoch: 0,
          hostOnline: false,
        });
        res.json({ id, code });
        return;
      }
      if (resource === "sessions" && id) {
        const s = await session(id);
        if (!action && req.method === "GET") {
          access(a, s, id, "read");
          res.json({
            id,
            online: !!s.hostOnline && s.status?.hostAt > Date.now() - 15000,
            controller: !!s.controller,
            status: s.status ?? null,
          });
          return;
        }
        if (action === "claim" && req.method === "POST") {
          check(!a.grantId, 403, "Use the agent command endpoint.");
          await limit(`claim:${a.uid}`, 15);
          const code = z.string().min(16).max(100).parse(req.body.code);
          check(
            s.codeExpires > Date.now() && hash(code) === s.codeHash,
            403,
            "This pairing code has expired. Ask the host for a new code.",
          );
          check(s.hostOnline, 409, "The installation is offline.");
          const now = Date.now();
          const servers = await iceServers();
          const result = await db
            .ref(`sessions/${id}`)
            .transaction((current) => {
              current = current ?? s;
              if (
                current.controller &&
                current.controller.expires > now &&
                current.controller.uid !== a.uid
              )
                return;
              const epoch = (current.epoch ?? 0) + 1;
              return {
                ...current,
                epoch,
                controller: { uid: a.uid, epoch, expires: now + 35000 },
              };
            });
          check(
            result.committed,
            409,
            "Someone is already controlling this installation. Wait for them to release it.",
          );
          res.json({
            epoch: result.snapshot.val().controller.epoch,
            iceServers: servers,
          });
          return;
        }
        if (action === "pair-code" && req.method === "POST") {
          own(a, s);
          const code = token();
          await db
            .ref(`sessions/${id}`)
            .update({ codeHash: hash(code), codeExpires: Date.now() + 600000 });
          res.json({ code });
          return;
        }
        if (action === "heartbeat" && req.method === "POST") {
          const epoch = z.number().int().parse(req.body.epoch);
          check(
            !a.grantId &&
              s.controller?.uid === a.uid &&
              s.controller.epoch === epoch &&
              s.controller.expires > Date.now(),
            403,
            "Your controller lease has ended.",
          );
          await db
            .ref(`sessions/${id}/controller/expires`)
            .set(Date.now() + 35000);
          res.json({ ok: true });
          return;
        }
        if (action === "release" && req.method === "POST") {
          check(
            !a.grantId &&
              (s.owner === a.uid ||
                (s.controller?.uid === a.uid &&
                  s.controller?.epoch === req.body.epoch)),
            403,
            "You cannot release another controller.",
          );
          await db.ref(`sessions/${id}`).update({
            controller: null,
            epoch: (s.epoch ?? 0) + 1,
            samples: null,
            actions: null,
          });
          res.json({ ok: true });
          return;
        }
        if (action === "ice" && req.method === "POST") {
          own(a, s);
          res.json({ iceServers: await iceServers() });
          return;
        }
        if (action === "grants") {
          own(a, s);
          if (req.method === "POST") {
            const scopes = z
              .array(z.enum(["read", "control", "save", "asset", "record"]))
              .min(1)
              .parse(req.body.scopes);
            const raw = `fb_${token()}`,
              grantId = hash(raw);
            await firestore.doc(`agentGrants/${grantId}`).set({
              owner: a.uid,
              session: id,
              scopes,
              expires: Date.now() + 4 * 3600000,
              revoked: false,
            });
            res.json({ id: grantId, token: raw });
            return;
          }
          if (req.method === "DELETE" && subId) {
            Id.parse(subId);
            const reference = firestore.doc(`agentGrants/${subId}`);
            const grant = (await reference.get()).data();
            check(
              grant?.owner === a.uid && grant.session === id,
              403,
              "Grant does not belong to this session.",
            );
            await reference.update({ revoked: true });
            res.json({ ok: true });
            return;
          }
        }
        if (action === "assets") {
          if (req.method === "POST") {
            access(a, s, id, "asset");
            await limit(`asset:${a.grantId ?? a.uid}`, 30);
            const body = z
              .object({
                name: z.string().min(1).max(150),
                mime: z.string().max(100),
                bytes: z
                  .number()
                  .int()
                  .positive()
                  .max(256 * 1024 * 1024),
              })
              .parse(req.body);
            check(
              /^(image\/|video\/|text\/)/.test(body.mime),
              400,
              "Unsupported asset type.",
            );
            const assetId = token();
            const path = `users/${s.owner}/agent-assets/${id}/${assetId}`;
            await firestore.doc(`sessionAssets/${assetId}`).set({
              ...body,
              owner: s.owner,
              session: id,
              path,
              expires: Date.now() + 86400000,
            });
            res.json({
              assetId,
              url: await signed(
                path,
                "write",
                body.mime,
                undefined,
                body.bytes,
              ),
              contentType: body.mime,
            });
            return;
          }
          if (req.method === "GET" && subId) {
            access(a, s, id, "asset");
            Id.parse(subId);
            const asset = (
              await firestore.doc(`sessionAssets/${subId}`).get()
            ).data();
            check(
              asset?.session === id && asset.owner === s.owner,
              404,
              "Asset not found.",
            );
            res.json({
              url: await signed(asset.path),
              name: asset.name,
              mime: asset.mime,
            });
            return;
          }
        }
        if (action === "commands") {
          if (req.method === "POST" && subId) {
            own(a, s);
            Id.parse(subId);
            const command = (
              await db.ref(`sessions/${id}/inbox/${subId}`).get()
            ).val();
            check(
              command && command.expires > Date.now(),
              410,
              "Command expired or cancelled.",
            );
            if (command.actor !== s.owner) {
              const grant = (
                await firestore.doc(`agentGrants/${command.actor}`).get()
              ).data();
              check(
                grant &&
                  !grant.revoked &&
                  grant.expires > Date.now() &&
                  grant.session === id,
                403,
                "Agent grant has been revoked.",
              );
            }
            check(
              methods[command.method] === "read" ||
                (!s.controller && command.epoch === s.epoch),
              409,
              "Control ownership changed. Submit a new command.",
            );
            res.json({ ok: true });
            return;
          }
          if (req.method === "POST") {
            const body = OperationRequestSchema.parse(req.body);
            const scope = methods[body.method];
            check(scope, 400, "Unknown instrument operation.");
            access(a, s, id, scope);
            await limit(`command:${a.grantId ?? a.uid}`, 120);
            check(
              s.hostOnline && s.status?.hostAt > Date.now() - 15000,
              409,
              "Renderer offline. Open the installation studio.",
            );
            if (scope !== "read")
              check(
                !s.controller || s.controller.expires < Date.now(),
                409,
                "A visitor has control. The host must release the phone before an agent can perform.",
              );
            if (body.method === "apply_commands") {
              const batch = BatchSchema.parse(body.args);
              for (const c of batch.commands)
                if (c.type === "graph") compileGraph(c.graph);
            }
            if (body.method === "load_scene" && !body.args.preset) {
              const scene = SceneSchema.parse(body.args.scene);
              compileGraph(scene.graph);
            }
            if (body.method === "upload_asset") {
              const assetId = Id.parse(body.args.assetId);
              const asset = (
                await firestore.doc(`sessionAssets/${assetId}`).get()
              ).data();
              check(
                asset?.session === id,
                403,
                "Asset belongs to another session.",
              );
              const [metadata] = await bucket().file(asset.path).getMetadata();
              check(
                Number(metadata.size) <= asset.bytes &&
                  Number(metadata.size) <= 256 * 1024 * 1024,
                413,
                "Uploaded asset exceeds its declared size.",
              );
            }
            const commandId = token(),
              now = Date.now();
            await db.ref(`sessions/${id}/inbox/${commandId}`).set({
              method: body.method,
              args: body.args,
              // Preserve empty arrays/objects through RTDB; args supports older open renderers.
              argsJson: JSON.stringify(body.args),
              actor: a.grantId ?? a.uid,
              epoch: s.epoch ?? 0,
              created: now,
              expires: now + 60000,
            });
            res.status(202).json({ commandId });
            return;
          }
          if (req.method === "GET" && subId) {
            access(a, s, id, "read");
            Id.parse(subId);
            const result = (
              await db.ref(`sessions/${id}/outbox/${subId}`).get()
            ).val();
            if (result) {
              check(
                result.actor === (a.grantId ?? a.uid),
                403,
                "This result belongs to another caller.",
              );
              const { valueJson, ...receipt } = result;
              res.json({
                status: "complete",
                ...receipt,
                ...(typeof valueJson === "string"
                  ? { value: JSON.parse(valueJson) }
                  : {}),
              });
              return;
            }
            const pending = (
              await db.ref(`sessions/${id}/inbox/${subId}`).get()
            ).val();
            check(
              pending && pending.actor === (a.grantId ?? a.uid),
              404,
              "Command not found.",
            );
            res.json({
              status: pending.expires < Date.now() ? "expired" : "pending",
            });
            return;
          }
        }
      }
      throw new ApiError(404, "Endpoint not found.");
    } catch (error) {
      const status =
        error instanceof ApiError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 500;
      res.status(status).json({
        error:
          status === 500
            ? "The installation service could not complete this request."
            : error instanceof Error
              ? error.message
              : "Request failed.",
      });
      if (status === 500) console.error(error);
    }
  },
);
export const cleanup = onSchedule(
  { schedule: "every 60 minutes", region: "europe-west1" },
  async () => {
    const now = Date.now();
    const sessions = await db
      .ref("sessions")
      .orderByChild("expires")
      .endAt(now)
      .limitToFirst(200)
      .get();
    const updates: Record<string, null> = {};
    sessions.forEach((s) => {
      updates[s.key!] = null;
    });
    if (Object.keys(updates).length) await db.ref("sessions").update(updates);
    for (const name of [
      "agentGrants",
      "rateLimits",
      "sessionAssets",
      "emulatorAssetTickets",
    ]) {
      const expired = await firestore
        .collection(name)
        .where("expires", "<", now)
        .limit(200)
        .get();
      for (const item of expired.docs) {
        if (name === "sessionAssets")
          await bucket()
            .file(item.data().path)
            .delete({ ignoreNotFound: true });
        await item.ref.delete();
      }
    }
  },
);
