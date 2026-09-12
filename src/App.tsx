import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Maximize2,
  Minimize2,
  Smartphone,
  Images,
  Settings2,
  Upload,
  X,
  Circle,
  Aperture,
  WandSparkles,
  BookmarkPlus,
  GitFork,
  Download,
  ChevronRight,
  Check,
  Cable,
  Eye,
} from "lucide-react";
import { studio, useStudio, attempt } from "./core/studio";
import { PRESETS } from "./core/presets";
import { MACROS } from "./core/model";
import { Mark, PresetGlyph, Slider, XYPad } from "./components/Controls";
import { Sources, Gallery, Settings } from "./components/Drawers";
const Patch = lazy(() =>
  import("./components/Patch").then((module) => ({ default: module.Patch })),
);
import { PhonePanel, Remote } from "./remote/Remote";
import { AgentPanel, attachAgentHost } from "./services/agent";
import { cloud } from "./services/cloud";
import { storage } from "./services/storage";
function ShareView({ token }: { token: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof cloud.shared>>>(),
    [error, setError] = useState("");
  useEffect(() => {
    cloud
      .shared(token)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <div className="shared-view">
      <header>
        <Mark />
        <a href="/">Feedback</a>
        <span>A moment in the light</span>
      </header>
      {error ? (
        <div className="shared-error">
          <h1>This moment is unavailable</h1>
          <p>{error}</p>
          <a href="/">Start an instrument</a>
        </div>
      ) : data ? (
        <>
          <div className="shared-art">
            {data.recording ? (
              <video
                src={data.recording}
                controls
                playsInline
                poster={data.thumbnail}
              />
            ) : (
              <img src={data.thumbnail} alt={data.name} />
            )}
          </div>
          <footer>
            <div>
              <h1>{data.name}</h1>
              <p>
                {data.width} × {data.height}
              </p>
            </div>
            {data.allowRemix && data.archive && (
              <button
                className="button primary"
                onClick={() => {
                  fetch(data.archive!)
                    .then((r) => {
                      if (!r.ok)
                        throw new Error(
                          "This link has expired. Reload the page.",
                        );
                      return r.blob();
                    })
                    .then((blob) => storage.import(blob))
                    .then((moment) => {
                      location.href = `/?moment=${moment.id}`;
                    })
                    .catch((e) => setError(e.message));
                }}
              >
                Make it your own <ChevronRight size={17} />
              </button>
            )}
          </footer>
        </>
      ) : (
        <p className="loading">Opening this moment…</p>
      )}
    </div>
  );
}
export default function App() {
  const params = new URLSearchParams(location.search);
  if (params.has("remote"))
    return (
      <Remote
        sessionId={params.get("remote")!}
        code={params.get("code") || ""}
      />
    );
  if (params.has("share")) return <ShareView token={params.get("share")!} />;
  return <Instrument />;
}
function Instrument() {
  const state = useStudio(),
    canvas = useRef<HTMLCanvasElement>(null),
    file = useRef<HTMLInputElement>(null),
    [dragging, setDragging] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const preset = PRESETS.find((p) => p.id === state.scene.preset) ?? PRESETS[1];
  useEffect(() => {
    studio.mount(canvas.current!);
    const params = new URLSearchParams(location.search);
    const moment = params.get("moment");
    if (moment) setTimeout(() => attempt(() => studio.open(moment)), 200);
    const detach = attachAgentHost();
    function key(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        attempt(() => studio.freeze());
      }
      if (e.key.toLowerCase() === "f") toggleFullscreen();
      if (e.key === "Escape") studio.update({ clean: false, drawer: null });
    }
    function full() {
      setFullscreen(!!document.fullscreenElement);
    }
    window.addEventListener("keydown", key);
    document.addEventListener("fullscreenchange", full);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("fullscreenchange", full);
      detach();
      studio.unmount();
    };
  }, []);
  function drawer(name: typeof state.drawer) {
    studio.update({ drawer: state.drawer === name ? null : name });
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else
      document.documentElement
        .requestFullscreen()
        .catch((error) => studio.fail(error));
  }
  const busy = !!state.busy;
  return (
    <main
      className={`instrument ${state.clean ? "clean" : ""} ${state.drawer ? "drawer-open" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        attempt(() => studio.addFiles(e.dataTransfer.files));
      }}
    >
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Feedback studio">
          <Mark size={32} />
          <span>Feedback</span>
        </a>
        <div className="mode-switch" aria-label="Instrument mode">
          <button
            className={state.scene.mode === "visitor" ? "active" : ""}
            onClick={() => attempt(() => studio.mode("visitor"))}
          >
            Perform
          </button>
          <button
            className={state.scene.mode === "free" ? "active" : ""}
            onClick={() => attempt(() => studio.mode("free"))}
          >
            Free mode
          </button>
        </div>
        <nav>
          <button
            className={`nav-button ${state.drawer === "sources" ? "active" : ""}`}
            onClick={() => drawer("sources")}
          >
            <Upload size={15} />
            <span>Sources</span>
          </button>
          <button
            className={`nav-button ${state.drawer === "gallery" ? "active" : ""}`}
            onClick={() => drawer("gallery")}
          >
            <Images size={16} />
            <span>Gallery</span>
          </button>
          <button
            className={`nav-button phone-nav ${state.drawer === "phone" ? "active" : ""}`}
            onClick={() => drawer("phone")}
          >
            <Smartphone size={15} />
            <span>Pair phone</span>
          </button>
          <button
            className="icon-button"
            aria-label="Studio settings"
            onClick={() => drawer("settings")}
          >
            <Settings2 size={17} />
          </button>
        </nav>
      </header>
      <div className="stage">
        <canvas
          ref={canvas}
          className="art-canvas"
          aria-label="Live optical feedback artwork"
        />
        <div className="stage-top">
          <span className="live-label">
            <i className={state.frozen ? "paused" : ""} />
            {state.frozen
              ? "Held"
              : state.recording
                ? "Recording"
                : "Live optical feedback"}
          </span>
          <div className="stage-tools">
            {state.scene.mode === "free" && (
              <button
                className="icon-button"
                title="Optical bench"
                aria-label="Open optical bench"
                onClick={() => drawer("patch")}
              >
                <GitFork size={17} />
              </button>
            )}
            <button
              className="icon-button"
              title="Export still"
              aria-label="Export still"
              onClick={() => attempt(() => studio.still())}
            >
              <Download size={17} />
            </button>
            <button
              className="icon-button"
              title="Clean view"
              aria-label="Clean performance view"
              onClick={() => studio.update({ clean: true, drawer: null })}
            >
              <Eye size={17} />
            </button>
            <button
              className="icon-button"
              title="Fullscreen (F)"
              aria-label="Fullscreen"
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          </div>
        </div>
        <aside className="preset-rail" aria-label="Instruments">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset-choice ${p.id === preset.id ? "selected" : ""}`}
              aria-pressed={p.id === preset.id}
              onClick={() => attempt(() => studio.preset(p.id))}
              title={p.description}
            >
              <PresetGlyph id={p.id} color={p.color} />
              <span>{p.name}</span>
            </button>
          ))}
        </aside>
        <div className="art-caption">
          <div>
            <span className="caption-name" style={{ color: preset.color }}>
              {preset.name}
            </span>
            <p>{preset.subtitle}</p>
          </div>
          <div className="caption-right">
            <span>
              {state.scene.feed ? "Source flowing" : "Image in the loop"}
            </span>
            <small>
              {state.metrics
                ? `${state.metrics.width} × ${state.metrics.height}  /  ${Math.round(state.metrics.fps)} fps`
                : "Bringing light into the loop"}
            </small>
          </div>
        </div>
        {state.lost && (
          <div className="canvas-message">
            <h2>The graphics connection was interrupted</h2>
            <p>
              Waiting for the browser to restore it. Your saved moments are
              safe.
            </p>
          </div>
        )}
      </div>
      <footer className="performance-shelf">
        <div className="controls-row">
          <XYPad
            values={state.scene.macros}
            onChange={(key, value) => attempt(() => studio.macro(key, value))}
          />
          <div className="macro-bank">
            {MACROS.map((m) => (
              <Slider
                key={m.key}
                label={m.label}
                value={state.scene.macros[m.key]}
                min={m.min}
                max={m.max}
                hint={m.hint}
                onChange={(v) => attempt(() => studio.macro(m.key, v))}
              />
            ))}
          </div>
        </div>
        <div className="actions-row">
          <div className="performance-actions">
            <button
              className={`button capture-button ${!state.scene.feed ? "captured" : ""}`}
              onClick={() => attempt(() => studio.capture())}
              disabled={busy}
            >
              <Aperture size={16} />
              {state.scene.feed ? "Capture source" : "Captured"}
            </button>
            <button
              className="text-button"
              onClick={() => attempt(() => studio.freeze())}
              disabled={busy}
            >
              {state.frozen ? <Play size={15} /> : <Pause size={15} />}
              <span>{state.frozen ? "Continue" : "Freeze"}</span>
            </button>
            <button
              className="text-button"
              onClick={() => attempt(() => studio.balance())}
              disabled={
                state.calibrating || state.scene.mode === "free" || busy
              }
            >
              <WandSparkles
                size={15}
                className={state.calibrating ? "spinning" : ""}
              />
              <span>
                {state.calibrating ? "Finding balance…" : "Find balance"}
              </span>
            </button>
            <button
              className="text-button"
              onClick={() => studio.reset()}
              disabled={busy}
            >
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          </div>
          <div className="save-actions">
            <button
              className={`icon-button ${state.recording ? "recording" : ""}`}
              aria-label={state.recording ? "Stop recording" : "Record video"}
              title={state.recording ? "Stop & save recording" : "Record video"}
              onClick={() => attempt(() => studio.recording())}
            >
              <Circle
                size={15}
                fill={state.recording ? "currentColor" : "none"}
              />
            </button>
            <button
              className="button save-button"
              onClick={() => attempt(() => studio.save())}
              disabled={busy}
            >
              <BookmarkPlus size={16} />
              <span>Save moment</span>
            </button>
          </div>
        </div>
        <div className="shelf-footnote">
          <span>
            {state.scene.mode === "visitor"
              ? "A held balance. Room to wander."
              : "An open apparatus. Every adjustment is yours."}
          </span>
          <button className="text-button" onClick={() => drawer("agents")}>
            <Cable size={12} /> Agent connection
          </button>
        </div>
      </footer>
      {state.clean && (
        <div className="clean-controls">
          <button
            className="button"
            onClick={() => attempt(() => studio.freeze())}
          >
            {state.frozen ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            className="button"
            onClick={() => studio.update({ clean: false })}
          >
            Show controls
          </button>
        </div>
      )}
      {state.drawer && (
        <>
          <button
            className="drawer-scrim"
            aria-label="Close panel"
            onClick={() => drawer(null)}
          />
          <aside
            className={`drawer drawer-${state.drawer}`}
            role="dialog"
            aria-label={`${state.drawer} panel`}
          >
            <button
              className="drawer-close icon-button"
              aria-label="Close panel"
              onClick={() => drawer(null)}
            >
              <X size={19} />
            </button>
            {state.drawer === "sources" ? (
              <Sources />
            ) : state.drawer === "gallery" ? (
              <Gallery />
            ) : state.drawer === "patch" ? (
              <Suspense
                fallback={<p className="loading">Opening the optical bench…</p>}
              >
                <Patch />
              </Suspense>
            ) : state.drawer === "phone" ? (
              <PhonePanel />
            ) : state.drawer === "agents" ? (
              <AgentPanel />
            ) : (
              <Settings />
            )}
          </aside>
        </>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={36} />
          <h2>Bring it into the loop</h2>
          <p>Drop an image, GIF, video, text, or saved moment.</p>
        </div>
      )}
      {state.notice && !state.error && (
        <div className="toast" role="status">
          <Check size={15} />
          {state.notice}
        </div>
      )}
      {state.error && (
        <div className="error-toast" role="alert">
          <span>{state.error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => studio.update({ error: "" })}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-overlay" role="status">
          <span className="busy-orbit" />
          <strong>{state.busy}</strong>
          <progress value={state.progress} max="1" />
          <span>The loop is held while its memory is preserved.</span>
        </div>
      )}
      <input ref={file} type="file" className="sr-only" />
    </main>
  );
}
