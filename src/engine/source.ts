import { mediaDevices } from "../services/devices";
import { parseGIF, decompressFrames, type ParsedFrame } from "gifuct-js";
import type { GPU } from "./gpu";
export type SourceAsset = {
  id: string;
  name: string;
  kind: "image" | "gif" | "video" | "text" | "camera";
  blob?: Blob;
  text?: string;
  position?: number;
  gifRemaining?: number;
  gifLoops?: number;
  paused?: boolean;
  fontSize?: number;
  textMode?: "lines" | "glyphs" | "block";
  tracking?: number;
  lastFrame?: Blob;
};
type Loaded = {
  asset: SourceAsset;
  canvas: HTMLCanvasElement;
  video?: HTMLVideoElement;
  stream?: MediaStream;
  image?: ImageBitmap;
  frames?: ParsedFrame[];
  gifIndex?: number;
  gifDue?: number;
  gifBefore?: ImageData;
  gifCanvas?: HTMLCanvasElement;
  gifPatch?: HTMLCanvasElement;
  gifLimit?: number;
  gifLoops?: number;
  gifClock?: number;
  gifRemaining?: number;
  url?: string;
  texture?: WebGLTexture;
  paused?: boolean;
  dirty: boolean;
  lastVideoTime?: number;
};
export class SourceManager {
  items = new Map<string, Loaded>();
  seedCanvas: HTMLCanvasElement;
  private seedTexture?: WebGLTexture;
  private gpu?: GPU;
  constructor() {
    this.seedCanvas = document.createElement("canvas");
    this.seedCanvas.width = 1280;
    this.seedCanvas.height = 720;
    this.drawSeed(0);
  }
  attach(gpu: GPU) {
    this.gpu = gpu;
    this.seedTexture = undefined;
    for (const item of this.items.values()) {
      item.texture = undefined;
      item.dirty = true;
    }
  }
  retainTextures(active: Set<string>) {
    for (const [id, item] of this.items) {
      if (!active.has(id) && item.texture) {
        this.gpu?.gl.deleteTexture(item.texture);
        item.texture = undefined;
      }
    }
  }
  drawSeed(pattern: number) {
    const c = this.seedCanvas,
      ctx = c.getContext("2d")!,
      w = c.width,
      h = c.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (pattern === 2) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#dde7e5";
      ctx.font = '500 134px "IBM Plex Sans", sans-serif';
      ctx.fillText("stay", w / 2, h / 2 + 35);
      ctx.font = '300 21px "IBM Plex Sans",sans-serif';
      ctx.fillStyle = "#94abaf";
      ctx.fillText("a little longer", w / 2, h / 2 + 85);
    } else if (pattern === 1) {
      for (let i = 0; i < 26; i++) {
        const x = w * 0.2 + i * w * 0.023;
        ctx.fillStyle = `hsl(${160 + i * 5} 60% ${45 + Math.sin(i) * 15}%)`;
        ctx.fillRect(
          x,
          h * 0.25 + Math.sin(i * 0.55) * h * 0.1,
          2 + (i % 3),
          h * 0.35,
        );
      }
    } else if (pattern === 3) {
      ctx.font = '400 90px "IBM Plex Sans",sans-serif';
      ctx.textAlign = "center";
      ctx.fillStyle = "#c3d4e0";
      ctx.fillText("光  /  lumière", w / 2, h / 2);
    } else {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(1.7, 1.7);
      // A finite, hand-drawn seed. All subsequent branching is produced by the optical loop.
      for (let i = 0; i < 9; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI * 2) / 9);
        const grad = ctx.createLinearGradient(0, -120, 0, 130);
        grad.addColorStop(0, "#263f65");
        grad.addColorStop(0.4, "#a8ded0");
        grad.addColorStop(1, "#284d8b");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3.6;
        ctx.beginPath();
        ctx.ellipse(0, -40, 26, 102, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = "#c5eee5";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 43, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#d5eae1";
      ctx.beginPath();
      ctx.arc(0, -85, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (this.gpu && this.seedTexture) {
      this.gpu.gl.deleteTexture(this.seedTexture);
      this.seedTexture = undefined;
    }
  }
  private makeCanvas() {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    return c;
  }
  async addFile(
    file: File | Blob,
    name = "Untitled source",
    id = crypto.randomUUID(),
  ): Promise<SourceAsset> {
    const ext = name.split(".").pop()?.toLowerCase();
    const mime = file.type;
    const asset: SourceAsset = { id, name, kind: "image", blob: file };
    if (mime.startsWith("text/") || ["txt", "md", "csv"].includes(ext || "")) {
      asset.kind = "text";
      asset.text = await file.text();
      if (asset.text.length > 200000)
        throw new Error(
          "This text is too long. Use a selection under 200,000 characters.",
        );
    } else if (mime === "image/gif" || ext === "gif") asset.kind = "gif";
    else if (
      mime.startsWith("video/") ||
      ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext || "")
    )
      asset.kind = "video";
    else if (
      !mime.startsWith("image/") &&
      !["png", "jpg", "jpeg", "webp", "avif", "bmp"].includes(ext || "")
    )
      throw new Error(
        "Use an image, GIF, browser-playable video, or text file.",
      );
    await this.load(asset);
    return asset;
  }
  async load(asset: SourceAsset) {
    if (this.items.has(asset.id)) this.remove(asset.id);
    const item: Loaded = { asset, canvas: this.makeCanvas(), dirty: true };
    try {
      if (asset.kind === "text") {
        this.drawText(item);
      } else if (asset.kind === "gif") {
        if (!asset.blob)
          throw new Error("The GIF file is missing. Relink its source.");
        const gif = parseGIF(await asset.blob.arrayBuffer());
        const pixels = gif.lsd.width * gif.lsd.height;
        if (pixels > 16777216)
          throw new Error(
            "This GIF is too large to decode safely. Resize it below 16 megapixels.",
          );
        if (gif.frames.filter((f) => "image" in f).length * pixels > 32000000)
          throw new Error(
            "This GIF needs too much decoded memory. Use a smaller GIF or a video.",
          );
        item.frames = decompressFrames(gif, true);
        for (const frame of item.frames) frame.pixels = [];
        if (!item.frames.length)
          throw new Error("This GIF has no decodable frames.");
        const application = gif.frames.find(
          (f) => "application" in f && f.application.id === "NETSCAPE2.0",
        );
        const blocks =
          application && "application" in application
            ? application.application.blocks
            : undefined;
        item.gifLimit = blocks
          ? blocks[1] + (blocks[2] << 8) === 0
            ? Infinity
            : 1 + blocks[1] + (blocks[2] << 8)
          : 1;
        item.gifLoops = 0;
        item.gifPatch = document.createElement("canvas");
        item.gifCanvas = document.createElement("canvas");
        item.gifCanvas.width = gif.lsd.width;
        item.gifCanvas.height = gif.lsd.height;
        item.gifIndex = -1;
        item.gifDue = 0;
        this.advanceGif(item, 0);
        for (
          let i = 0;
          i < Math.min(asset.position ?? 0, item.frames.length - 1);
          i++
        )
          this.advanceGif(item, item.gifDue!);
        item.gifLoops = asset.gifLoops ?? 0;
        item.gifClock = undefined;
        item.gifRemaining = asset.gifRemaining;
        item.paused = asset.paused ?? false;
      } else if (asset.kind === "video") {
        if (!asset.blob)
          throw new Error("The video file is missing. Relink its source.");
        item.video = document.createElement("video");
        item.url = URL.createObjectURL(asset.blob);
        item.video.src = item.url;
        item.video.muted = true;
        item.video.loop = true;
        item.video.playsInline = true;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Video decoding timed out. Try an H.264 MP4 or WebM.",
                ),
              ),
            15000,
          );
          item.video!.onloadeddata = () => {
            clearTimeout(timer);
            resolve();
          };
          item.video!.onerror = () => {
            clearTimeout(timer);
            reject(
              new Error(
                "This browser cannot decode that video. Try an H.264 MP4 or WebM.",
              ),
            );
          };
        });
        if (asset.position) {
          item.video.currentTime = Math.min(
            asset.position,
            item.video.duration || 0,
          );
          await new Promise<void>((resolve) => {
            item.video!.addEventListener("seeked", () => resolve(), {
              once: true,
            });
            setTimeout(resolve, 2000);
          });
        }
        this.paintFit(item, item.video);
        if (asset.paused) item.paused = true;
        else
          await item.video.play().catch(() => {
            item.paused = true;
          });
      } else {
        const blob = asset.kind === "camera" ? asset.lastFrame : asset.blob;
        if (!blob)
          throw new Error("This live source needs permission to reconnect.");
        item.image = await createImageBitmap(blob);
        this.paintFit(item, item.image);
        item.image.close();
        item.image = undefined;
      }
      this.items.set(asset.id, item);
    } catch (error) {
      if (item.url) URL.revokeObjectURL(item.url);
      item.image?.close();
      throw error;
    }
  }
  async addText(
    text: string,
    fontSize = 86,
    textMode: "lines" | "glyphs" | "block" = "lines",
    tracking = 0,
  ) {
    const asset: SourceAsset = {
      id: crypto.randomUUID(),
      name: text.trim().slice(0, 36) || "Text",
      kind: "text",
      text,
      fontSize,
      textMode,
      tracking,
      blob: new Blob([text], { type: "text/plain" }),
    };
    await this.load(asset);
    return asset;
  }
  private drawText(item: Loaded) {
    const c = item.canvas,
      ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#dae4e7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = item.asset.fontSize || 86;
    ctx.font = `400 ${size}px "IBM Plex Sans",sans-serif`;
    if ("letterSpacing" in ctx)
      ctx.letterSpacing = `${item.asset.tracking ?? 0}px`;
    const glyphs = (text: string) =>
      typeof Intl.Segmenter === "function"
        ? Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
              text,
            ),
            (part) => part.segment,
          )
        : Array.from(text);
    if (item.asset.textMode === "glyphs") {
      const columns = Math.max(1, Math.floor((c.width * 0.8) / (size * 1.4))),
        rows = Math.max(1, Math.floor((c.height * 0.8) / (size * 1.4)));
      glyphs(item.asset.text ?? "")
        .slice(0, columns * rows)
        .forEach((ch, index) =>
          ctx.fillText(
            ch,
            c.width * 0.1 +
              (((index % columns) + 0.5) * c.width * 0.8) / columns,
            c.height * 0.1 +
              ((Math.floor(index / columns) + 0.5) * c.height * 0.8) / rows,
          ),
        );
      item.dirty = true;
      return;
    }
    const paragraphs = (item.asset.text || "").split("\n");
    if (item.asset.textMode === "block") ctx.textAlign = "left";
    const lines: string[] = [];
    for (const para of paragraphs) {
      let line = "";
      for (const ch of glyphs(para)) {
        if (ctx.measureText(line + ch).width > c.width * 0.8 && line) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
      lines.push(line);
    }
    const shown = lines.slice(0, Math.floor(c.height / (size * 1.3)));
    shown.forEach((line, i) =>
      ctx.fillText(
        line,
        item.asset.textMode === "block" ? c.width * 0.1 : c.width / 2,
        c.height / 2 + (i - (shown.length - 1) / 2) * size * 1.3,
      ),
    );
    item.dirty = true;
  }
  private paintFit(item: Loaded, source: CanvasImageSource) {
    const ctx = item.canvas.getContext("2d")!,
      w = item.canvas.width,
      h = item.canvas.height;
    const sw =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : (source as ImageBitmap).width;
    const sh =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : (source as ImageBitmap).height;
    if (!sw || !sh) return;
    const s = Math.min(w / sw, h / sh);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
    item.dirty = true;
  }
  private advanceGif(item: Loaded, time: number) {
    if (!item.frames || item.paused || time < (item.gifDue || 0)) return;
    if (item.gifIndex === item.frames.length - 1) {
      item.gifLoops = (item.gifLoops ?? 0) + 1;
      if (item.gifLoops >= (item.gifLimit ?? Infinity)) {
        item.paused = true;
        return;
      }
    }
    const ctx = item.gifCanvas!.getContext("2d")!,
      previous = item.frames[item.gifIndex ?? -1];
    if (previous?.disposalType === 2)
      ctx.clearRect(
        previous.dims.left,
        previous.dims.top,
        previous.dims.width,
        previous.dims.height,
      );
    if (previous?.disposalType === 3 && item.gifBefore)
      ctx.putImageData(item.gifBefore, 0, 0);
    item.gifIndex = ((item.gifIndex ?? -1) + 1) % item.frames.length;
    const frame = item.frames[item.gifIndex];
    if (item.gifIndex === 0)
      ctx.clearRect(0, 0, item.gifCanvas!.width, item.gifCanvas!.height);
    item.gifBefore =
      frame.disposalType === 3
        ? ctx.getImageData(0, 0, item.gifCanvas!.width, item.gifCanvas!.height)
        : undefined;
    const patch = item.gifPatch!;
    patch.width = frame.dims.width;
    patch.height = frame.dims.height;
    patch
      .getContext("2d")!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(frame.patch),
          frame.dims.width,
          frame.dims.height,
        ),
        0,
        0,
      );
    ctx.drawImage(patch, frame.dims.left, frame.dims.top);
    item.gifDue = time + Math.max(20, frame.delay);
    this.paintFit(item, item.gifCanvas!);
    item.dirty = true;
  }
  texture(id: string, time: number): WebGLTexture | undefined {
    if (!this.gpu) return;
    const g = this.gpu.gl;
    if (id === "seed" || !this.items.has(id)) {
      if (!this.seedTexture) {
        this.seedTexture = g.createTexture()!;
        g.bindTexture(g.TEXTURE_2D, this.seedTexture);
        this.setupTexture();
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.RGBA,
          g.RGBA,
          g.UNSIGNED_BYTE,
          this.seedCanvas,
        );
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      }
      return this.seedTexture;
    }
    const item = this.items.get(id)!;
    if (item.frames) {
      if (item.gifClock === undefined) {
        item.gifDue =
          time +
          (item.gifRemaining ??
            Math.max(20, item.frames[Math.max(0, item.gifIndex ?? 0)].delay));
        item.gifRemaining = undefined;
      }
      item.gifClock = time;
      this.advanceGif(item, time);
    }
    if (
      item.video &&
      item.video.readyState >= 2 &&
      item.video.currentTime !== item.lastVideoTime
    ) {
      this.paintFit(item, item.video);
      item.lastVideoTime = item.video.currentTime;
    }
    if (!item.texture) {
      item.texture = g.createTexture()!;
      item.dirty = true;
    }
    if (item.dirty) {
      g.bindTexture(g.TEXTURE_2D, item.texture);
      this.setupTexture();
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA,
        g.RGBA,
        g.UNSIGNED_BYTE,
        item.canvas,
      );
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      item.dirty = false;
    }
    return item.texture;
  }
  private setupTexture() {
    const g = this.gpu!.gl;
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  }
  async stopCameras() {
    for (const item of this.items.values()) {
      if (!item.stream) continue;
      item.stream.getTracks().forEach((track) => track.stop());
      item.video?.pause();
      if (item.video) item.video.srcObject = null;
      item.video = undefined;
      item.stream = undefined;
      item.asset.lastFrame = await new Promise<Blob>((resolve, reject) =>
        item.canvas.toBlob((blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not hold the camera frame.")),
        ),
      );
      item.dirty = true;
    }
  }
  async camera(stream?: MediaStream, id = crypto.randomUUID()) {
    await this.stopCameras();
    const media =
      stream ??
      (await mediaDevices().getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }));
    const asset: SourceAsset = {
      id,
      name: stream ? "Phone camera" : "Camera",
      kind: "camera",
    };
    const item: Loaded = {
      asset,
      canvas: this.makeCanvas(),
      stream: media,
      video: document.createElement("video"),
      dirty: true,
    };
    item.video!.muted = true;
    item.video!.playsInline = true;
    item.video!.srcObject = media;
    await item.video!.play();
    this.items.set(id, item);
    return asset;
  }
  status(id: string) {
    const i = this.items.get(id);
    return i
      ? {
          paused: i.video?.paused ?? i.paused ?? false,
          time:
            i.video?.currentTime ??
            (i.frames
              ?.slice(0, i.gifIndex ?? 0)
              .reduce((sum, f) => sum + Math.max(20, f.delay), 0) ?? 0) / 1000,
          duration:
            (i.video
              ? Number.isFinite(i.video.duration)
                ? i.video.duration
                : i.video.seekable.length
                  ? i.video.seekable.end(i.video.seekable.length - 1)
                  : 0
              : undefined) ??
            (i.frames?.reduce((sum, f) => sum + Math.max(20, f.delay), 0) ??
              0) / 1000,
          live: !!i.stream,
        }
      : null;
  }
  play(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.frames && item.gifLoops! >= (item.gifLimit ?? Infinity)) {
      item.gifLoops = 0;
      item.gifIndex = -1;
    }
    item.gifClock = undefined;
    item.paused = false;
    item.video?.play().catch(() => {
      item.paused = true;
    });
  }
  pause(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    item.gifRemaining = Math.max(0, (item.gifDue ?? 0) - (item.gifClock ?? 0));
    item.paused = true;
    item.video?.pause();
  }
  seek(id: string, time: number) {
    const item = this.items.get(id);
    if (!item) return;
    const video = item.video;
    if (video)
      video.currentTime = Math.max(
        0,
        Math.min(time, Number.isFinite(video.duration) ? video.duration : time),
      );
    if (item.frames) {
      const paused = item.paused;
      item.paused = false;
      item.gifIndex = -1;
      item.gifLoops = 0;
      item.gifDue = 0;
      let at = 0;
      for (const frame of item.frames) {
        this.advanceGif(item, at);
        at += Math.max(20, frame.delay);
        if (at > time * 1000) break;
      }
      item.gifRemaining = Math.max(0, at - time * 1000);
      item.gifClock = undefined;
      item.paused = paused;
    }
  }
  hold() {
    const playing = [...this.items.values()].filter(
      (i) => i.video && !i.video.paused,
    );
    playing.forEach((i) => i.video!.pause());
    return () => playing.forEach((i) => i.video?.play().catch(() => {}));
  }
  async snapshotAssets(ids: string[]): Promise<SourceAsset[]> {
    const assets: SourceAsset[] = [];
    for (const id of ids) {
      const i = this.items.get(id);
      if (!i) continue;
      const asset = {
        ...i.asset,
        position: i.lastVideoTime ?? i.video?.currentTime ?? i.gifIndex ?? 0,
        gifRemaining: i.frames
          ? Math.max(0, (i.gifDue ?? 0) - (i.gifClock ?? 0))
          : undefined,
        gifLoops: i.gifLoops,
        paused: i.video?.paused ?? i.paused ?? false,
      };
      if (i.asset.kind === "camera")
        asset.lastFrame = await new Promise<Blob>((resolve, reject) =>
          i.canvas.toBlob(
            (b) =>
              b
                ? resolve(b)
                : reject(new Error("Could not capture camera frame.")),
            "image/png",
          ),
        );
      assets.push(asset);
    }
    return assets;
  }
  frozenCanvas(id: string) {
    const source = this.items.get(id)?.canvas ?? this.seedCanvas;
    const c = document.createElement("canvas");
    c.width = source.width;
    c.height = source.height;
    c.getContext("2d")!.drawImage(source, 0, 0);
    return c;
  }
  remove(id: string) {
    const i = this.items.get(id);
    if (!i) return;
    i.stream?.getTracks().forEach((t) => t.stop());
    i.video?.pause();
    if (i.url) URL.revokeObjectURL(i.url);
    i.image?.close();
    if (i.texture) this.gpu?.gl.deleteTexture(i.texture);
    this.items.delete(id);
  }
  dispose() {
    for (const id of this.items.keys()) this.remove(id);
    if (this.seedTexture) this.gpu?.gl.deleteTexture(this.seedTexture);
  }
}
