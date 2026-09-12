import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import QRCode from "qrcode";
import {
  Smartphone,
  Link2,
  Unlink,
  Move3D,
  Mic,
  Camera,
  RefreshCcw,
  Pause,
  Aperture,
  RotateCcw,
  Zap,
  ScanEye,
  Copy,
} from "lucide-react";
import { hostSession, useHostSession, PhoneConnection } from "./session";
import type { VideoState } from "./video-link";
import { cloud } from "../services/cloud";
import { Sensors } from "../services/sensors";
import { ImpulseImage } from "./ImpulseImage";
import {
  MACROS,
  defaultMacros,
  type Macros,
  type SensorSample,
} from "../core/model";
import { PRESETS } from "../core/presets";
import {
  Mark,
  XYPad,
  Slider,
  RotationControls,
  DistanceControls,
} from "../components/Controls";
import { ControlHelp } from "../components/ControlHelp";
import { attempt, studio } from "../core/studio";

const MACRO_HELP: Partial<Record<keyof Macros, string>> = {
  distance:
    "Move the viewpoint closer to or farther from the image to change the scale of the repeating pattern",
  turn: "Turn the camera to change the angle of the pattern; use Camera A or Camera B rotation speed to keep it spinning",
  contrast:
    "Control how strongly light and dark details build up in the loop; lower values let the image fade and higher values help sustain it",
  balance:
    "Make the loop brighter or darker compared with its last balanced setting; use Find balance to set a new starting point",
  color: "Shift the colors of the image as it passes through the loop",
  memory:
    "Change how far back the loop looks at earlier frames; increase it for longer trails and echoes",
};

function RemoteButton({
  label,
  help,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; help: string }) {
  return (
    <div className="remote-help-control">
      <button type="button" title={help} {...props} />
      <ControlHelp label={label} description={help} />
    </div>
  );
}

