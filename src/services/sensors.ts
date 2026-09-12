import { mediaDevices } from "./devices";
import type { SensorSample } from "../core/model";
export class Sensors {
  private stream?: MediaStream;
  private audio?: AudioContext;
  private analyser?: AnalyserNode;
  private raf = 0;
  private zero?: { beta: number; gamma: number; alpha: number };
  private latest?: { beta: number; gamma: number; alpha: number };
  private lastImpulse = 0;
  private orientationEnabled = false;
  private motionEnabled = false;
  private motionVideo?: HTMLVideoElement;
  private cameraStream?: MediaStream;
  private motionPrevious?: Uint8ClampedArray;
  private motionCanvas = document.createElement("canvas");
  sensitivity = 0.65;
  onset?: () => void;
  constructor(private emit: (value: SensorSample) => void) {
    this.motionCanvas.width = 64;
    this.motionCanvas.height = 36;
  }
  async orientation() {
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
    if (typeof DeviceMotionEvent === "undefined")
      throw new Error("Motion detection is unavailable on this phone.");
    const Motion = DeviceMotionEvent as typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<string>;
    };
    if (
      Motion.requestPermission &&
      (await Motion.requestPermission()) !== "granted"
    )
      throw new Error("Motion was not enabled.");
    window.addEventListener("devicemotion", this.onMotion);
    this.motionEnabled = true;
  }
  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (!a) return;
    const magnitude = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    if (magnitude > 14 && performance.now() - this.lastImpulse > 1200) {
      this.lastImpulse = performance.now();
      this.onset?.();
    }
  };
  async microphone() {
    this.stream = await mediaDevices().getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    this.audio = new AudioContext();
    await this.audio.resume();
    this.analyser = this.audio.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.audio.createMediaStreamSource(this.stream).connect(this.analyser);
    this.loop();
  }
  async cameraMotion() {
    this.cameraStream = await mediaDevices().getUserMedia({
      video: { width: 320, height: 180, facingMode: "environment" },
      audio: false,
    });
    this.motionVideo = document.createElement("video");
    this.motionVideo.srcObject = this.cameraStream;
    this.motionVideo.muted = true;
    this.motionVideo.playsInline = true;
    await this.motionVideo.play();
    this.loop();
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
          this.onset?.();
        }
        previousLevel = previousLevel * 0.8 + audio * 0.2;
      }
      if (this.motionVideo && this.motionVideo.readyState >= 2) {
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
          motion: Math.min(1, (diff / ((pixels.length / 4) * 3 * 255)) * 6),
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
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.cameraStream?.getTracks().forEach((t) => t.stop());
    this.motionVideo?.pause();
    this.audio?.close();
    if (this.orientationEnabled)
      window.removeEventListener("deviceorientation", this.onOrientation);
    if (this.motionEnabled)
      window.removeEventListener("devicemotion", this.onMotion);
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
