import { mediaDevices } from "./devices";
import { landscapeCamera } from "./camera";
import type { SensorSample } from "../core/model";
export class Sensors {
  private stream?: MediaStream;
  private audio?: AudioContext;
  private analyser?: AnalyserNode;
  private raf = 0;
  private zero?: { beta: number; gamma: number; alpha: number };
  private latest?: { beta: number; gamma: number; alpha: number };
  private lastImpulse = -Infinity;
  private gravity?: number[];
  private orientationEnabled = false;
  private motionEnabled = false;
  private motionVideo?: HTMLVideoElement;
  private cameraStream?: MediaStream;
  private cameraPending?: Promise<MediaStream>;
  private generation = 0;
  private analysisEnabled = false;
  private motionPrevious?: Uint8ClampedArray;
  private motionCanvas = document.createElement("canvas");
  sensitivity = 0.65;
  onset?: () => void;
  audioOnset?: () => void;
  constructor(private emit: (value: SensorSample) => void) {
    this.motionCanvas.width = 64;
    this.motionCanvas.height = 36;
  }
  async orientation() {
    const generation = this.generation;
    if (typeof DeviceOrientationEvent === "undefined")
      throw new Error("Orientation is unavailable. Use the touch controls.");
    const Orientation =
      DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<string>;
      };
    if (
      Orientation.requestPermission &&
      (await Orientation.requestPermission()) !== "granted"
    )
      throw new Error(
        "Orientation was not enabled. Touch controls still work.",
      );
    if (generation !== this.generation)
      throw new Error("Sensors were stopped.");
    window.addEventListener("deviceorientation", this.onOrientation);
    this.orientationEnabled = true;
    this.zero = undefined;
  }
  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    this.latest = { beta: e.beta, gamma: e.gamma, alpha: e.alpha ?? 0 };
    if (!this.zero) this.zero = { ...this.latest };
    const wrap = (x: number) => ((x + 540) % 360) - 180;
    const cap = (x: number) => Math.max(-1, Math.min(1, x * this.sensitivity));
    this.emit({
      tiltX: cap(wrap(e.gamma - this.zero.gamma) / 35),
      tiltY: cap(wrap(e.beta - this.zero.beta) / 45),
      roll: cap(wrap((e.alpha ?? 0) - this.zero.alpha) / 90),
    });
  };
  recenter() {
    if (this.latest) this.zero = { ...this.latest };
    this.emit({ tiltX: 0, tiltY: 0, roll: 0 });
  }
  async impulses() {
    const generation = this.generation;
    if (typeof DeviceMotionEvent === "undefined")
      throw new Error("Motion detection is unavailable on this phone.");
    const Motion = DeviceMotionEvent as typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<string>;
    };
    if (
      Motion.requestPermission &&
      (await Motion.requestPermission()) !== "granted"
    )
      throw new Error("Motion was not enabled. Send image now still works.");
    if (generation !== this.generation)
      throw new Error("Sensors were stopped.");
    window.addEventListener("devicemotion", this.onMotion);
    this.motionEnabled = true;
  }
  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    let magnitude: number;
    if (a && [a.x, a.y, a.z].some((v) => v !== null && Number.isFinite(v))) {
      magnitude = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    } else {
      const g = e.accelerationIncludingGravity;
      if (!g || ![g.x, g.y, g.z].some((v) => v !== null && Number.isFinite(v)))
        return;
      const values = [g.x ?? 0, g.y ?? 0, g.z ?? 0];
      this.gravity ??= values;
      magnitude = Math.hypot(...values.map((v, i) => v - this.gravity![i]));
      this.gravity = values.map((v, i) => this.gravity![i] * 0.8 + v * 0.2);
    }
    if (
      magnitude > 16 - this.sensitivity * 12 &&
      performance.now() - this.lastImpulse > 650
    ) {
      this.lastImpulse = performance.now();
      this.onset?.();
    }
  };
  async microphone() {
    const generation = this.generation;
    const stream = await mediaDevices().getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Sensors were stopped.");
    }
    this.stream = stream;
    this.audio = new AudioContext();
    await this.audio.resume();
    if (generation !== this.generation)
      throw new Error("Sensors were stopped.");
    this.analyser = this.audio.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.audio.createMediaStreamSource(this.stream).connect(this.analyser);
    this.loop();
  }
  camera(): Promise<MediaStream> {
    if (
      this.cameraStream?.getVideoTracks().some((t) => t.readyState === "live")
    )
      return Promise.resolve(this.cameraStream);
    if (this.cameraPending) return this.cameraPending;
    const generation = this.generation;
    const pending = (async () => {
      const stream = await landscapeCamera();
      const video = document.createElement("video");
      try {
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        if (generation !== this.generation)
          throw new Error("Camera was stopped.");
        if (video.videoWidth < video.videoHeight)
          throw new Error(
            "The camera is still in portrait. Hold your phone sideways and enable it again.",
          );
        this.cameraStream = stream;
        this.motionVideo = video;
        return stream;
      } catch (error) {
        video.pause();
        video.srcObject = null;
        stream.getTracks().forEach((t) => t.stop());
        throw error;
      }
    })();
    this.cameraPending = pending;
    void pending
      .finally(() => {
        if (this.cameraPending === pending) this.cameraPending = undefined;
      })
      .catch(() => {});
    return pending;
  }
  async cameraMotion() {
    const stream = await this.camera();
    this.analysisEnabled = true;
    this.loop();
    return stream;
  }
  releaseUnusedCamera() {
    if (this.analysisEnabled) return false;
    this.cameraStream?.getTracks().forEach((track) => track.stop());
    this.motionVideo?.pause();
    if (this.motionVideo) this.motionVideo.srcObject = null;
    this.cameraStream = undefined;
    this.motionVideo = undefined;
    return true;
  }
  private loop = () => {
    if (this.raf) return;
    let last = 0,
      previousLevel = 0;
    const step = (time: number) => {
      this.raf = requestAnimationFrame(step);
      if (time - last < 50) return;
      last = time;
      if (this.analyser) {
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        const avg = (a: number, b: number) =>
          data.slice(a, b).reduce((s, v) => s + v, 0) /
          Math.max(1, b - a) /
          255;
        const audio = avg(0, data.length),
          bass = avg(1, 12),
          treble = avg(64, 180);
        this.emit({ audio, bass, treble });
        if (
          audio > previousLevel * 1.6 &&
          audio > 0.18 &&
          time - this.lastImpulse > 300
        ) {
          this.lastImpulse = time;
          this.audioOnset?.();
        }
        previousLevel = previousLevel * 0.8 + audio * 0.2;
      }
      if (
        this.analysisEnabled &&
        this.motionVideo &&
        this.motionVideo.readyState >= 2
      ) {
        const ctx = this.motionCanvas.getContext("2d", {
          willReadFrequently: true,
        })!;
        ctx.drawImage(this.motionVideo, 0, 0, 64, 36);
        const pixels = ctx.getImageData(0, 0, 64, 36).data;
        let diff = 0,
          red = 0,
          green = 0,
          blue = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (this.motionPrevious)
            diff +=
              Math.abs(pixels[i] - this.motionPrevious[i]) +
              Math.abs(pixels[i + 1] - this.motionPrevious[i + 1]) +
              Math.abs(pixels[i + 2] - this.motionPrevious[i + 2]);
          red += pixels[i];
          green += pixels[i + 1];
          blue += pixels[i + 2];
        }
        this.emit({
          motion: Math.min(
            1,
            (diff / ((pixels.length / 4) * 3 * 255)) * 10 * this.sensitivity,
          ),
          color:
            (Math.atan2(Math.sqrt(3) * (green - blue), 2 * red - green - blue) /
              Math.PI) *
            ((Math.max(red, green, blue) - Math.min(red, green, blue)) /
              Math.max(1, red, green, blue)),
        });
        this.motionPrevious = new Uint8ClampedArray(pixels);
      }
    };
    this.raf = requestAnimationFrame(step);
  };
  stop() {
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.cameraStream?.getTracks().forEach((t) => t.stop());
    this.motionVideo?.pause();
    if (this.motionVideo) this.motionVideo.srcObject = null;
    this.audio?.close();
    if (this.orientationEnabled)
      window.removeEventListener("deviceorientation", this.onOrientation);
    if (this.motionEnabled)
      window.removeEventListener("devicemotion", this.onMotion);
    this.orientationEnabled = this.motionEnabled = this.analysisEnabled = false;
    this.stream = this.cameraStream = undefined;
    this.cameraPending = undefined;
    this.motionVideo = undefined;
    this.motionPrevious = undefined;
    this.analyser = undefined;
    this.audio = undefined;
    this.gravity = this.zero = this.latest = undefined;
    this.lastImpulse = -Infinity;
    this.emit({
      tiltX: 0,
      tiltY: 0,
      roll: 0,
      audio: 0,
      bass: 0,
      treble: 0,
      motion: 0,
      color: 0,
    });
  }
}
