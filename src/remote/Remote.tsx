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
import { cloud } from "../services/cloud";
import { Sensors } from "../services/sensors";
import { MACROS, defaultMacros, type Macros } from "../core/model";
import { PRESETS } from "../core/presets";
import { Mark, XYPad, Slider, RotationControls } from "../components/Controls";
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
  const connection = useRef<PhoneConnection | undefined>(undefined),
    sensors = useRef<Sensors | undefined>(undefined);
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
    c.onScene = (state) => {
      setPreset(state.scene);
      setFrozen(state.frozen);
      setFeeding(state.feed);
      if (state.macros) setValues({ ...defaultMacros, ...state.macros });
    };
    c.onDisconnected = () => {
      setConnected(false);
      setEnabled([]);
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
          <section>
            <h2>Let your phone join in</h2>
            <p>Enable only what you want to use.</p>
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
                  help: "Tap and allow camera access to feed your rear camera into the artwork. Hold the phone sideways for a wide view and aim at shapes, light, or movement. The camera fills the display. Use Turn sensors off to stop it.",
                },
                {
                  id: "motion",
                  label: "Camera motion",
                  Icon: ScanEye,
                  help: "Tap and allow camera access, then move the phone or wave something in front of it. Movement and color become controls for the pattern; this does not send the camera picture to the artwork. The effect depends on the instrument’s sensor mappings.",
                },
                {
                  id: "impulse",
                  label: "Impulse",
                  Icon: Zap,
                  help: "Tap and allow motion access if asked. A short, deliberate shake adds a pulse of the current source to the loop. Pause briefly between gestures. Use Turn sensors off to stop.",
                },
              ].map(({ id, label, Icon, help }) => (
                <RemoteButton
                  label={label}
                  help={help}
                  className={`button ${enabled.includes(id) ? "enabled" : ""}`}
                  disabled={enabled.includes(id)}
                  key={id}
                  onClick={() => run(() => sensor(id))}
                >
                  <Icon size={17} />
                  {enabled.includes(id) ? `${label} on` : label}
                </RemoteButton>
              ))}
            </div>
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
                <Slider
                  compact
                  label="Sensitivity"
                  min={0.1}
                  max={1}
                  hint="Adjust how strongly the pattern responds to tilting your phone; lower values make movement gentler and higher values make it stronger"
                  touchHelp
                  value={sensors.current?.sensitivity ?? 0.65}
                  onChange={(v) => {
                    if (sensors.current) sensors.current.sensitivity = v;
                    setEnabled((a) => [...a]);
                  }}
                />
              </>
            )}
            <RemoteButton
              label="Turn sensors off"
              help="Tap to stop tilt, sound, camera, camera motion, and impulse input together. The touch controls stay connected. Tap any sensor button to enable it again."
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
