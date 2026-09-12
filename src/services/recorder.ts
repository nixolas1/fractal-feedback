import { mediaDevices } from "./devices";
export class CanvasRecorder {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private stream?: MediaStream;
  private frameTrack?: CanvasCaptureMediaStreamTrack;
  started = 0;
  mime = "";
  fps = 0;
  get active() {
    return this.recorder?.state === "recording";
  }
  async start(
    canvas: HTMLCanvasElement,
    fps: number,
    audio = false,
    manualFrames = false,
  ) {
    if (this.active) throw new Error("A recording is already in progress.");
    if (!("MediaRecorder" in window))
      throw new Error(
        "This browser does not support live recording. You can export stills and moments.",
      );
    this.mime =
      [
        "video/mp4;codecs=avc1.640034",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/mp4",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    if (!this.mime)
      throw new Error(
        "No supported recording codec is available in this browser.",
      );
    let stream = canvas.captureStream(manualFrames ? 0 : fps);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    if (manualFrames && typeof track.requestFrame === "function") {
      this.frameTrack = track;
    } else if (manualFrames) {
      stream.getTracks().forEach((t) => t.stop());
      stream = canvas.captureStream(fps);
    }
    this.stream = stream;
    try {
      if (audio) {
        const mic = await mediaDevices().getUserMedia({ audio: true });
        mic.getAudioTracks().forEach((track) => stream.addTrack(track));
      }
      this.recorder = new MediaRecorder(stream, {
        mimeType: this.mime,
        videoBitsPerSecond:
          canvas.width >= 3840 ? (fps > 30 ? 65000000 : 45000000) : 14000000,
      });
      this.chunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.recorder.start(1000);
      this.frame();
      this.fps = fps;
      this.started = Date.now();
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      this.frameTrack = undefined;
      throw error;
    }
  }
  frame() {
    if (this.active) this.frameTrack?.requestFrame();
  }
  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === "inactive") {
        reject(new Error("There is no active recording."));
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.stream?.getTracks().forEach((t) => t.stop());
        this.chunks = [];
        this.recorder = undefined;
        this.frameTrack = undefined;
        resolve(blob);
      };
      recorder.onerror = () =>
        reject(
          new Error(
            "Recording failed. Check memory and try a lower resolution.",
          ),
        );
      recorder.stop();
    });
  }
  dispose() {
    if (this.active) this.recorder?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.frameTrack = undefined;
  }
}
