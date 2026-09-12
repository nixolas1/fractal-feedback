import { openDB } from "idb";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { MomentManifestSchema } from "../core/protocol";
import { validateScene, type Scene } from "../core/model";
import type {
  OpticalEngine,
  EngineState,
  BufferRecord,
} from "../engine/renderer";
import type { SourceAsset } from "../engine/source";
export type StoredBuffer = Omit<BufferRecord, "data"> & {
  id: string;
  momentId: string;
  blob: Blob;
};
export type Moment = {
  id: string;
  name: string;
  created: number;
  scene: Scene;
  state: EngineState;
  buffers: string[];
  assets: string[];
  thumbnail: Blob;
  bytes: number;
  width: number;
  height: number;
  precision: string;
  recording?: Blob;
  recordingType?: string;
  cloudId?: string;
  cloudOwner?: string;
  cloudUpload?: { id: string; owner: string; completed: string[] };
  shareToken?: string;
  allowRemix?: boolean;
};
const database = openDB("feedback-studio", 1, {
  upgrade(db) {
    db.createObjectStore("moments", { keyPath: "id" });
    const buffers = db.createObjectStore("buffers", { keyPath: "id" });
    buffers.createIndex("momentId", "momentId");
    db.createObjectStore("assets", { keyPath: "id" });
    db.createObjectStore("settings");
  },
});
export const storage = {
  async list(): Promise<Moment[]> {
    return (await (await database).getAll("moments")).sort(
      (a: Moment, b: Moment) => b.created - a.created,
    );
  },
  async get(id: string): Promise<Moment | undefined> {
    return (await database).get("moments", id);
  },
  async getBuffer(id: string): Promise<StoredBuffer> {
    return (await database).get("buffers", id);
  },
  async getAsset(id: string): Promise<SourceAsset | undefined> {
    return (await database).get("assets", id);
  },
  async putAsset(asset: SourceAsset) {
    await (await database).put("assets", asset);
  },
  async update(moment: Moment) {
    await (await database).put("moments", moment);
  },
  async setting<T>(key: string): Promise<T | undefined> {
    return (await database).get("settings", key);
  },
  async setSetting(key: string, value: unknown) {
    await (await database).put("settings", value, key);
  },
  async remove(id: string) {
    const db = await database;
    const tx = db.transaction(["moments", "buffers", "assets"], "readwrite");
    const removed = (await tx.objectStore("moments").get(id)) as
      Moment | undefined;
    for (const key of await tx
      .objectStore("buffers")
      .index("momentId")
      .getAllKeys(id))
      await tx.objectStore("buffers").delete(key);
    await tx.objectStore("moments").delete(id);
    if (removed) {
      const remaining = (await tx.objectStore("moments").getAll()) as Moment[];
      const referenced = new Set(remaining.flatMap((moment) => moment.assets));
      for (const asset of removed.assets)
        if (!referenced.has(asset))
          await tx.objectStore("assets").delete(asset);
    }
    await tx.done;
  },
  async save(
    engine: OpticalEngine,
    scene: Scene,
    progress: (fraction: number, label: string) => void,
    recording?: Blob,
  ): Promise<Moment> {
    const db = await database,
      id = crypto.randomUUID(),
      frozen = engine.frozen;
    engine.frozen = true;

    const buffers: string[] = [];
    let bytes = 0;
    let resumeSources = () => {};
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (
        estimate?.quota &&
        estimate.usage &&
        estimate.quota - estimate.usage < 32 * 1024 * 1024
      )
        throw new Error(
          "Browser storage is nearly full. Export and remove an older moment first.",
        );
      progress(0, "Capturing this moment");
      const state = engine.state(),
        thumbnail = await engine.png();
      const savedScene = structuredClone(scene);
      const assets = await engine.sources.snapshotAssets(scene.assets);
      resumeSources = engine.sources.hold();
      for (const asset of assets) {
        const original = asset.id;
        asset.id = crypto.randomUUID();
        if (savedScene.source === original) savedScene.source = asset.id;
        for (const node of savedScene.graph.nodes)
          if (node.sourceId === original) node.sourceId = asset.id;
        await db.put("assets", asset);
      }
      savedScene.assets = assets.map((a) => a.id);
      const count = [...engine.memory.values()].reduce(
        (sum, m) => sum + m.targets.length,
        0,
      );
      let i = 0;
      for (const buffer of engine.buffers()) {
        const raw = new Blob([buffer.data.buffer as ArrayBuffer]);
        const blob = await compress(raw);
        const record: StoredBuffer = {
          id: `${id}/${buffer.key}`,
          momentId: id,
          key: buffer.key,
          width: buffer.width,
          height: buffer.height,
          float: buffer.float,
          blob,
        };
        await db.put("buffers", record);
        buffers.push(record.id);
        bytes += blob.size;
        progress(++i / count, `Preserving frame memory · ${i}/${count}`);
      }
      savedScene.simulation.width = engine.metrics.width;
      savedScene.simulation.height = engine.metrics.height;
      savedScene.simulation.historyWidth = engine.metrics.historyWidth;
      const moment: Moment = {
        id,
        name: scene.name,
        created: Date.now(),
        scene: savedScene,
        state,
        buffers,
        assets: assets.map((a) => a.id),
        thumbnail,
        bytes:
          bytes +
          thumbnail.size +
          (recording?.size ?? 0) +
          assets.reduce(
            (sum, a) => sum + (a.blob?.size ?? 0) + (a.lastFrame?.size ?? 0),
            0,
          ),
        width: engine.canvas.width,
        height: engine.canvas.height,
        precision: engine.metrics.precision,
        recording,
        recordingType: recording?.type,
      };
      await db.put("moments", moment);
      return moment;
    } catch (error) {
      await this.remove(id);
      throw error;
    } finally {
      engine.frozen = frozen;
      resumeSources();
    }
  },
  async restore(
    engine: OpticalEngine,
    moment: Moment,
    progress: (fraction: number, label: string) => void,
  ) {
    const frozen = engine.frozen;
    engine.frozen = true;
    try {
      for (let i = 0; i < moment.buffers.length; i++) {
        const b = await this.getBuffer(moment.buffers[i]);
        if (!b)
          throw new Error(
            "Some frame memory is missing. Import the complete moment again.",
          );
        const raw = await decompress(
          b.blob,
          b.width * b.height * 4 * (b.float ? 4 : 1),
        );
        const data = b.float ? new Float32Array(raw) : new Uint8Array(raw);
        if (data.length !== b.width * b.height * 4)
          throw new Error("A saved frame has an invalid size.");
        engine.restoreBuffer({ ...b, data });
        progress((i + 1) / moment.buffers.length, "Restoring frame memory");
      }
      engine.restoreState(moment.state);
    } finally {
      engine.frozen = frozen;
    }
  },
  async export(id: string): Promise<Blob> {
    const moment = await this.get(id);
    if (!moment) throw new Error("Moment not found.");
    const entries: Record<string, Uint8Array> = {};
    const buffers: Record<string, unknown>[] = [];
    for (const id of moment.buffers) {
      const b = await this.getBuffer(id);
      const file = `buffers/${buffers.length}.gz`;
      entries[file] = new Uint8Array(await b.blob.arrayBuffer());
      buffers.push({
        key: b.key,
        width: b.width,
        height: b.height,
        float: b.float,
        file,
      });
    }
    const assets: Record<string, unknown>[] = [];
    for (const id of moment.assets) {
      const a = await this.getAsset(id);
      if (!a) continue;
      const file = `assets/${assets.length}`;
      const { blob, lastFrame, ...meta } = a;
      if (blob) entries[file] = new Uint8Array(await blob.arrayBuffer());
      if (lastFrame)
        entries[`${file}.png`] = new Uint8Array(await lastFrame.arrayBuffer());
      assets.push({
        ...meta,
        file: blob ? file : undefined,
        mime: blob?.type,
        lastFrame: lastFrame ? `${file}.png` : undefined,
      });
    }
    entries["thumbnail.png"] = new Uint8Array(
      await moment.thumbnail.arrayBuffer(),
    );
    if (moment.recording)
      entries["recording"] = new Uint8Array(
        await moment.recording.arrayBuffer(),
      );
    const {
      thumbnail,
      recording,
      cloudId,
      cloudOwner,
      cloudUpload,
      shareToken,
      allowRemix,
      ...meta
    } = moment;
    entries["manifest.json"] = strToU8(
      JSON.stringify({
        format: "feedback-moment",
        version: 1,
        moment: meta,
        buffers,
        assets,
      }),
    );
    return new Blob(
      [zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>],
      { type: "application/x-feedback" },
    );
  },
  async import(blob: Blob): Promise<Moment> {
    if (blob.size > 1024 * 1024 * 1024)
      throw new Error("This moment is larger than 1 GB.");
    let expanded = 0;
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
      filter: (file) => {
        expanded += file.originalSize;
        if (expanded > 1024 * 1024 * 1024)
          throw new Error("This moment expands beyond the 1 GB import limit.");
        return file.originalSize < 512 * 1024 * 1024;
      },
    });
    if (!files["manifest.json"])
      throw new Error("This is not a Feedback moment.");
    const manifest = MomentManifestSchema.parse(
      JSON.parse(strFromU8(files["manifest.json"])),
    );
    if (manifest.format !== "feedback-moment" || manifest.version !== 1)
      throw new Error("Unsupported moment format.");
    const scene = validateScene(manifest.moment.scene);
    const state = manifest.moment.state as EngineState;
    if (
      !state ||
      !Number.isSafeInteger(state.frame) ||
      state.frame < 0 ||
      !state.heads ||
      !state.front
    )
      throw new Error("Invalid simulation state.");
    const id = crypto.randomUUID(),
      bufferIds: string[] = [];
    const db = await database;
    try {
      for (const b of manifest.buffers) {
        if (
          typeof b.key !== "string" ||
          !Number.isInteger(b.width) ||
          !Number.isInteger(b.height) ||
          b.width < 1 ||
          b.height < 1 ||
          b.width > 3840 ||
          b.height > 2160 ||
          !files[b.file]
        )
          throw new Error("Invalid or missing frame memory.");
        const bid = `${id}/${b.key}`;
        await db.put("buffers", {
          id: bid,
          momentId: id,
          key: b.key,
          width: b.width,
          height: b.height,
          float: !!b.float,
          blob: new Blob([files[b.file] as Uint8Array<ArrayBuffer>]),
        });
        bufferIds.push(bid);
      }
      const assetIds: string[] = [];
      for (const a of manifest.assets) {
        if ((a.file && !files[a.file]) || (a.lastFrame && !files[a.lastFrame]))
          throw new Error("A source file is missing from this moment.");
        const asset: SourceAsset = {
          id: crypto.randomUUID(),
          name: String(a.name),
          kind: a.kind,
          text: a.text,
          fontSize: a.fontSize,
          textMode: a.textMode,
          tracking: a.tracking,
          position: a.position,
          gifRemaining: a.gifRemaining,
          gifLoops: a.gifLoops,
          paused: a.paused,
          blob: a.file
            ? new Blob([files[a.file] as Uint8Array<ArrayBuffer>], {
                type: a.mime,
              })
            : undefined,
          lastFrame: a.lastFrame
            ? new Blob([files[a.lastFrame] as Uint8Array<ArrayBuffer>], {
                type: "image/png",
              })
            : undefined,
        };
        assetIds.push(asset.id);
        if (scene.source === a.id) scene.source = asset.id;
        scene.graph.nodes.forEach((n) => {
          if (n.sourceId === a.id) n.sourceId = asset.id;
        });
        await db.put("assets", asset);
      }
      scene.assets = assetIds;
      scene.id = crypto.randomUUID();
      const moment: Moment = {
        id,
        name: scene.name,
        created: Date.now(),
        scene,
        state,
        buffers: bufferIds,
        assets: assetIds,
        thumbnail: new Blob(
          [files["thumbnail.png"] as Uint8Array<ArrayBuffer>],
          { type: "image/png" },
        ),
        bytes: blob.size,
        width: scene.simulation.width,
        height: scene.simulation.height,
        precision: manifest.moment.precision,
        recording: files.recording
          ? new Blob([files.recording as Uint8Array<ArrayBuffer>], {
              type: manifest.moment.recordingType,
            })
          : undefined,
        recordingType: manifest.moment.recordingType,
      };
      await db.put("moments", moment);
      return moment;
    } catch (error) {
      await this.remove(id);
      throw error;
    }
  },
};
async function compress(blob: Blob) {
  return new Response(
    blob.stream().pipeThrough(new CompressionStream("gzip")),
  ).blob();
}
async function decompress(blob: Blob, expected: number) {
  const reader = blob
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > expected)
        throw new Error("Frame memory exceeds its declared dimensions.");
      parts.push(value);
    }
    if (length !== expected) throw new Error("Frame memory is incomplete.");
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result.buffer;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
