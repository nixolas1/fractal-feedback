import { useEffect, useRef, useState } from "react";
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
import { cloud } from "../services/cloud";
import { Sensors } from "../services/sensors";
import { MACROS, defaultMacros, type Macros } from "../core/model";
import { PRESETS } from "../core/presets";
import { Mark, XYPad, Slider } from "../components/Controls";
import { attempt, studio } from "../core/studio";
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
    [enabled, setEnabled] = useState<string[]>([]),
    [preview, setPreview] = useState<MediaStream>();
  const connection = useRef<PhoneConnection | undefined>(undefined),
    sensors = useRef<Sensors | undefined>(undefined),
    video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && preview) {
      video.current.srcObject = preview;
      video.current.play().catch(() => {});
    }
  }, [preview]);
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
        connection: () => connection.current,
        sensors: () => sensors.current,
      };
  }, []);
  async function join() {
    const c = new PhoneConnection(sessionId, code);
    connection.current = c;
    c.onStatus = setStatus;
    c.onPreview = setPreview;
    c.onScene = (state) => {
      setPreset(state.scene);
      setFrozen(state.frozen);
      setFeeding(state.feed);
      if (state.macros) setValues(state.macros);
    };
    c.onDisconnected = () => {
      setConnected(false);
      setEnabled([]);
      setPreview(undefined);
      sensors.current?.stop();
    };
    await c.join();
    sensors.current = new Sensors((sample) =>
      c.sample("sensors", sample as Record<string, number>),
    );
    sensors.current.onset = () => c.action("inject");
    setConnected(true);
  }
  async function sensor(kind: string) {
    const s = sensors.current;
    if (!s) return;
    if (kind === "tilt") await s.orientation();
    if (kind === "microphone") await s.microphone();
    if (kind === "impulse") await s.impulses();
    if (kind === "motion") await s.cameraMotion();
    if (kind === "camera") await connection.current?.camera();
    setEnabled((old) => [...old, kind]);
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
          <button className="button primary large" onClick={() => run(join)}>
            <Link2 size={18} /> Connect to the light
          </button>
        </div>
      ) : (
        <>
          <div className="remote-preview">
            <video ref={video} muted playsInline />
            <span>
              {PRESETS.find((p) => p.id === preset)?.name ?? "Live feedback"}
            </span>
          </div>
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
          <XYPad values={values} onChange={macro} />
          <div className="remote-macros">
            {MACROS.map((m) => (
              <Slider
                key={m.key}
                label={m.label}
                min={m.min}
                max={m.max}
                value={values[m.key]}
                onChange={(v) => macro(m.key, v)}
              />
            ))}
          </div>
          <div className="remote-actions">
            <button
              className="button"
              onClick={() => connection.current?.action("capture")}
            >
              <Aperture size={17} /> {feeding ? "Capture" : "Captured"}
            </button>
            <button
              className="button"
              onClick={() => connection.current?.action("freeze")}
            >
              <Pause size={17} /> {frozen ? "Continue" : "Freeze"}
            </button>
            <button
              className="button"
              onClick={() => connection.current?.action("balance")}
            >
              Find balance
            </button>
            <button
              className="button"
              onClick={() => connection.current?.action("reset")}
            >
              <RotateCcw size={16} /> Reset
            </button>
          </div>
          <section>
            <h2>Let your phone join in</h2>
            <p>Enable only what you want to use.</p>
            <div className="sensor-buttons">
              {[
                { id: "tilt", label: "Tilt", Icon: Move3D },
                { id: "microphone", label: "Sound", Icon: Mic },
                { id: "camera", label: "Live camera", Icon: Camera },
                { id: "motion", label: "Camera motion", Icon: ScanEye },
                { id: "impulse", label: "Impulse", Icon: Zap },
              ].map(({ id, label, Icon }) => (
                <button
                  className={`button ${enabled.includes(id) ? "enabled" : ""}`}
                  disabled={enabled.includes(id)}
                  key={id}
                  onClick={() => run(() => sensor(id))}
                >
                  <Icon size={17} />
                  {enabled.includes(id) ? `${label} on` : label}
                </button>
              ))}
            </div>
            {enabled.includes("tilt") && (
              <>
                <button
                  className="text-button"
                  onClick={() => sensors.current?.recenter()}
                >
                  <RefreshCcw size={14} /> Recenter tilt
                </button>
                <Slider
                  compact
                  label="Sensitivity"
                  min={0.1}
                  max={1}
                  value={sensors.current?.sensitivity ?? 0.65}
                  onChange={(v) => {
                    if (sensors.current) sensors.current.sensitivity = v;
                    setEnabled((a) => [...a]);
                  }}
                />
              </>
            )}
            <button
              className="text-button"
              onClick={() => {
                sensors.current?.stop();
                sensors.current = new Sensors((sample) =>
                  connection.current?.sample(
                    "sensors",
                    sample as Record<string, number>,
                  ),
                );
                if (sensors.current)
                  sensors.current.onset = () =>
                    connection.current?.action("inject");
                setEnabled([]);
                connection.current?.peer
                  ?.getSenders()
                  .forEach((s) => s.track?.stop());
              }}
            >
              Turn sensors off
            </button>
          </section>
          <button
            className="button release"
            onClick={() =>
              run(async () => {
                await connection.current?.release();
                sensors.current?.stop();
                setConnected(false);
                setStatus("Your turn is complete");
              })
            }
          >
            <Unlink size={16} /> Release the instrument
          </button>
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