export function PhonePanel() {
  const host = useHostSession(),
    [qr, setQr] = useState("");
  const url = host.id
    ? `${location.origin}/?remote=${host.id}&code=${host.code}`
    : "";
  useEffect(() => {
    if (url)
      QRCode.toDataURL(url, {
        width: 260,
        margin: 2,
        color: { dark: "#11171cff", light: "#eff3f5ff" },
      }).then(setQr);
  }, [url]);
  return (
    <>
      <div className="drawer-intro">
        <h2>Hold the instrument</h2>
        <p>
          Turn your phone into a small, expressive controller. Connect both
          devices to the same Wi-Fi for the best connection.
        </p>
      </div>
      {!cloud.configured ? (
        <div className="connection-empty">
          <Smartphone size={40} strokeWidth={1} />
          <h3>A connected installation is needed</h3>
          <p>
            Phone pairing becomes available when the installation’s Firebase
            connection is configured. The instrument and your local gallery work
            without it.
          </p>
          <a
            href="https://firebase.google.com/"
            target="_blank"
            rel="noreferrer"
            className="text-button"
          >
            Firebase setup information
          </a>
        </div>
      ) : !host.id ? (
        <button
          className="button primary"
          onClick={() => attempt(() => hostSession.start())}
        >
          <Link2 size={17} /> Open phone pairing
        </button>
      ) : (
        <>
          <div className="pair-code">
            {qr && <img src={qr} alt="Scan to control this instrument" />}
            <strong>{host.status}</strong>
            <p>
              Scan with your phone’s camera.
              <br />
              One visitor at a time.
            </p>
          </div>
          <button
            className="button"
            onClick={() =>
              attempt(async () => {
                await navigator.clipboard.writeText(url);
                studio.message("Pairing link copied.");
              })
            }
          >
            <Copy size={16} /> Copy pairing link
          </button>
          <button
            className="button"
            onClick={() => attempt(() => hostSession.refreshCode())}
          >
            <RefreshCcw size={16} /> Refresh pairing code
          </button>
          {host.controller && (
            <button
              className="button"
              onClick={() => attempt(() => hostSession.release())}
            >
              <Unlink size={16} /> Release this phone
            </button>
          )}
        </>
      )}
      <section>
        <h3>Movement, sound, and light</h3>
        <p className="muted">
          Touch controls are always available. On the phone, enable tilt,
          microphone, or camera separately. Each can become part of the loop.
        </p>
        <p className="muted small">
          If the direct connection fails, controls can continue through
          Firebase. Live video needs a direct connection or an optional relay.
        </p>
        <p className="muted small">
          The host can release a controller at any time. Camera and microphone
          access require a secure HTTPS connection on phones.
        </p>
      </section>
    </>
  );
}
export function Remote({
  sessionId,
  code,
}: {
  sessionId: string;
  code: string;
}) {
  const [frozen, setFrozen] = useState(false),
    [feeding, setFeeding] = useState(true);
  const [status, setStatus] = useState("Ready to connect"),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [values, setValues] = useState<Macros>({ ...defaultMacros }),
    [preset, setPreset] = useState("fold"),
    [enabled, setEnabled] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [videoState, setVideoState] = useState<VideoState>("connecting");
  const [camera, setCamera] = useState<MediaStream>();
  const [cameraSize, setCameraSize] = useState({ width: 0, height: 0 });
  const [landscape, setLandscape] = useState(
    () => matchMedia("(orientation: landscape)").matches,
  );
  const [readings, setReadings] = useState<SensorSample>({});
  const [impulses, setImpulses] = useState(0);
  const [imageReady, setImageReady] = useState(false);
  const impulseImage = useRef<string | undefined>(undefined);
  const preview = useRef<HTMLVideoElement>(null);
  const connection = useRef<PhoneConnection | undefined>(undefined),
    sensors = useRef<Sensors | undefined>(undefined);
  const cameraPaused = !landscape || cameraSize.width < cameraSize.height;
  useEffect(() => {
    const query = matchMedia("(orientation: landscape)");
    const update = () => setLandscape(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (preview.current) preview.current.srcObject = camera ?? null;
  }, [camera]);
  useEffect(() => {
    if (enabled.includes("camera"))
      void connection.current
        ?.pauseCamera(cameraPaused)
        .catch((e) => setError(String(e)));
  }, [enabled, cameraPaused]);
  useEffect(
    () => () => {
      connection.current?.close();
      sensors.current?.stop();
    },
    [],
  );
  async function run(fn: () => Promise<unknown> | void) {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    if (import.meta.env.DEV)
      (window as any).__feedbackRemote = {
        PhoneConnection,
        hostSession,
        studio,
        connection: () => connection.current,
        sensors: () => sensors.current,
      };
  }, []);
  async function join() {
    const c = new PhoneConnection(sessionId, code);
    connection.current = c;
    c.onStatus = setStatus;
    c.onVideoState = setVideoState;
    c.onScene = (state) => {
      setPreset(state.scene);
      setFrozen(state.frozen);
      setFeeding(state.feed);
      if (state.macros) setValues({ ...defaultMacros, ...state.macros });
    };
    c.onDisconnected = () => {
      setConnected(false);
      setEnabled([]);
      setCamera(undefined);
      sensors.current?.stop();
    };
    await c.join();
    sensors.current = new Sensors((sample) => {
      c.sample("sensors", sample as Record<string, number>);
      setReadings((previous) => ({ ...previous, ...sample }));
    });
    sensors.current.onset = sendImpulse;
    sensors.current.audioOnset = () => c.action("inject");
    setConnected(true);
  }
  async function sensor(kind: string) {
    const s = sensors.current;
    if (!s) return;
    setPending((old) => [...old, kind]);
    try {
      if (kind === "tilt") await s.orientation();
      if (kind === "microphone") await s.microphone();
      if (kind === "impulse") await s.impulses();
      if (kind === "motion") setCamera(await s.cameraMotion());
      if (kind === "camera") {
        const stream = await s.camera();
        setCamera(stream);
        try {
          await connection.current?.camera(stream);
        } catch (error) {
          await connection.current?.stopCamera();
          if (s.releaseUnusedCamera()) setCamera(undefined);
          throw error;
        }
      }
      setEnabled((old) => [...old, kind]);
    } finally {
      setPending((old) => old.filter((id) => id !== kind));
    }
  }
  function sendImpulse() {
    if (!impulseImage.current) {
      setError(
        "Choose a gallery image or camera photo and wait for Image ready before shaking.",
      );
      return;
    }
    connection.current?.action("image-inject", impulseImage.current);
    setImpulses((count) => count + 1);
  }
  function macro(key: keyof Macros, value: number) {
    setValues((v) => ({ ...v, [key]: value }));
    connection.current?.sample("macros", { [key]: value });
  }
  return (
    <main className="remote">
      <header>
        <Mark />
        <strong>Feedback</strong>
        <span>{status}</span>
      </header>
      {!connected ? (
        <div className="remote-welcome">
          <div className="remote-orbit">
            <Mark size={100} />
          </div>
          <h1>
            A little movement.
            <br />A different world.
          </h1>
          <p>
            Take a turn at the instrument.
            <br />
            Your phone becomes its controls.
            <br />
            Use the same Wi-Fi as the instrument.
          </p>
          <RemoteButton
            label="Connect to the light"
            help="Tap to take control of the paired instrument. Keep the studio open on the other screen and use the same Wi-Fi for the best connection. You can use the touch controls without enabling any sensors."
            className="button primary large"
            onClick={() => run(join)}
          >
            <Link2 size={18} /> Connect to the light
          </RemoteButton>
        </div>
      ) : (
        <>
          <p className="remote-help-intro">Tap ? beside a control for tips.</p>
          {videoState !== "connected" && (
            <section
              className="remote-video-status"
              aria-label="Video connection"
            >
              <p role="status">
                {videoState === "blocked"
                  ? "Video could not connect. Touch and motion controls still work."
                  : videoState === "retrying"
                    ? "Retrying the video connection…"
                    : "Connecting video… You can enable the camera now."}
              </p>
              {videoState === "blocked" && (
                <>
                  <p className="muted small">
                    Keep the studio open and both devices on the same Wi-Fi.
                    Guest Wi-Fi, VPNs, or browser privacy settings can block
                    direct video. Chrome on both devices is a useful check.
                  </p>
                  <p className="muted small">
                    Using Brave? In Settings → Privacy and security, check
                    WebRTC IP handling policy. Default allows direct video;
                    Disable non-proxied UDP can prevent it. A network that
                    blocks direct connections needs a video relay.
                  </p>
                </>
              )}
              <button
                className="button"
                disabled={videoState === "retrying"}
                onClick={() => run(() => connection.current?.retryVideo())}
              >
                <RefreshCcw size={16} /> Retry video connection
              </button>
            </section>
          )}
          <div className="remote-help-control">
            <select
              className="remote-preset"
              aria-label="Instrument"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                connection.current?.action("preset", e.target.value);
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.subtitle}
                </option>
              ))}
            </select>
            <ControlHelp
              label="Instrument"
              description="Tap the menu to choose a different feedback pattern. Changing instruments restarts the loop with that pattern’s settings and keeps your current image or camera source."
            />
          </div>
          <XYPad values={values} onChange={macro} touchHelp />
          <div className="remote-macros">
            {MACROS.map((m) => (
              <Slider
                key={m.key}
                label={m.label}
                min={m.min}
                max={m.max}
                value={values[m.key]}
                hint={MACRO_HELP[m.key] ?? m.hint}
                touchHelp
                onChange={(v) => macro(m.key, v)}
              />
            ))}
          </div>
          <DistanceControls
            values={values}
            dual={preset === "mutual" || preset === "kaleidoscope"}
            onChange={macro}
            touchHelp
          />
          <RotationControls
            values={values}
            dual={preset === "mutual" || preset === "kaleidoscope"}
            onChange={macro}
            touchHelp
          />
          <div className="remote-actions">
            <RemoteButton
              label="Capture"
              help="Tap to feed in a final frame and stop new source images entering the loop. The pattern keeps evolving and may fade. To start the source flowing again, choose an instrument or use Resume source on the studio."
              className="button"
              onClick={() => connection.current?.action("capture")}
            >
              <Aperture size={17} /> {feeding ? "Capture" : "Captured"}
            </RemoteButton>
            <RemoteButton
              label={frozen ? "Continue" : "Freeze"}
              help="Freeze pauses the artwork and its rotation. Tap Continue to let it move again."
              className="button"
              onClick={() => connection.current?.action("freeze")}
            >
              <Pause size={17} /> {frozen ? "Continue" : "Freeze"}
            </RemoteButton>
            <RemoteButton
              label="Find balance"
              help="Tap to find a stable brightness reference for the current pattern. Give it a moment to settle, then use Balance to brighten or darken the result. Available when the studio is in Perform mode."
              className="button"
              onClick={() => connection.current?.action("balance")}
            >
              Find balance
            </RemoteButton>
            <RemoteButton
              label="Reset"
              help="Tap to clear the loop’s accumulated image and give the pattern a fresh start. Your instrument and control settings stay in place."
              className="button"
              onClick={() => connection.current?.action("reset")}
            >
              <RotateCcw size={16} /> Reset
            </RemoteButton>
          </div>
          <ImpulseImage
            connection={connection.current!}
            onReady={(id) => {
              impulseImage.current = id;
              setImageReady(!!id);
            }}
          />
          <section>
            <h2>Let your phone join in</h2>
            <p>
              Hold the phone sideways for live camera or camera motion. Capture
              uses the full landscape picture.
            </p>
            <div className="sensor-buttons">
              {[
                {
                  id: "tilt",
                  label: "Tilt",
                  Icon: Move3D,
                  help: "Tap and allow motion access if asked. Hold the phone comfortably, then tilt or turn it to move the pattern. Use Recenter tilt to make your current position neutral, and Sensitivity to change how strongly it responds.",
                },
                {
                  id: "microphone",
                  label: "Sound",
                  Icon: Mic,
                  help: "Tap and allow microphone access. Music, your voice, and claps can shape the pattern; sharp sounds add a pulse of the source. The phone sends sound levels, not a recording. Use Turn sensors off to stop.",
                },
                {
                  id: "camera",
                  label: "Live camera",
                  Icon: Camera,
                  help: "Hold your phone sideways, then tap and allow camera access. The rear camera sends its native landscape picture, requesting 4K at 60 or 30 fps when supported. The preview shows the actual capture size. Turning upright pauses transmission; nothing is cropped. Use Turn sensors off to stop it.",
                },
                {
                  id: "motion",
                  label: "Camera motion",
                  Icon: ScanEye,
                  help: "Hold the phone sideways, allow camera access, then move it or wave in front of it. Movement changes camera distance and color shifts the palette in every built-in instrument. The motion meter shows detection. This shares the live camera when enabled; otherwise only control values are sent.",
                },
                {
                  id: "impulse",
                  label: "Impulse",
                  Icon: Zap,
                  help: "Choose a photo in Image on shake and adjust its contrast first. Enable Impulse and allow motion access if asked. Each short shake sends that image into the loop, replacing the current source. Sensitivity adjusts the shake threshold. Send image now also works without sensors.",
                },
              ].map(({ id, label, Icon, help }) => (
                <RemoteButton
                  label={label}
                  help={help}
                  className={`button ${enabled.includes(id) ? "enabled" : ""}`}
                  disabled={enabled.includes(id) || pending.includes(id)}
                  key={id}
                  onClick={() => run(() => sensor(id))}
                >
                  <Icon size={17} />
                  {pending.includes(id)
                    ? `Enabling ${label.toLowerCase()}…`
                    : enabled.includes(id)
                      ? `${label} on`
                      : label}
                </RemoteButton>
              ))}
            </div>
            {camera && (
              <div className="camera-preview">
                <video
                  ref={preview}
                  muted
                  autoPlay
                  playsInline
                  aria-label="Full camera preview"
                  onResize={(e) =>
                    setCameraSize({
                      width: e.currentTarget.videoWidth,
                      height: e.currentTarget.videoHeight,
                    })
                  }
                />
                <p role="status">
                  {cameraSize.width} × {cameraSize.height} ·{" "}
                  {Math.round(
                    camera.getVideoTracks()[0]?.getSettings().frameRate ?? 0,
                  )}{" "}
                  fps
                  {cameraPaused
                    ? " · Turn sideways to resume landscape video"
                    : enabled.includes("camera")
                      ? videoState === "connected"
                        ? " · Live landscape"
                        : " · Preview only — video is not connected"
                      : " · Local motion analysis"}
                </p>
              </div>
            )}
            {enabled.includes("motion") && (
              <label className="motion-meter">
                Camera motion detected
                <meter min={0} max={1} value={readings.motion ?? 0} />
                <output>{Math.round((readings.motion ?? 0) * 100)}%</output>
              </label>
            )}
            <RemoteButton
              label="Send image now"
              help="Override the current source with the selected photo and inject it into the loop. Uses the contrast shown in the preview. This works without motion permission. Unfreeze the artwork to see it."
              className="button"
              disabled={!imageReady}
              onClick={sendImpulse}
            >
              <Zap size={17} /> Send image now
            </RemoteButton>
            {impulses > 0 && (
              <p role="status">
                {impulses} impulse{impulses === 1 ? "" : "s"} sent
                {frozen ? " · Unfreeze to see the pulse" : ""}
              </p>
            )}
            {impulses > 0 && enabled.includes("camera") && (
              <RemoteButton
                label="Use live camera again"
                help="Replace the captured impulse image with your live landscape camera feed. The selected impulse photo stays ready for your next shake."
                className="button"
                onClick={() => connection.current?.action("camera-source")}
              >
                <Camera size={17} /> Use live camera again
              </RemoteButton>
            )}
            {enabled.includes("tilt") && (
              <>
                <RemoteButton
                  label="Recenter tilt"
                  help="Hold the phone in a comfortable position, then tap to make that position the new neutral point for tilt."
                  className="text-button"
                  onClick={() => sensors.current?.recenter()}
                >
                  <RefreshCcw size={14} /> Recenter tilt
                </RemoteButton>
              </>
            )}
            {(enabled.includes("tilt") ||
              enabled.includes("impulse") ||
              enabled.includes("motion")) && (
              <Slider
                compact
                label="Sensitivity"
                resetValue={0.65}
                min={0.1}
                max={1}
                hint="Higher sensitivity makes tilt and camera motion stronger and triggers impulses with a gentler shake"
                touchHelp
                value={sensors.current?.sensitivity ?? 0.65}
                onChange={(v) => {
                  if (sensors.current) sensors.current.sensitivity = v;
                  setEnabled((a) => [...a]);
                }}
              />
            )}
            <RemoteButton
              label="Turn sensors off"
              help="Tap to stop tilt, sound, camera, camera motion, and impulse input together. The touch controls stay connected. Tap any sensor button to enable it again."
              className="text-button"
              onClick={() =>
                run(async () => {
                  sensors.current?.stop();
                  setEnabled([]);
                  setCamera(undefined);
                  await connection.current?.stopCamera();
                })
              }
            >
              Turn sensors off
            </RemoteButton>
          </section>
          <RemoteButton
            label="Release the instrument"
            help="Tap to end your turn, disconnect this phone, and stop its sensors and camera. The studio stays open so someone else can connect."
            className="button release"
            onClick={() =>
              run(async () => {
                await connection.current?.release();
                sensors.current?.stop();
                setCamera(undefined);
                setConnected(false);
                setStatus("Your turn is complete");
              })
            }
          >
            <Unlink size={16} /> Release the instrument
          </RemoteButton>
        </>
      )}
      {error && (
        <div className="remote-error" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
