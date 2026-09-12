import { useSyncExternalStore } from "react";
import { PRESETS } from "./presets";
import {
  applyBatch,
  clone,
  validateScene,
  SensorSchema,
  type ControlCommand,
  type Scene,
  type MacroKey,
  type SensorSample,
} from "./model";
import { OpticalEngine, type Metrics } from "../engine/renderer";
import { SourceManager, type SourceAsset } from "../engine/source";
import { storage, download, type Moment } from "../services/storage";
import { CanvasRecorder } from "../services/recorder";
type State = {
  scene: Scene;
  revision: number;
  frozen: boolean;
  busy: string;
  progress: number;
  error: string;
  notice: string;
  metrics: Metrics | null;
  assets: SourceAsset[];
  moments: Moment[];
  drawer:
    "sources" | "gallery" | "patch" | "phone" | "settings" | "agents" | null;
  calibrating: boolean;
  recording: boolean;
  recordingGestures: boolean;
  clean: boolean;
  lost: boolean;
};
class Studio {
  private listeners = new Set<() => void>();
  engine?: OpticalEngine;
  sources = new SourceManager();
  recorder = new CanvasRecorder();
  private calibrationEpoch = 0;
  private gestureStart = 0;
  private balanceTimer?: ReturnType<typeof setTimeout>;
  private scheduleBalance(ms: number) {
    clearTimeout(this.balanceTimer);
    this.balanceTimer = setTimeout(() => {
      if (this.engine) void this.balance();
    }, ms);
  }
  private noticeTimer?: ReturnType<typeof setTimeout>;
  state: State = {
    scene: PRESETS[1].make(),
    revision: 0,
    frozen: false,
    busy: "",
    progress: 0,
    error: "",
    notice: "",
    metrics: null,
    assets: [],
    moments: [],
    drawer: null,
    calibrating: false,
    recording: false,
    recordingGestures: false,
    clean: false,
    lost: false,
  };
  get = () => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  message(notice: string) {
    this.update({ notice });
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.update({ notice: "" }), 4500);
  }
  fail(error: unknown) {
    this.update({
      error: error instanceof Error ? error.message : String(error),
    });
  }
  mount(canvas: HTMLCanvasElement) {
    try {
      this.engine = new OpticalEngine(canvas, this.state.scene, this.sources);
      this.engine.onMetrics = (metrics) => this.update({ metrics });
      this.engine.onError = (error) => this.update({ error, frozen: true });
      this.engine.onLost = () => this.update({ lost: true });
      this.engine.onRestored = () => {
        this.update({ lost: false });
        this.message(
          "Graphics restored. Reopen your last saved moment to resume its exact frame memory.",
        );
      };
      this.engine.start();
      this.refreshGallery();
      this.scheduleBalance(1600);
    } catch (error) {
      this.fail(error);
    }
  }
  unmount() {
    clearTimeout(this.balanceTimer);
    this.engine?.dispose();
    this.engine = undefined;
    this.recorder.dispose();
    this.sources.dispose();
  }
  commit(scene: Scene) {
    if (this.state.busy)
      throw new Error("Wait for the current save or restore to finish.");
    if (scene.mode !== this.state.scene.mode) {
      this.calibrationEpoch++;
      clearTimeout(this.balanceTimer);
      this.update({ calibrating: false });
    }
    this.engine?.configure(scene);
    this.update({ scene: clone(scene), revision: this.state.revision + 1 });
  }
  commands(commands: ControlCommand[], expectedRevision = this.state.revision) {
    if (expectedRevision !== this.state.revision)
      throw new Error(
        `Scene changed. Expected revision ${expectedRevision}, current revision is ${this.state.revision}.`,
      );
    this.commit(applyBatch(this.state.scene, commands));
    return { revision: this.state.revision };
  }
  macro(key: MacroKey, value: number) {
    this.commands([{ type: "macros", values: { [key]: value } }]);
    if (this.state.recordingGestures) {
      const scene = clone(this.state.scene);
      scene.automation.points.push({
        time: (performance.now() - this.gestureStart) / 1000,
        values: { ...scene.macros },
      });
      this.update({ scene });
    }
  }
  async preset(id: string) {
    if (this.recorder.active)
      throw new Error("Stop recording before changing instruments.");
    this.calibrationEpoch++;
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const scene = preset.make();
    scene.simulation = { ...this.state.scene.simulation };
    scene.mode = this.state.scene.mode;
    scene.source = this.state.scene.source;
    scene.assets = [...this.state.scene.assets];
    if (scene.source !== "seed") scene.feed = true;
    this.commit(scene);
    this.engine?.reset();
    this.update({ frozen: false, calibrating: false });
    if (this.engine) this.engine.frozen = false;
    this.scheduleBalance(600);
  }
  freeze() {
    if (this.state.busy)
      throw new Error("Wait for the current save or restore to finish.");
    if (!this.engine) return;
    const frozen = !this.state.frozen;
    this.engine.frozen = frozen;
    this.update({ frozen });
  }
  capture() {
    this.commands([{ type: "feed", enabled: false }]);
    this.engine?.capture();
    this.message("Source captured. The image now lives in the loop.");
  }
  inject() {
    if (this.engine) this.engine.pulse = 8;
  }
  reset() {
    if (this.state.busy) return;
    this.engine?.reset();
    this.message("The loop has a new beginning.");
  }
  mode(mode: "visitor" | "free") {
    clearTimeout(this.balanceTimer);
    const scene = clone(this.state.scene);
    // Bake the held exposure reference into physical controls so switching modes preserves the image.
    if (mode === "free" && scene.mode === "visitor") {
      for (const node of scene.graph.nodes.filter((n) => n.kind === "camera"))
        node.params.exposure = Math.max(
          -3,
          Math.min(3, node.params.exposure + (scene.baseline[node.id] ?? 0)),
        );
      scene.baseline = {};
    }
    scene.mode = mode;
    this.calibrationEpoch++;
    this.commit(scene);
    this.update({
      calibrating: false,
      drawer: mode === "free" ? "patch" : null,
    });
  }
  async balance() {
    if (
      !this.engine ||
      this.state.scene.mode === "free" ||
      this.state.calibrating ||
      this.state.busy
    )
      return;
    const epoch = ++this.calibrationEpoch,
      sceneId = this.state.scene.id;
    this.update({ calibrating: true });
    try {
      const result = await this.engine.findBalance();
      if (epoch !== this.calibrationEpoch || this.state.scene.id !== sceneId)
        return;
      const scene = clone(this.state.scene);
      scene.baseline = result.baseline;
      this.commit(scene);
      this.message(
        result.useful
          ? "Balance reference found and held."
          : "No stable reference found. Try injecting light or resetting.",
      );
    } catch (error) {
      this.fail(error);
    } finally {
      if (epoch === this.calibrationEpoch) this.update({ calibrating: false });
    }
  }
  async addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.name.endsWith(".feedback")) {
        const moment = await storage.import(file);
        await this.refreshGallery();
        await this.open(moment.id);
        continue;
      }
      const asset = await this.sources.addFile(file, file.name);
      await storage.putAsset(asset);
      await this.selectAsset(asset);
    }
  }
  async addText(
    text: string,
    fontSize: number,
    textMode: "lines" | "glyphs" | "block" = "lines",
    tracking = 0,
  ) {
    const asset = await this.sources.addText(
      text,
      fontSize,
      textMode,
      tracking,
    );
    await storage.putAsset(asset);
    await this.selectAsset(asset);
  }
  async camera(stream?: MediaStream) {
    const asset = await this.sources.camera(stream);
    await this.selectAsset(asset);
    return asset;
  }
  async selectAsset(asset: SourceAsset) {
    this.calibrationEpoch++;
    const scene = clone(this.state.scene);
    scene.source = asset.id;
    scene.assets = [...new Set([...scene.assets, asset.id])];
    scene.feed = true;
    this.commit(scene);
    this.update({
      assets: [...this.sources.items.values()].map((i) => i.asset),
      calibrating: false,
    });
    if (this.engine) this.engine.pulse = 12;
    this.scheduleBalance(800);
  }
  async source(id: string) {
    if (id === "seed") {
      const scene = clone(this.state.scene);
      scene.source = "seed";
      scene.feed = true;
      this.commit(scene);
      this.scheduleBalance(800);
      return;
    }
    const asset = await storage.getAsset(id);
    if (asset && !this.sources.items.has(id)) await this.sources.load(asset);
    const live = this.sources.items.get(id)?.asset;
    if (live) await this.selectAsset(live);
  }
  sensor(sample: SensorSample) {
    this.engine?.setSensor(SensorSchema.parse(sample));
  }
  async save(recording?: Blob) {
    if (!this.engine) throw new Error("The renderer is not available.");
    if (this.state.busy)
      throw new Error("A save or restore is already in progress.");
    this.calibrationEpoch++;
    this.update({ busy: "Saving moment", progress: 0, calibrating: false });
    try {
      const moment = await storage.save(
        this.engine,
        this.state.scene,
        (progress, busy) => this.update({ progress, busy }),
        recording,
      );
      await this.refreshGallery();
      this.message("Moment saved to your gallery.");
      return moment;
    } finally {
      this.update({ busy: "", progress: 0 });
    }
  }
  async refreshGallery() {
    this.update({ moments: await storage.list() });
  }
  async open(id: string) {
    if (!this.engine) throw new Error("The renderer is not available.");
    if (this.recorder.active)
      throw new Error("Stop recording before opening another moment.");
    if (this.state.busy) throw new Error("Wait for the current operation.");
    const moment = await storage.get(id);
    if (!moment) throw new Error("Moment not found.");
    this.calibrationEpoch++;
    const scene = validateScene(moment.scene);
    this.commit(scene);
    this.update({ busy: "Opening moment", progress: 0, calibrating: false });
    try {
      for (const id of moment.assets) {
        const asset = await storage.getAsset(id);
        if (asset) await this.sources.load(asset);
      }
      await storage.restore(this.engine, moment, (progress, busy) =>
        this.update({ progress, busy }),
      );
      this.update({
        assets: [...this.sources.items.values()].map((i) => i.asset),
        drawer: null,
      });
      this.message("Moment restored. Its frame memory is intact.");
    } finally {
      this.update({ busy: "", progress: 0 });
    }
  }
  async still() {
    if (!this.engine) return;
    download(await this.engine.png(), `feedback-${Date.now()}.png`);
    this.message("Still exported.");
  }
  async export(id: string) {
    this.update({ busy: "Packing moment" });
    try {
      download(await storage.export(id), `feedback-${id.slice(0, 8)}.feedback`);
    } finally {
      this.update({ busy: "" });
    }
  }
  async remove(id: string) {
    await storage.remove(id);
    await this.refreshGallery();
  }
  async recording(audio = false) {
    if (!this.engine) return;
    if (this.recorder.active) {
      this.update({ recording: false });
      const clip = await this.recorder.stop();
      await this.save(clip);
      this.message("Recording saved with this moment.");
    } else {
      await this.recorder.start(
        this.engine.canvas,
        this.state.scene.simulation.fps,
        audio,
      );
      this.update({ recording: true });
    }
  }
  gestures() {
    const scene = clone(this.state.scene);
    if (this.state.recordingGestures) {
      scene.automation.duration =
        (performance.now() - this.gestureStart) / 1000;
      scene.automation.playing = true;
      this.update({ recordingGestures: false });
    } else {
      this.gestureStart = performance.now();
      scene.automation = {
        points: [{ time: 0, values: { ...scene.macros } }],
        duration: 0,
        loop: true,
        playing: false,
      };
      this.update({ recordingGestures: true });
    }
    this.commit(scene);
  }
  async loadScene(value: unknown) {
    const scene=validateScene(value);
    for(const id of scene.assets){if(this.sources.items.has(id))continue;const asset=await storage.getAsset(id);if(!asset)throw new Error(`Source asset ${id} is unavailable. Import it before loading this setup.`);await this.sources.load(asset);}
    this.commit(scene);
    this.update({assets:[...this.sources.items.values()].map(item=>item.asset)});
    this.engine?.reset();
  }
}
export const studio = new Studio();
export function useStudio() {
  return useSyncExternalStore(studio.subscribe, studio.get, studio.get);
}
export const attempt = (fn: () => unknown) => {
  try {
    Promise.resolve(fn()).catch((error) => studio.fail(error));
  } catch (error) {
    studio.fail(error);
  }
};
