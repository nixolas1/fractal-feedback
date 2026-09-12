import { useRef, useState, useEffect, type PointerEvent } from "react";
import { ROTATION_MACROS, type MacroKey, type Macros } from "../core/model";
import { ControlHelp } from "./ControlHelp";
export function XYPad({
  values,
  onChange,
  touchHelp = false,
}: {
  values: Pick<Macros, "x" | "y">;
  onChange: (key: MacroKey, value: number) => void;
  touchHelp?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function move(e: PointerEvent<HTMLDivElement>) {
    if (
      e.type !== "pointerdown" &&
      !e.currentTarget.hasPointerCapture(e.pointerId)
    )
      return;
    const rect = ref.current!.getBoundingClientRect();
    onChange(
      "x",
      Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1)),
    );
    onChange(
      "y",
      Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1)),
    );
  }
  return (
    <div className="xy-wrap">
      <div
        ref={ref}
        className="xy-pad"
        role="group"
        aria-label="Camera position"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
        onDoubleClick={() => {
          onChange("x", 0);
          onChange("y", 0);
        }}
      >
        <span className="xy-axis x" />
        <span className="xy-axis y" />
        <span className="xy-ring" />
        <i
          style={{
            left: `${(values.x + 1) * 50}%`,
            top: `${(values.y + 1) * 50}%`,
          }}
        />
        <input
          aria-label="Camera horizontal position"
          className="sr-only"
          type="range"
          min="-1"
          max="1"
          step=".005"
          value={values.x}
          onChange={(e) => onChange("x", +e.target.value)}
        />
        <input
          aria-label="Camera vertical position"
          className="sr-only"
          type="range"
          min="-1"
          max="1"
          step=".005"
          value={values.y}
          onChange={(e) => onChange("y", +e.target.value)}
        />
      </div>
      <span className="xy-caption">
        Move the camera
        {touchHelp && (
          <ControlHelp
            label="Move the camera"
            description="Drag your finger around the pad to move the viewpoint left, right, up, or down inside the artwork. Double-tap the pad to return to the center."
          />
        )}
      </span>
    </div>
  );
}
export function Slider({
  label,
  value,
  min = -1,
  max = 1,
  step = 0.001,
  onChange,
  hint,
  unit = "",
  compact = false,
  touchHelp = false,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  hint?: string;
  unit?: string;
  compact?: boolean;
  touchHelp?: boolean;
}) {
  const Container = touchHelp ? "div" : "label";
  const initial = useRef<{ x: number; value: number } | null>(null);
  const decimals = Math.min(7, Math.max(0, -Math.floor(Math.log10(step))));
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(Number(value.toFixed(decimals))));
  }, [value, editing, decimals]);
  function commitNumber() {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next))
      onChange(
        Math.max(min, Math.min(max, step === 1 ? Math.round(next) : next)),
      );
    setEditing(false);
  }
  return (
    <Container
      className={`slider-control ${compact ? "compact" : ""}`}
      title={hint}
    >
      <span className="slider-heading">
        <span className={touchHelp ? "slider-label-help" : undefined}>
          {label}
          {touchHelp && hint && (
            <ControlHelp
              label={label}
              description={`${hint}. Drag the slider, or tap the number to enter a precise value.`}
            />
          )}
        </span>
        <input
          aria-label={`${label} value`}
          className="value-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onFocus={() => setEditing(true)}
          onBlur={commitNumber}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(String(value));
              setEditing(false);
            }
          }}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
        <span className="unit">{unit}</span>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={
          {
            "--fill": `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
        onChange={(e) => {
          if (!initial.current) onChange(+e.target.value);
        }}
        onDoubleClick={() => onChange(Math.max(min, Math.min(max, 0)))}
        onPointerDown={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
            initial.current = { x: e.clientX, value };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (initial.current && step !== 1)
            onChange(
              Math.max(
                min,
                Math.min(
                  max,
                  initial.current.value +
                    (((e.clientX - initial.current.x) * (max - min)) /
                      e.currentTarget.clientWidth) *
                      0.1,
                ),
              ),
            );
        }}
        onPointerUp={() => {
          initial.current = null;
        }}
        onPointerCancel={() => {
          initial.current = null;
        }}
      />
      <span className="range-ticks">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </Container>
  );
}
export function RotationControls({
  values,
  dual,
  onChange,
  touchHelp = false,
}: {
  values: Macros;
  dual: boolean;
  onChange: (key: MacroKey, value: number) => void;
  touchHelp?: boolean;
}) {
  return (
    <section className="rotation-controls" aria-label="Continuous rotation">
      <div className="rotation-caption">
        <span>Continuous rotation</span>
        <small>Negative reverses · 0 stops</small>
      </div>
      <div className="rotation-bank">
        {ROTATION_MACROS.map((m) =>
          m.key === "cameraBSpin" && !dual ? (
            <div className="rotation-unavailable" key={m.key}>
              <span>Camera B</span>
              <small>Choose Kaleidoscope or Mutual</small>
            </div>
          ) : (
            <Slider
              key={m.key}
              label={m.label}
              value={values[m.key]}
              min={m.min}
              max={m.max}
              step={m.step}
              unit={m.unit}
              hint={
                touchHelp && m.key !== "cameraSpin"
                  ? `${m.hint}; negative values reverse direction and 0 stops rotation`
                  : m.hint
              }
              touchHelp={touchHelp}
              onChange={(value) => onChange(m.key, value)}
            />
          ),
        )}
      </div>
    </section>
  );
}
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="14"
        cy="18"
        rx="9"
        ry="13"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <ellipse
        cx="22"
        cy="18"
        rx="9"
        ry="13"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
export function PresetGlyph({ id, color }: { id: string; color: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className="preset-glyph"
      fill="none"
      style={{ color }}
      aria-hidden="true"
    >
      {id === "drift" ? (
        [0, 1, 2, 3].map((i) => (
          <ellipse
            key={i}
            cx={21 + i * 2}
            cy="24"
            rx={17 - i * 3.8}
            ry={17 - i * 3.8}
            stroke="currentColor"
            opacity={1 - i * 0.15}
          />
        ))
      ) : id === "fold" || id === "kaleidoscope" ? (
        [0, 1, 2, 3, 4, 5].map((i) => (
          <ellipse
            key={i}
            cx="24"
            cy="24"
            rx="7"
            ry="19"
            stroke="currentColor"
            transform={`rotate(${i * 30} 24 24)`}
          />
        ))
      ) : id === "branches" ? (
        [0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d="M 24 5 L 43 39 L 5 39 Z"
            stroke="currentColor"
            transform={`translate(${24 * (1 - 0.7 ** i)} ${24 * (1 - 0.7 ** i)}) scale(${0.7 ** i})`}
          />
        ))
      ) : id === "mutual" ? (
        <>
          <circle cx="17" cy="24" r="13" stroke="currentColor" />
          <circle cx="31" cy="24" r="13" stroke="currentColor" />
          <circle cx="24" cy="24" r="6" stroke="currentColor" />
        </>
      ) : id === "captive" ? (
        [0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={5 + i * 5}
            y={5 + i * 5}
            width={38 - i * 10}
            height={38 - i * 10}
            stroke="currentColor"
            transform={`rotate(${i * 6} 24 24)`}
          />
        ))
      ) : id === "time-loom" ? (
        [0, 1, 2, 3, 4, 5].map((i) => (
          <path
            key={i}
            d={`M ${5 + i * 6} 7 Q ${25 - i * 2} 24 ${5 + i * 6} 41`}
            stroke="currentColor"
          />
        ))
      ) : (
        [0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d={`M 5 ${12 + i * 7} C 15 ${-5 + i * 8}, 28 ${45 - i * 4}, 43 ${12 + i * 7}`}
            stroke="currentColor"
          />
        ))
      )}
    </svg>
  );
}
