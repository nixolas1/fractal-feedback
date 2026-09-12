import { useEffect, useRef, useState } from "react";
import {
  Upload,
  Webcam,
  Type,
  Image,
  Play,
  Pause,
  Download,
  Trash2,
  Share2,
  Cloud,
  Check,
  Copy,
  Link2,
  Unlink,
  Activity,
  LogIn,
} from "lucide-react";
import { studio, useStudio, attempt } from "../core/studio";
import { clone } from "../core/model";
import { storage, download, type Moment } from "../services/storage";
import { Slider } from "./Controls";
import { cloud } from "../services/cloud";
import { ScreenImage } from "./ScreenImage";
export function Sources() {
  const state = useStudio(),
    file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("everything\nreturns"),
    [size, setSize] = useState(86),
    [textMode, setTextMode] = useState<"lines" | "glyphs" | "block">("lines"),
    [tracking, setTracking] = useState(0);
  const [playback, setPlayback] = useState<{
    paused: boolean;
    time: number;
    duration: number;
    live: boolean;
  } | null>(null);
  useEffect(() => {
    const t = setInterval(
      () => setPlayback(studio.sources.status(state.scene.source)),
      400,
    );
    return () => clearInterval(t);
  }, [state.scene.source]);
  return (
    <>
      <div className="drawer-intro">
        <h2>Bring something in</h2>
        <p>An image, a face, a few words. Let the loop remember.</p>
      </div>
      <ScreenImage />
      <input
        ref={file}
        className="sr-only"
        type="file"
        multiple
        accept="image/*,video/*,text/*,.md,.feedback"
        onChange={(e) => {
          if (e.target.files) attempt(() => studio.addFiles(e.target.files!));
          e.target.value = "";
        }}
      />
      <button className="upload-zone" onClick={() => file.current?.click()}>
        <Upload size={25} strokeWidth={1.3} />
        <strong>Choose a source</strong>
        <span>Images, GIFs, videos, text, or a saved moment</span>
      </button>
      <section>
        <h3>Try a study</h3>
        <div className="study-buttons">
          {[
            { file: "landscape.svg", label: "A landscape" },
            { file: "orbit.gif", label: "Moving figures" },
            { file: "passing-light.txt", label: "Passing light" },
          ].map((example) => (
            <button
              key={example.file}
              className="button"
              onClick={() =>
                attempt(async () => {
                  const response = await fetch(`/examples/${example.file}`);
                  if (!response.ok)
                    throw new Error("The example could not be opened.");
                  await studio.addFiles([
                    new File([await response.blob()], example.file, {
                      type: response.headers.get("content-type") ?? "",
                    }),
                  ]);
                })
              }
            >
              {example.label}
            </button>
          ))}
        </div>
      </section>
      <div className="source-list">
        <button
          className={`source-item ${state.scene.source === "seed" ? "selected" : ""}`}
          onClick={() => attempt(() => studio.source("seed"))}
        >
          <span className="source-icon">
            <Activity size={20} />
          </span>
          <span>
            <strong>Light seed</strong>
            <small>A little light to begin with</small>
          </span>
          {state.scene.source === "seed" && <Check size={16} />}
        </button>
        {state.assets.map((asset) => (
          <button
            className={`source-item ${state.scene.source === asset.id ? "selected" : ""}`}
            key={asset.id}
            onClick={() => attempt(() => studio.source(asset.id))}
          >
            <span className="source-icon">
              {asset.kind === "camera" ? (
                <Webcam size={19} />
              ) : asset.kind === "text" ? (
                <Type size={19} />
              ) : (
                <Image size={19} />
              )}
            </span>
            <span>
              <strong>{asset.name}</strong>
              <small>{asset.kind}</small>
            </span>
            {state.scene.source === asset.id && <Check size={16} />}
          </button>
        ))}
      </div>
      {playback &&
        Number.isFinite(playback.duration) &&
        playback.duration > 0 && (
          <div className="playback">
            <button
              className="icon-button"
              aria-label={playback.paused ? "Play source" : "Pause source"}
              onClick={() =>
                playback.paused
                  ? studio.sources.play(state.scene.source)
                  : studio.sources.pause(state.scene.source)
              }
            >
              {playback.paused ? <Play size={17} /> : <Pause size={17} />}
            </button>
            <Slider
              label="Source playback position"
              compact
              min={0}
              max={playback.duration}
              step={0.1}
              value={playback.time}
              onChange={(value) =>
                studio.sources.seek(state.scene.source, value)
              }
            />
            <small>{playback.time.toFixed(1)}s</small>
          </div>
        )}
      <div className="source-feed">
        <label className="check">
          <input
            type="checkbox"
            checked={state.scene.feed}
            onChange={(e) =>
              attempt(() =>
                studio.commands([{ type: "feed", enabled: e.target.checked }]),
              )
            }
          />{" "}
          Keep feeding the source
        </label>
        <button
          className="button"
          onClick={() => attempt(() => studio.inject())}
        >
          Inject a pulse
        </button>
      </div>
      <section>
        <h3>Live camera</h3>
        {state.assets.some(
          (a) => a.kind === "camera" && studio.sources.status(a.id)?.live,
        ) && (
          <button
            className="button"
            onClick={() =>
              attempt(async () => {
                await studio.sources.stopCameras();
                studio.message(
                  "Camera stopped. Its last image stays in the loop.",
                );
              })
            }
          >
            Stop camera
          </button>
        )}
        <p className="muted small">
          Your camera becomes a screen inside the apparatus. It stays on this
          device unless you choose to share a moment.
        </p>
        <button
          className="button"
          onClick={() => attempt(() => studio.camera())}
        >
          <Webcam size={16} /> Enable camera
        </button>
      </section>
      <section>
        <h3>Words in the loop</h3>
        <label className="field-label">
          Layout
          <select
            value={textMode}
            onChange={(e) => setTextMode(e.target.value as typeof textMode)}
          >
            <option value="lines">Centered lines</option>
            <option value="glyphs">Glyph field</option>
            <option value="block">Text block</option>
          </select>
        </label>
        <textarea
          aria-label="Text source"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={200000}
        />
        <Slider
          compact
          label="Type size"
          min={24}
          max={200}
          step={1}
          resetValue={86}
          value={size}
          onChange={setSize}
          unit="px"
        />
        <Slider
          compact
          label="Letter spacing"
          min={-2}
          max={16}
          step={0.5}
          value={tracking}
          onChange={setTracking}
          unit="px"
        />
        <button
          className="button primary"
          onClick={() =>
            attempt(() => studio.addText(text, size, textMode, tracking))
          }
        >
          <Type size={16} /> Use these words
        </button>
      </section>
    </>
  );
}
function Thumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <img src={url} alt="Saved optical artwork" loading="lazy" />;
}
function MomentCard({ moment }: { moment: Moment }) {
  const [copied, setCopied] = useState(false),
    [working, setWorking] = useState(false),
    [progress, setProgress] = useState(0);
  async function saveCloud() {
    setWorking(true);
    try {
      await cloud.save(moment, setProgress);
      await studio.refreshGallery();
      studio.message("Moment saved to your private cloud gallery.");
    } finally {
      setWorking(false);
    }
  }
  async function share() {
    setWorking(true);
    try {
      const updated = await cloud.share(moment);
      await storage.update(updated);
      await studio.refreshGallery();
      await navigator.clipboard.writeText(
        `${location.origin}/?share=${updated.shareToken}`,
      );
      setCopied(true);
      studio.message(
        "View-only link copied. Enable remixing from the share controls if needed.",
      );
    } finally {
      setWorking(false);
    }
  }
  return (
    <article className="moment-card">
      <button
        className="moment-image"
        onClick={() => attempt(() => studio.open(moment.id))}
      >
        <Thumbnail blob={moment.thumbnail} />
        <span>Resume this moment</span>
      </button>
      <div className="moment-details">
        <strong>{moment.name}</strong>
        <small>
          {new Date(moment.created).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}{" "}
          · {moment.width} × {moment.height} ·{" "}
          {(moment.bytes / 1024 / 1024).toFixed(1)} MB
        </small>
        <div className="moment-actions">
          {cloud.configured && (
            <button
              className="icon-button"
              aria-label={moment.cloudId ? "Saved to cloud" : "Save to cloud"}
              disabled={working || !!moment.cloudId}
              onClick={() => attempt(saveCloud)}
            >
              {moment.cloudId ? <Check size={15} /> : <Cloud size={15} />}
            </button>
          )}
          <button
            className="text-button"
            onClick={() => attempt(() => studio.export(moment.id))}
          >
            <Download size={14} /> Moment
          </button>
          <button
            className="icon-button"
            aria-label="Download still"
            onClick={() => download(moment.thumbnail, `${moment.name}.png`)}
          >
            <Image size={15} />
          </button>
          {moment.recording && (
            <button
              className="text-button"
              onClick={() =>
                download(
                  moment.recording!,
                  `${moment.name}.${moment.recordingType?.includes("mp4") ? "mp4" : "webm"}`,
                )
              }
            >
              <Play size={14} /> Clip
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Share moment"
            disabled={working}
            onClick={() => attempt(share)}
          >
            {copied ? <Check size={15} /> : <Share2 size={15} />}
          </button>
          <button
            className="icon-button"
            aria-label="Delete moment"
            onClick={() => attempt(() => studio.remove(moment.id))}
          >
            <Trash2 size={15} />
          </button>
        </div>
        {working && (
          <progress aria-label="Cloud upload" value={progress} max="1" />
        )}
        {moment.shareToken && (
          <div className="share-options">
            <button
              className="text-button"
              onClick={() =>
                attempt(() =>
                  navigator.clipboard.writeText(
                    `${location.origin}/?share=${moment.shareToken}`,
                  ),
                )
              }
            >
              <Copy size={13} /> Copy link
            </button>
            <button
              className="text-button"
              onClick={() =>
                attempt(async () => {
                  await cloud.revoke(moment);
                  delete moment.shareToken;
                  await storage.update(moment);
                  await studio.refreshGallery();
                })
              }
            >
              <Unlink size={13} /> Revoke
            </button>
            <label className="check small">
              <input
                type="checkbox"
                checked={moment.allowRemix ?? false}
                onChange={(e) => {
                  const allow = e.target.checked;
                  attempt(async () => {
                    await cloud.allowRemix(moment, allow);
                    await storage.update({ ...moment, allowRemix: allow });
                    await studio.refreshGallery();
                  });
                }}
              />{" "}
              Allow remix
            </label>
          </div>
        )}
      </div>
    </article>
  );
}
export function Gallery() {
  const state = useStudio(),
    [user, setUser] = useState(cloud.userName());
  useEffect(() => cloud.onAuth(() => setUser(cloud.userName())), []);
  return (
    <>
      <div className="drawer-intro">
        <h2>Held in the light</h2>
        <p>Moments to return to. Each holds its own frame memory.</p>
      </div>
      <div className="gallery-toolbar">
        <span>
          {state.moments.length}{" "}
          {state.moments.length === 1 ? "moment" : "moments"} on this device
        </span>
        <button
          className="button"
          disabled={!!state.busy}
          onClick={() => attempt(() => studio.save())}
        >
          <PlusIcon /> Save current
        </button>
      </div>
      <div className="cloud-status">
        <Cloud size={17} />
        <span>
          {user
            ? `Cloud connected as ${user}`
            : cloud.configured
              ? "Sign in to save and share online."
              : "Local gallery · cloud is not configured"}
        </span>
        {cloud.configured && user && (
          <button
            className="text-button"
            onClick={() =>
              attempt(async () => {
                await cloud.syncGallery();
                await studio.refreshGallery();
                studio.message("Cloud gallery synchronized.");
              })
            }
          >
            Sync gallery
          </button>
        )}
        {cloud.configured && !user && (
          <button
            className="text-button"
            onClick={() => attempt(() => cloud.signIn())}
          >
            <LogIn size={14} /> Sign in
          </button>
        )}
      </div>
      {state.moments.length ? (
        <div className="gallery-grid">
          {state.moments.map((m) => (
            <MomentCard key={m.id} moment={m} />
          ))}
        </div>
      ) : (
        <div className="empty-gallery">
          <span className="empty-orbit" />
          <h3>Something worth returning to</h3>
          <p>
            Save a moment when the image finds a shape you like. You can resume
            it, export it, or share it.
          </p>
          <button
            className="button primary"
            onClick={() => attempt(() => studio.save())}
          >
            Save this moment
          </button>
        </div>
      )}
    </>
  );
}
function PlusIcon() {
  return (
    <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
      +
    </span>
  );
}
export function Settings() {
  const state = useStudio(),
    scene = state.scene;
  const [audio, setAudio] = useState(false);
  function quality(width: number) {
    const next = clone(scene);
    next.simulation.width = width;
    next.simulation.memoryBudgetMB = width === 3840 ? 1536 : 384;
    next.simulation.height = Math.round((width * 9) / 16);
    studio.commit(next);
    studio.message("Resolution changed. A fresh evolution has started.");
  }
  return (
    <>
      <div className="drawer-intro">
        <h2>The viewing room</h2>
        <p>Choose the space and pace of the image.</p>
      </div>
      <label className="field-label">
        Moment name
        <input
          value={scene.name}
          maxLength={120}
          onChange={(e) =>
            attempt(() => {
              const next = clone(scene);
              next.name = e.target.value;
              studio.commit(next);
            })
          }
        />
      </label>
      <section>
        <h3>Picture</h3>
        <label className="field-label">
          Output resolution
          <select
            value={scene.simulation.width}
            disabled={state.recording}
            onChange={(e) => attempt(() => quality(+e.target.value))}
          >
            <option value="1280">1280 × 720 · light</option>
            <option value="1920">1920 × 1080 · high</option>
            <option value="2560">2560 × 1440 · very high</option>
            <option value="3840">3840 × 2160 · 4K</option>
          </select>
        </label>
        <label className="field-label">
          Feedback cadence
          <select
            value={scene.simulation.autoCadence ? "auto" : scene.simulation.fps}
            disabled={state.recording}
            onChange={(e) =>
              attempt(() => {
                const next = clone(scene);
                next.simulation.autoCadence = e.target.value === "auto";
                next.simulation.fps =
                  e.target.value === "auto"
                    ? 60
                    : (+e.target.value as 24 | 30 | 60);
                studio.commit(next);
              })
            }
          >
            <option value="auto">60 fps · auto fallback to 30</option>
            <option value="60">60 frames per second</option>
            <option value="30">30 frames per second</option>
            <option value="24">24 frames per second</option>
          </select>
        </label>
        <label className="field-label">
          Frame-history width
          <select
            value={scene.simulation.historyWidth}
            disabled={state.recording}
            onChange={(e) =>
              attempt(() => {
                const next = clone(scene);
                next.simulation.historyWidth = +e.target.value;
                studio.commit(next);
              })
            }
          >
            {[240, 480, 640, 960, 1280].map((v) => (
              <option key={v} value={v}>
                {v} pixels
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          Auto cadence keeps the selected resolution and switches to 30 fps
          after sustained slow frames. Long delays use a separate resolution.
          Very large patches may exceed the memory budget; check Actual picture
          below.
        </p>
      </section>
      <section>
        <h3>Record this performance</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={audio}
            onChange={(e) => setAudio(e.target.checked)}
            disabled={state.recording}
          />{" "}
          Include microphone audio
        </label>
        <button
          className={state.recording ? "button recording" : "button primary"}
          onClick={() => attempt(() => studio.recording(audio))}
        >
          {state.recording ? "Stop & save recording" : "Start recording"}
        </button>
        <p className="muted small">
          {state.recording
            ? `${studio.recorder.mime} · ${state.metrics?.width} × ${state.metrics?.height} · up to ${Math.min(studio.recorder.fps, state.metrics?.targetFps ?? studio.recorder.fps)} fps`
            : "Clips use the recording codec supported by this browser and are saved in your gallery."}
        </p>
      </section>
      <section>
        <h3>Instrument status</h3>
        <dl className="metrics-list">
          <dt>Actual picture</dt>
          <dd>
            {state.metrics?.width} × {state.metrics?.height}
          </dd>
          <dt>Frame memory</dt>
          <dd>
            {state.metrics?.historyWidth}px · {state.metrics?.memoryMB} MB
          </dd>
          <dt>Precision</dt>
          <dd>{state.metrics?.precision}</dd>
          <dt>Cadence</dt>
          <dd>
            {state.metrics?.fps.toFixed(1)} fps · target{" "}
            {state.metrics?.targetFps}
          </dd>
          <dt>Balance reference</dt>
          <dd>
            {state.scene.mode === "free"
              ? "Unassisted"
              : Object.values(scene.baseline).length
                ? Object.values(scene.baseline)
                    .map((v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)} EV`)
                    .join(" / ")
                : "Preset reference"}
          </dd>
        </dl>
        <p className="muted small">
          Shift-drag for fine adjustment. Double-click a performance slider to
          center it. Space freezes the image; F enters fullscreen.
        </p>
      </section>
    </>
  );
}
