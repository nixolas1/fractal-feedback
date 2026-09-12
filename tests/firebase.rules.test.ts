import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref as fileRef, uploadBytes, getBytes } from "firebase/storage";
let env: RulesTestEnvironment;
const endpoint = (value: string | undefined, port: number) => {
  const [host, configuredPort] = value?.split(":") ?? [
    "127.0.0.1",
    String(port),
  ];
  return { host, port: Number(configuredPort) };
};
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-feedback",
    database: {
      ...endpoint(process.env.FIREBASE_DATABASE_EMULATOR_HOST, 9000),
      rules: readFileSync("database.rules.json", "utf8"),
    },
    firestore: {
      ...endpoint(process.env.FIRESTORE_EMULATOR_HOST, 8080),
      rules: readFileSync("firestore.rules", "utf8"),
    },
    storage: {
      ...endpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199),
      rules: readFileSync("storage.rules", "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    await set(ref(c.database(), "sessions/test-session"), {
      owner: "owner",
      expires: Date.now() + 3600000,
      controller: { uid: "phone", epoch: 1, expires: Date.now() + 60000 },
      hostOnline: true,
      status: {
        scene: "fold",
        macros: {},
        feed: true,
        frozen: false,
        revision: 0,
        hostAt: Date.now(),
      },
      inbox: { secret: { method: "get_scene" } },
      outbox: { secret: { value: "private" } },
    });
  });
});
afterAll(async () => {
  await env?.cleanup();
});
describe("installation permissions", () => {
  it("keeps full sessions and agent results private to their owner", async () => {
    await assertSucceeds(
      get(
        ref(
          env.authenticatedContext("owner").database(),
          "sessions/test-session",
        ),
      ),
    );
    await assertFails(
      get(
        ref(env.unauthenticatedContext().database(), "sessions/test-session"),
      ),
    );
    await assertFails(
      get(
        ref(
          env.authenticatedContext("phone").database(),
          "sessions/test-session/outbox",
        ),
      ),
    );
    await assertFails(
      get(
        ref(
          env.authenticatedContext("stranger").database(),
          "sessions/test-session/status",
        ),
      ),
    );
  });
  it("lets the leased phone read status and send bounded samples only for its own epoch", async () => {
    const db = env.authenticatedContext("phone").database();
    await assertSucceeds(get(ref(db, "sessions/test-session/status")));
    await assertSucceeds(
      set(ref(db, "sessions/test-session/samples"), {
        uid: "phone",
        epoch: 1,
        seq: 1,
        type: "macros",
        values: { turn: 0.3 },
      }),
    );
    await assertFails(
      set(ref(db, "sessions/test-session/samples"), {
        uid: "phone",
        epoch: 2,
        seq: 2,
        type: "macros",
        values: { turn: 0.3 },
      }),
    );
    await assertFails(
      set(ref(db, "sessions/test-session/samples"), {
        uid: "phone",
        epoch: 1,
        seq: 3,
        type: "macros",
        values: { turn: 999 },
      }),
    );
    await assertFails(
      set(ref(db, "sessions/test-session/controller"), {
        uid: "phone",
        epoch: 2,
        expires: Date.now() + 9999999,
      }),
    );
  });
  it("does not let a phone forge host signaling or enqueue agent commands", async () => {
    const db = env.authenticatedContext("phone").database();
    await assertFails(
      set(ref(db, "sessions/test-session/signals/1/offer"), {
        sdp: "fake",
        type: "offer",
      }),
    );
    await assertSucceeds(
      set(ref(db, "sessions/test-session/signals/1/answer"), {
        sdp: "answer",
        type: "answer",
      }),
    );
    await assertFails(
      set(ref(db, "sessions/test-session/inbox/fake"), { method: "reset" }),
    );
  });
  it("accepts independent rotation speeds without widening other phone controls", async () => {
    const sample = ref(
      env.authenticatedContext("phone").database(),
      "sessions/test-session/samples",
    );
    const send = (values: Record<string, number>, type = "macros") =>
      set(sample, {
        uid: "phone",
        epoch: 1,
        seq: 4,
        type,
        values,
      });
    await assertSucceeds(
      send({ cameraSpin: 30, cameraBSpin: -30, screenSpin: 5, contrast: 0.5 }),
    );
    await assertFails(send({ cameraSpin: 30.1 }));
    await assertFails(send({ cameraBSpin: -30.1 }));
    await assertFails(send({ screenSpin: 31 }));
    await assertSucceeds(send({ cameraDistance: 0.5, cameraBDistance: 2 }));
    await assertFails(send({ cameraDistance: 0.49 }));
    await assertFails(send({ cameraBDistance: 2.01 }));
    await assertFails(send({ cameraDistance: 1 }, "sensors"));
    await assertFails(send({ contrast: 2 }));
    await assertFails(send({ turn: 2 }));
    await assertFails(send({ screenSpin: 5 }, "sensors"));
  });
  it("keeps gallery documents immutable and owner-scoped", async () => {
    const db = env.authenticatedContext("owner").firestore(),
      path = `users/owner/moments/rules-${Date.now()}`;
    const moment = {
      owner: "owner",
      name: "A moment",
      created: Date.now(),
      width: 1920,
      height: 1080,
      bytes: 10,
      recordingType: null,
      hasRecording: false,
    };
    await assertSucceeds(setDoc(doc(db, path), moment));
    await assertFails(
      getDoc(doc(env.authenticatedContext("stranger").firestore(), path)),
    );
    await assertFails(setDoc(doc(db, path), { ...moment, name: "Changed" }));
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext("owner").firestore(),
          "agentGrants/secret",
        ),
      ),
    );
  });
  it("protects stored media from other users and prevents replacing shared revisions", async () => {
    const path = `users/owner/moments/${Date.now()}/thumbnail.png`,
      owner = fileRef(env.authenticatedContext("owner").storage(), path);
    await assertSucceeds(
      uploadBytes(owner, new Uint8Array([1, 2, 3]), {
        contentType: "image/png",
      }),
    );
    await assertSucceeds(getBytes(owner));
    await assertFails(
      getBytes(fileRef(env.unauthenticatedContext().storage(), path)),
    );
    await assertFails(
      uploadBytes(owner, new Uint8Array([4, 5]), { contentType: "image/png" }),
    );
  });
});
