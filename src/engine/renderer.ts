import {
  compileGraph,
  NODE_SPECS,
  clone,
  interpolateAutomation,
  MACROS,
  ROTATION_MACROS,
  validateScene,
  type Scene,
  type GraphNode,
  type Macros,
  type SensorSample,
  type MacroKey,
} from "../core/model";
import { GPU, type Target } from "./gpu";
import { kindNumbers } from "./shaders";
import { SourceManager } from "./source";
export type Metrics = {
  fps: number;
  frame: number;
  mean: number;
  energy: number;
  variance: number;
  clipped: number;
  black: number;
  width: number;
  height: number;
  historyWidth: number;
  memoryMB: number;
  precision: string;
  renderer: string;
};
export type BufferRecord = {
  key: string;
  width: number;
  height: number;
  float: boolean;
  data: Float32Array | Uint8Array;
};
export type EngineState = {
  frame: number;
  heads: Record<string, number>;
  front: Record<string, number>;
  pulse: number;
  rotations?: Record<string, number>;
};
type NodeMemory = { targets: Target[]; front: number; head: number };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const macroBounds = new Map(
  [...MACROS, ...ROTATION_MACROS].map((spec) => [spec.key, spec]),
);
const uniformNames: Record<string, string> = {
  mix: "mixAmount",
  cross: "crossAmount",
  mode: "mixMode",
  gamma: "gammaValue",
  black: "blackLevel",
  distance: "distanceValue",
  x: "xOffset",
  y: "yOffset",
  noise: "noiseAmount",
  invert: "invertKey",
};
export class OpticalEngine {
  lastCalibration: {
    offsetEV: number;
    mean: number;
    variance: number;
    clipped: number;
    drift: number;
    score: number;
  }[] = [];
  gpu: GPU;
  scene: Scene;
  order: GraphNode[] = [];
  memory = new Map<string, NodeMemory>();
  outputs = new Map<string, WebGLTexture>();
  sources: SourceManager;
  frame = 0;
  frozen = false;
  lost = false;
  pulse = 36;
  metrics: Metrics;
  sensor: SensorSample = {};
  sensorAt = 0;
  private smoothSensor: SensorSample = {};
  private rotations = new Map<string, number>();
  private raf = 0;
  private previous = 0;
  private reportAt = 0;
  private framesSince = 0;
  private sampleTarget: Target;
  private outputTarget?: Target;
  private ownedSources: boolean;
  private disposed = false;
  onMetrics?: (metrics: Metrics) => void;
  onLost?: () => void;
  onRestored?: () => void;
  onError?: (message: string) => void;
  constructor(
    public canvas: HTMLCanvasElement,
    scene: Scene,
    sources?: SourceManager,
    private probe = false,
  ) {
    this.scene = clone(scene);
    this.gpu = new GPU(canvas);
    this.ownedSources = !sources;
    this.sources = sources ?? new SourceManager();
    this.sources.attach(this.gpu);
    this.sampleTarget = this.gpu.target(64, 36, false);
    const g = this.gpu.gl,
      ext = g.getExtension("WEBGL_debug_renderer_info");
    this.metrics = {
      fps: 0,
      frame: 0,
      mean: 0,
      energy: 0,
      variance: 0,
      clipped: 0,
      black: 1,
      width: 0,
      height: 0,
      historyWidth: 0,
      memoryMB: 0,
      precision: this.gpu.float ? "High precision" : "Standard precision",
      renderer: ext
        ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : g.getParameter(g.RENDERER),
    };
    this.configure(scene, true);
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
  }
  private handleLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onLost?.();
  };
  private handleRestored = () => {
    try {
      this.gpu = new GPU(this.canvas);
      this.sources.attach(this.gpu);
      this.memory.clear();
      this.sampleTarget = this.gpu.target(64, 36, false);
      this.configure(this.scene, true);
      this.lost = false;
      this.start();
      this.onRestored?.();
    } catch (error) {
      this.onError?.(String(error));
    }
  };
  configure(scene: Scene, rebuild = false) {
    const candidate = validateScene(scene);
    const order = compileGraph(candidate.graph);
    const shape = (s: Scene) =>
      JSON.stringify([
        s.graph.nodes.map((n) => [n.id, n.kind]),
        s.graph.edges,
        s.simulation,
      ]);
    const changed = rebuild || shape(this.scene) !== shape(scene);
    const seedChanged =
      this.scene.graph.nodes.find((n) => n.kind === "source")?.params
        .pattern !==
      scene.graph.nodes.find((n) => n.kind === "source")?.params.pattern;
    this.scene = candidate;
    this.order = order.map((n) =>
      candidate.graph.nodes.find((node) => node.id === n.id)!,
    );
    this.sources.retainTextures(
      new Set(
        order
          .filter((n) => n.kind === "source")
          .map((n) => n.sourceId ?? scene.source),
      ),
    );
    if (seedChanged)
      this.sources.drawSeed(
        scene.graph.nodes.find((n) => n.kind === "source")?.params.pattern ?? 0,
      );
    if (!changed) return;
    let { width, height, historyWidth, memoryBudgetMB } = scene.simulation;
    if (this.probe) {
      width = 160;
      height = 90;
      historyWidth = 96;
      memoryBudgetMB = 64;
    }
    const bpp = this.gpu.float ? 8 : 4;
    const histories = order.filter((n) => n.kind === "history").length;
    const passes = order.reduce(
      (sum, n) =>
        sum +
        (["history", "output"].includes(n.kind)
          ? 0
          : NODE_SPECS[n.kind].stateful
            ? 2
            : 1),
      0,
    );
    const estimate = () =>
      (passes + histories * 2) * width * height * bpp +
      histories *
        31 *
        historyWidth *
        Math.round((historyWidth * height) / width) *
        bpp;
    while (estimate() > memoryBudgetMB * 1024 * 1024 && historyWidth > 96)
      historyWidth = Math.max(96, Math.floor((historyWidth * 0.8) / 2) * 2);
    while (estimate() > memoryBudgetMB * 1024 * 1024 && width > 320) {
      width = Math.floor((width * 0.85) / 2) * 2;
      height = Math.floor((height * 0.85) / 2) * 2;
    }
    if (estimate() > memoryBudgetMB * 1024 * 1024)
      throw new Error(
        "This patch exceeds the frame memory budget. Remove a memory path or reduce resolution.",
      );
    for (const m of this.memory.values())
      for (const t of m.targets) this.gpu.destroy(t);
    this.memory.clear();
    this.outputs.clear();
    this.canvas.width = width;
    this.canvas.height = height;
    for (const n of order) {
      if (n.kind === "output") continue;
      const count =
        n.kind === "history" ? 33 : NODE_SPECS[n.kind].stateful ? 2 : 1;
      const w = n.kind === "history" ? historyWidth : width,
        h =
          n.kind === "history"
            ? Math.round((historyWidth * height) / width)
            : height;
      const targets: Target[] = [];
      try {
        for (let i = 0; i < count; i++)
          targets.push(
            this.gpu.target(
              n.kind === "history" && i >= 31 ? width : w,
              n.kind === "history" && i >= 31 ? height : h,
            ),
          );
      } catch (error) {
        for (const t of targets) this.gpu.destroy(t);
        throw error;
      }
      this.memory.set(n.id, { targets, front: 0, head: 0 });
    }
    this.metrics = {
      ...this.metrics,
      width,
      height,
      historyWidth,
      memoryMB: Math.round(estimate() / 1024 / 1024),
    };
    this.sources.drawSeed(
      scene.graph.nodes.find((n) => n.kind === "source")?.params.pattern ?? 0,
    );
    this.reset();
  }
  reset() {
    for (const m of this.memory.values()) {
      m.front = 0;
      m.head = 0;
      for (const t of m.targets) this.gpu.clear(t);
    }
    this.frame = 0;
    this.pulse = 36;
    this.rotations.clear();
    this.outputs.clear();
  }
  start() {
    if (this.raf || this.disposed) return;
    this.previous = performance.now();
    this.reportAt = this.previous;
    this.raf = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.lost) return;
    try {
      if (
        !this.frozen &&
        now - this.previous >= 1000 / this.scene.simulation.fps - 0.75
      ) {
        this.previous = now;
        this.step();
        this.framesSince++;
      }
      if (now - this.reportAt >= 1000) {
        this.measure();
        this.metrics.fps = (this.framesSince * 1000) / (now - this.reportAt);
        this.framesSince = 0;
        this.reportAt = now;
        this.onMetrics?.({ ...this.metrics });
      }
    } catch (error) {
      this.frozen = true;
      this.onError?.(error instanceof Error ? error.message : String(error));
    }
    this.raf = requestAnimationFrame(this.tick);
  };
  effectiveMacros(): Macros {
    let m = { ...this.scene.macros };
    const time = this.frame / this.scene.simulation.fps;
    const lane = this.scene.automation;
    if (lane.playing && lane.duration > 0) {
      const values = interpolateAutomation(
        lane.points,
        lane.loop ? time % lane.duration : Math.min(time, lane.duration),
      );
      if (values) m = values;
    }
    const age = performance.now() - this.sensorAt;
    for (const key of [
      "tiltX",
      "tiltY",
      "roll",
      "audio",
      "bass",
      "treble",
      "motion",
      "color",
    ] as (keyof SensorSample)[]) {
      const desired = age < 1500 ? (this.sensor[key] ?? 0) : 0;
      this.smoothSensor[key] =
        (this.smoothSensor[key] ?? 0) * 0.88 + desired * 0.12;
    }
    m.x += (this.smoothSensor.tiltX ?? 0) * 0.5;
    m.y += (this.smoothSensor.tiltY ?? 0) * 0.5;
    m.turn += (this.smoothSensor.roll ?? 0) * 0.15;
    for (const mod of this.scene.modulations) {
      if (!mod.enabled) continue;
      let v = 0;
      if (mod.source === "sine") v = Math.sin(time * mod.rate * 2 * Math.PI);
      else if (mod.source === "triangle")
        v = 1 - 4 * Math.abs(((time * mod.rate) % 1) - 0.5);
      else v = this.smoothSensor[mod.source] ?? 0;
      m[mod.target] += v * mod.depth;
    }
    for (const k of Object.keys(m) as MacroKey[]) {
      const spec = macroBounds.get(k);
      m[k] = clamp(m[k], spec?.min ?? -1, spec?.max ?? 1);
    }
    return m;
  }
  setSensor(sample: SensorSample) {
    this.sensor = { ...this.sensor, ...sample };
    this.sensorAt = performance.now();
  }
  step() {
    const m = this.effectiveMacros(),
      textures = new Map<string, WebGLTexture>(),
      targets = new Map<string, Target>();
    // Resolve ALL history reads before writing any current frame, including cross-coupled loops.
    for (const n of this.order) {
      if (n.kind !== "history") continue;
      const mem = this.memory.get(n.id)!;
      const delay = Math.min(30, Math.round(n.params.frames + m.memory * 20));
      const index =
        delay === 0 ? 31 + mem.front : (mem.head - 1 - delay + 62) % 31;
      const t = mem.targets[index];
      textures.set(n.id, t.texture);
      targets.set(n.id, t);
    }
    for (const n of this.order) {
      if (n.kind === "history") continue;
      if (n.kind === "source") {
        const t = this.sources.texture(
          n.sourceId ?? this.scene.source,
          (this.frame * 1000) / this.scene.simulation.fps,
        );
        const target = this.memory.get(n.id)!.targets[0];
        this.gpu.draw(target, 0, [t], { level: n.params.level });
        textures.set(n.id, target.texture);
        targets.set(n.id, target);
        continue;
      }
      const sockets = NODE_SPECS[n.kind].inputs;
      const inputs = sockets.map((input) => {
        const e = this.scene.graph.edges.find(
          (e) => e.to === n.id && e.input === input,
        );
        return e ? textures.get(e.from) : undefined;
      });
      if (n.kind === "output") {
        const edge = this.scene.graph.edges.find((e) => e.to === n.id);
        this.outputTarget = edge ? targets.get(edge.from) : undefined;
        this.gpu.draw(null, 8, inputs, {
          viewExposure: n.params.exposure,
          viewGamma: n.params.gamma,
        });
        if (inputs[0]) textures.set(n.id, inputs[0]);
        continue;
      }
      const mem = this.memory.get(n.id)!;
      const next = mem.targets.length === 2 ? 1 - mem.front : 0;
      const target = mem.targets[next];
      const values: Record<string, number> = {
        uFrame: this.frame,
        uTime: this.frame / this.scene.simulation.fps,
        uSeed: this.scene.seed,
        uFeed: this.scene.feed ? 1 : 0,
        uPulse: this.pulse > 0 ? 1 : 0,
      };
      for (const [key, value] of Object.entries(n.params))
        values[uniformNames[key] ?? key] = value;
      if (n.kind === "key") values.keyMode = n.params.mode;
      if (n.kind === "screen") {
        values.hue = n.params.hue + m.color * 4.5;
        values.contrast = n.params.contrast * Math.pow(2, m.contrast * 0.18);
      }
      const linked = this.scene.linked || !n.id.endsWith("-b");
      if (n.kind === "optics" && linked) {
        values.distanceValue = n.params.distance + m.distance * 0.035;
        values.rotation = n.params.rotation + m.turn * 5;
        values.xOffset = n.params.x + m.x * 0.045;
        values.yOffset = n.params.y + m.y * 0.045;
      }
      if (n.kind === "optics" || n.kind === "screen") {
        const speed =
          n.params.rotationSpeed +
          (n.kind === "screen"
            ? m.screenSpin
            : n.id.endsWith("-b")
              ? m.cameraBSpin
              : m.cameraSpin);
        // Integrate speed, rather than multiplying elapsed time: changing a motor
        // or stopping it must preserve its current angle. Freeze never advances it.
        const angle =
          (this.rotations.get(n.id) ?? 0) + speed / this.scene.simulation.fps;
        const phase = ((((angle + 180) % 360) + 360) % 360) - 180;
        this.rotations.set(n.id, phase);
        values.rotation += phase;
      }
      if (n.kind === "camera")
        values.exposure =
          n.params.exposure +
          (this.scene.mode === "visitor"
            ? (this.scene.baseline[n.id] ?? 0)
            : 0) +
          m.balance * 0.45;
      if (n.kind === "mixer") {
        const bEdge = this.scene.graph.edges.find(
          (e) => e.to === n.id && e.input === "b",
        );
        const isSource =
          bEdge &&
          this.scene.graph.nodes.find((n) => n.id === bEdge.from)?.kind ===
            "source";
        if (!isSource) {
          values.uFeed = 1;
          values.uPulse = 0;
        }
      }
      const allInputs = [...inputs];
      while (allInputs.length < 3) allInputs.push(undefined);
      allInputs[3] = mem.targets[mem.front].texture;
      // Stateless passes must never bind their own render target, even on unused sampler units.
      if (mem.targets.length === 1) allInputs[3] = undefined;
      this.gpu.draw(target, kindNumbers[n.kind], allInputs, values);
      mem.front = next;
      textures.set(n.id, target.texture);
      targets.set(n.id, target);
    }
    for (const n of this.order) {
      if (n.kind !== "history") continue;
      const e = this.scene.graph.edges.find(
        (e) => e.to === n.id && e.input === "write",
      );
      const source = e ? textures.get(e.from) : undefined;
      const mem = this.memory.get(n.id)!;
      this.gpu.draw(mem.targets[31 + 1 - mem.front], 7, [source]);
      this.gpu.draw(mem.targets[mem.head], 7, [source]);
      mem.head = (mem.head + 1) % 31;
      mem.front = 1 - mem.front;
    }
    this.outputs = textures;
    this.frame++;
    this.pulse = Math.max(0, this.pulse - 1);
    this.metrics.frame = this.frame;
  }
  present() {
    const output = this.order.find((n) => n.kind === "output"),
      edge = this.scene.graph.edges.find((e) => e.to === output?.id);
    const n = this.order.find((n) => n.id === edge?.from);
    let tex: WebGLTexture | undefined;
    if (n) {
      const mem = this.memory.get(n.id);
      if (mem)
        tex =
          mem.targets[n.kind === "history" ? 31 + mem.front : mem.front]
            .texture;
      else if (n.kind === "source")
        tex = this.sources.texture(
          n.sourceId ?? this.scene.source,
          (this.frame * 1000) / this.scene.simulation.fps,
        );
    }
    if (tex)
      this.gpu.draw(null, 8, [tex], {
        viewExposure: output?.params.exposure ?? 0.8,
        viewGamma: output?.params.gamma ?? 1.1,
      });
  }
  measure() {
    const output = this.order.find((n) => n.kind === "output"),
      texture = output ? this.outputs.get(output.id) : undefined;
    if (!texture) return this.metrics;
    this.gpu.draw(this.sampleTarget, 7, [texture]);
    const data = this.gpu.read(this.sampleTarget) as Uint8Array;
    let sum = 0,
      energy = 0,
      sq = 0,
      clipped = 0,
      black = 0,
      count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const l =
        (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      sum += l;
      energy +=
        0.2126 * Math.pow(data[i] / 255, 2.2) +
        0.7152 * Math.pow(data[i + 1] / 255, 2.2) +
        0.0722 * Math.pow(data[i + 2] / 255, 2.2);
      sq += l * l;
      if (l > 0.96) clipped++;
      if (l < 0.008) black++;
    }
    this.metrics = {
      ...this.metrics,
      mean: sum / count,
      energy: energy / count,
      variance: sq / count - (sum / count) ** 2,
      clipped: clipped / count,
      black: black / count,
    };
    return this.metrics;
  }
  capture() {
    this.scene.feed = false;
    this.pulse = 1;
  }
  state(): EngineState {
    return {
      frame: this.frame,
      pulse: this.pulse,
      rotations: Object.fromEntries(this.rotations),
      heads: Object.fromEntries([...this.memory].map(([k, m]) => [k, m.head])),
      front: Object.fromEntries([...this.memory].map(([k, m]) => [k, m.front])),
    };
  }
  *buffers(): Generator<BufferRecord> {
    for (const [id, mem] of this.memory)
      for (let i = 0; i < mem.targets.length; i++) {
        const t = mem.targets[i];
        yield {
          key: `${id}:${i}`,
          width: t.width,
          height: t.height,
          float: t.float,
          data: this.gpu.read(t),
        };
      }
  }
  restoreBuffer(buffer: BufferRecord) {
    const split = buffer.key.lastIndexOf(":"),
      id = buffer.key.slice(0, split),
      index = Number(buffer.key.slice(split + 1)),
      target = this.memory.get(id)?.targets[index];
    if (!target) return;
    const inputFloat = buffer.data instanceof Float32Array;
    const temp = this.gpu.target(
      buffer.width,
      buffer.height,
      inputFloat && this.gpu.float,
    );
    let data = buffer.data;
    if (inputFloat && !this.gpu.float)
      data = Uint8Array.from(buffer.data, (x) =>
        Math.round(clamp(x, 0, 1) * 255),
      );
    this.gpu.upload(temp, data);
    this.gpu.draw(target, 7, [temp.texture]);
    this.gpu.destroy(temp);
  }
  restoreState(state: EngineState) {
    this.frame = state.frame;
    this.pulse = state.pulse;
    this.rotations = new Map(Object.entries(state.rotations ?? {}));
    for (const [id, mem] of this.memory) {
      const head = state.heads[id] ?? 0,
        front = state.front[id] ?? 0;
      if (
        !Number.isInteger(head) ||
        head < 0 ||
        head >= 31 ||
        !Number.isInteger(front) ||
        front < 0 ||
        front > 1
      )
        throw new Error("Invalid saved frame-history position.");
      mem.head = head;
      mem.front = front;
    }
    this.present();
  }
  async findBalance(): Promise<{
    baseline: Record<string, number>;
    useful: boolean;
  }> {
    if (this.scene.mode === "free")
      throw new Error(
        "Free mode is unassisted. Adjust screen and camera controls directly.",
      );
    const candidate = clone(this.scene);
    candidate.simulation = {
      width: 160,
      height: 90,
      fps: 60,
      historyWidth: 96,
      memoryBudgetMB: 64,
    };
    candidate.macros.balance = 0;
    candidate.modulations = [];
    candidate.automation.playing = false;
    // Measure the loop's own persistence. Continuous injection can disguise
    // extinction and would otherwise produce a reference that dies on Capture.
    candidate.feed = false;
    candidate.baseline = {};
    const canvas = document.createElement("canvas"),
      source = new SourceManager();
    const frozen = this.sources.frozenCanvas(this.scene.source);
    source.seedCanvas
      .getContext("2d")!
      .drawImage(
        frozen,
        0,
        0,
        source.seedCanvas.width,
        source.seedCanvas.height,
      );
    candidate.source = "seed";
    candidate.graph.nodes
      .filter((n) => n.kind === "source")
      .forEach((n) => (n.sourceId = "seed"));
    const probe = new OpticalEngine(canvas, candidate, source, true);
    source.seedCanvas
      .getContext("2d")!
      .drawImage(
        frozen,
        0,
        0,
        source.seedCanvas.width,
        source.seedCanvas.height,
      );
    // Preserve the visible image and delay contents in isolated, reduced-resolution buffers.
    const copies: BufferRecord[] = [];
    const small = this.gpu.target(96, 54, false);
    for (const [id, mem] of this.memory) {
      for (let i = 0; i < mem.targets.length; i++) {
        this.gpu.draw(small, 7, [mem.targets[i].texture]);
        copies.push({
          key: `${id}:${i}`,
          width: 96,
          height: 54,
          float: false,
          data: this.gpu.read(small),
        });
      }
    }
    this.gpu.destroy(small);
    const state = this.state();
    let best = Infinity,
      bestEV = 0,
      useful = false;
    const cameraIds = candidate.graph.nodes
      .filter((n) => n.kind === "camera")
      .map((n) => n.id);
    const optics = candidate.graph.nodes.filter((n) => n.kind === "optics");
    const areaGain =
      optics.reduce(
        (sum, n) =>
          sum +
          n.params.distance ** 2 *
            (1 -
              n.params.reflection +
              n.params.reflection * n.params.reflectionScale ** 2),
        0,
      ) / Math.max(1, optics.length);
    this.lastCalibration = [];
    try {
      for (const ev of [-0.08, -0.03, -0.01, 0, 0.015, 0.04, 0.1]) {
        probe.reset();
        for (const buffer of copies) probe.restoreBuffer(buffer);
        probe.restoreState(state);
        candidate.baseline = Object.fromEntries(
          cameraIds.map((id) => [
            id,
            clamp((this.scene.baseline[id] ?? 0) + ev, -3, 3),
          ]),
        );
        probe.configure(candidate);
        probe.pulse = state.frame < 40 ? 12 : 0;
        const samples: number[] = [];
        for (let i = 0; i < 96; i++) {
          probe.step();
          if (i === 24 || i === 95) {
            const sample = probe.measure();
            // Magnification changes occupied area without changing exposure.
            // Judge emitted-light energy corrected for projected area, rather than penalising
            // an expanding picture for covering more of the monitor.
            samples.push(sample.energy);
          }
        }
        const stats = probe.measure();
        const alive =
          stats.variance > 0.000002 &&
          stats.mean > 0.0004 &&
          stats.clipped < 0.5;
        const drift = Math.abs(
          Math.log((samples[1] + 0.00001) / (samples[0] + 0.00001)) -
            Math.log(Math.max(0.01, areaGain)) * 71,
        );
        const score =
          drift +
          stats.clipped * 4 +
          Math.max(0, 0.01 - stats.mean) * 5 +
          Math.abs(ev) * 0.03;
        this.lastCalibration.push({
          offsetEV: ev,
          mean: stats.mean,
          variance: stats.variance,
          clipped: stats.clipped,
          drift,
          score,
        });
        if (alive && score < best) {
          best = score;
          bestEV = ev;
          useful = true;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      probe.dispose();
      source.dispose();
      probe.gpu.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    return {
      baseline: useful
        ? Object.fromEntries(
            cameraIds.map((id) => [
              id,
              clamp((this.scene.baseline[id] ?? 0) + bestEV, -3, 3),
            ]),
          )
        : { ...this.scene.baseline },
      useful,
    };
  }
  async png(): Promise<Blob> {
    this.present();
    return new Promise((resolve, reject) =>
      this.canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not capture the canvas.")),
        "image/png",
      ),
    );
  }
  preview(width = 640) {
    this.present();
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round((width * this.canvas.height) / this.canvas.width);
    c.getContext("2d")!.drawImage(this.canvas, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleRestored,
    );
    for (const m of this.memory.values())
      for (const t of m.targets) this.gpu.destroy(t);
    this.memory.clear();
    this.gpu.destroy(this.sampleTarget);
    if (this.ownedSources) this.sources.dispose();
    this.gpu.dispose();
  }
}
