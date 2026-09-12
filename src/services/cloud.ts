import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  connectAuthEmulator,
  type Auth,
} from "firebase/auth";
import {
  getDatabase,
  connectDatabaseEmulator,
  type Database,
} from "firebase/database";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  getDocs,
  collection,
  type Firestore,
} from "firebase/firestore";
import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytesResumable,
  getBlob,
  getMetadata,
  type FirebaseStorage,
} from "firebase/storage";
import { storage, type Moment } from "./storage";
const env = import.meta.env;
export class Cloud {
  configured = !!(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);
  app?: FirebaseApp;
  auth?: Auth;
  db?: Database;
  firestore?: Firestore;
  files?: FirebaseStorage;
  url = "";
  constructor() {
    if (!this.configured) return;
    this.app = initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      databaseURL: env.VITE_FIREBASE_DATABASE_URL,
      appId: env.VITE_FIREBASE_APP_ID,
    });
    this.auth = getAuth(this.app);
    this.db = getDatabase(this.app);
    this.firestore = getFirestore(this.app);
    this.files = getStorage(this.app);
    const region = env.VITE_FUNCTIONS_REGION || "europe-west1";
    this.url = `https://${region}-${env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/api`;
    if (env.VITE_USE_EMULATORS === "true") {
      const host = location.hostname;
      connectAuthEmulator(this.auth, `http://${host}:9099`, {
        disableWarnings: true,
      });
      connectDatabaseEmulator(this.db, host, 9000);
      connectFirestoreEmulator(this.firestore, host, 8080);
      connectStorageEmulator(this.files, host, 9199);
      this.url = `http://${host}:5001/${env.VITE_FIREBASE_PROJECT_ID}/${region}/api`;
    }
  }
  require() {
    if (!this.configured)
      throw new Error(
        "Cloud is not configured. Add the Firebase values from .env.example to enable pairing and sharing. Local saving and export are available now.",
      );
  }
  async anonymous() {
    this.require();
    await this.auth!.authStateReady();
    return this.auth!.currentUser ?? (await signInAnonymously(this.auth!)).user;
  }
  async signIn() {
    this.require();
    const user = await this.anonymous();
    if (user.isAnonymous) {
      try {
        return await linkWithPopup(user, new GoogleAuthProvider());
      } catch (error) {
        if (
          (error as { code?: string }).code !== "auth/credential-already-in-use"
        )
          throw error;
      }
    }
    return signInWithPopup(this.auth!, new GoogleAuthProvider());
  }
  userName() {
    return this.auth?.currentUser && !this.auth.currentUser.isAnonymous
      ? this.auth.currentUser.displayName ||
          this.auth.currentUser.email ||
          "Signed in"
      : null;
  }
  onAuth(callback: () => void) {
    return this.auth ? onAuthStateChanged(this.auth, callback) : () => {};
  }
  async api<T = any>(
    path: string,
    body?: unknown,
    publicRequest = false,
    method?: string,
  ): Promise<T> {
    this.require();
    const user = publicRequest ? null : await this.anonymous();
    const response = await fetch(`${this.url}/v1/${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        ...(user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error || `Cloud request failed (${response.status}).`,
      );
    return result;
  }
  async save(moment: Moment, progress?: (n: number) => void) {
    this.require();
    if (!this.userName()) await this.signIn();
    const user = this.auth!.currentUser!;
    if (moment.cloudId && moment.cloudOwner === user.uid) return moment;
    const uploadState =
      moment.cloudUpload?.owner === user.uid
        ? moment.cloudUpload
        : { id: crypto.randomUUID(), owner: user.uid, completed: [] };
    let local = { ...moment, cloudUpload: uploadState };
    await storage.update(local);
    const base = `users/${user.uid}/moments/${uploadState.id}`,
      archive = await storage.export(moment.id);
    const files: [string, Blob][] = [
      ["moment.feedback", archive],
      ["thumbnail.png", moment.thumbnail],
    ];
    if (moment.recording) files.push(["recording", moment.recording]);
    for (let i = 0; i < files.length; i++) {
      const [name, blob] = files[i];
      if (uploadState.completed.includes(name)) {
        progress?.((i + 1) / files.length);
        continue;
      }
      const target = ref(this.files!, `${base}/${name}`);
      const existing = await getMetadata(target).catch(() => null);
      if (!existing) {
        const task = uploadBytesResumable(target, blob, {
          contentType: blob.type || "application/octet-stream",
        });
        await new Promise<void>((resolve, reject) =>
          task.on(
            "state_changed",
            (s) =>
              progress?.(
                (i + s.bytesTransferred / s.totalBytes) / files.length,
              ),
            reject,
            () => resolve(),
          ),
        );
      }
      uploadState.completed.push(name);
      local = { ...local, cloudUpload: { ...uploadState } };
      await storage.update(local);
    }
    await setDoc(
      doc(this.firestore!, `users/${user.uid}/moments/${uploadState.id}`),
      {
        name: moment.name,
        created: moment.created,
        width: moment.width,
        height: moment.height,
        bytes: archive.size,
        recordingType: moment.recordingType ?? null,
        hasRecording: !!moment.recording,
        owner: user.uid,
      },
    );
    const result = {
      ...local,
      cloudId: uploadState.id,
      cloudOwner: user.uid,
      cloudUpload: undefined,
    };
    await storage.update(result);
    return result;
  }
  async syncGallery() {
    this.require();
    if (!this.userName()) await this.signIn();
    const uid = this.auth!.currentUser!.uid;
    const docs = await getDocs(
      collection(this.firestore!, `users/${uid}/moments`),
    );
    const existing = await storage.list();
    for (const item of docs.docs) {
      if (existing.some((m) => m.cloudId === item.id)) continue;
      const blob = await getBlob(
        ref(this.files!, `users/${uid}/moments/${item.id}/moment.feedback`),
      );
      const moment = await storage.import(blob);
      moment.cloudId = item.id;
      moment.cloudOwner = uid;
      await storage.update(moment);
    }
  }
  async share(moment: Moment) {
    const saved = await this.save(moment);
    if (saved.shareToken) return saved;
    const result = await this.api<{ token: string }>("shares", {
      momentId: saved.cloudId,
      allowRemix: false,
    });
    return { ...saved, shareToken: result.token };
  }
  async revoke(moment: Moment) {
    if (moment.shareToken)
      await this.api(
        `shares/${encodeURIComponent(moment.shareToken)}`,
        { revoked: true },
        false,
        "PATCH",
      );
  }
  async allowRemix(moment: Moment, allowRemix: boolean) {
    if (moment.shareToken)
      await this.api(
        `shares/${encodeURIComponent(moment.shareToken)}`,
        { allowRemix },
        false,
        "PATCH",
      );
  }
  async shared(token: string) {
    return this.api<{
      name: string;
      thumbnail: string;
      recording?: string;
      archive?: string;
      width: number;
      height: number;
      allowRemix: boolean;
    }>(`shares/${encodeURIComponent(token)}`, undefined, true);
  }
}
export const cloud = new Cloud();
