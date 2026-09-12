import type { MacroKey } from "../core/model";
import { HeldKeys } from "./held-keys";

export const SLIDER_KEYS: Partial<Record<MacroKey, string>> = {
  distance: "1",
  turn: "2",
  contrast: "3",
  balance: "4",
  color: "5",
  memory: "6",
  cameraDistance: "7",
  cameraBDistance: "8",
  cameraSpin: "9",
  cameraBSpin: "0",
  screenSpin: "-",
};

export type SliderControl = {
  label: string;
  min: number;
  max: number;
  step: number;
  resetValue: number;
  onChange: (value: number) => void;
};
const sliders = new Map<HTMLInputElement, () => SliderControl>();
let selected: HTMLInputElement | undefined;

export function registerSlider(
  input: HTMLInputElement,
  control: () => SliderControl,
) {
  sliders.set(input, control);
  return () => {
    sliders.delete(input);
    if (selected === input) selected = undefined;
  };
}

export function selectSlider(input: HTMLInputElement) {
  if (!sliders.has(input)) return;
  selected
    ?.closest(".slider-control, .xy-pad")
    ?.removeAttribute("data-keyboard-selected");
  selected = input;
  input
    .closest(".slider-control, .xy-pad")
    ?.setAttribute("data-keyboard-selected", "true");
}

export function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest("textarea, select, [role='textbox']") ||
      (target instanceof HTMLInputElement && target.type !== "range"))
  );
}

function available(input: HTMLInputElement) {
  return (
    sliders.has(input) &&
    !input.disabled &&
    (input.getClientRects().length > 0 ||
      !!input.closest(".clean .performance-shelf"))
  );
}

function sliderDescription(input: HTMLInputElement) {
  const spec = sliders.get(input)!();
  const decimals = Math.min(
    7,
    Math.max(2, 1 - Math.floor(Math.log10(spec.step))),
  );
  return `${spec.label}: ${Number(Number(input.value).toFixed(decimals))} · , / . adjust`;
}

function currentSlider() {
  if (!selected || !available(selected)) {
    const first = [...sliders.keys()].find(available);
    if (!first) return;
    selectSlider(first);
  }
  return selected;
}

// Selection does not steal focus: arrows still address camera B unless a range
// has keyboard focus. These actions happen once, never on OS key-repeat events.
function sliderKey(event: KeyboardEvent): string | undefined {
  const controls = [...sliders.keys()]
    .filter(available)
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  const direct = controls.find((input) => input.dataset.shortcut === event.key);
  if (direct) selectSlider(direct);
  else if (event.key === "[" || event.key === "]") {
    const index = selected ? controls.indexOf(selected) : -1;
    const next =
      index < 0
        ? event.key === "]"
          ? 0
          : controls.length - 1
        : (index + (event.key === "]" ? 1 : -1) + controls.length) %
          controls.length;
    if (controls[next]) selectSlider(controls[next]);
  } else if (["Home", "End", "Backspace"].includes(event.key)) {
    if (!currentSlider()) return;
    const spec = sliders.get(selected!)!();
    const next =
      event.key === "Home"
        ? spec.min
        : event.key === "End"
          ? spec.max
          : spec.resetValue;
    const value = Math.max(spec.min, Math.min(spec.max, next));
    selected!.value = String(value);
    spec.onChange(value);
  } else return;
  if (!selected) return;
  event.preventDefault();
  return sliderDescription(selected);
}

export type CameraMovement = {
  a: { x: number; y: number };
  b: { x: number; y: number };
};
type Motion =
  | { kind: "camera"; camera: "a" | "b"; axis: "x" | "y"; direction: number }
  | { kind: "slider"; input?: HTMLInputElement; direction: number };
const cameraKeys: Record<string, ["a" | "b", "x" | "y", number]> = {
  w: ["a", "y", -1],
  s: ["a", "y", 1],
  a: ["a", "x", -1],
  d: ["a", "x", 1],
  arrowup: ["b", "y", -1],
  arrowdown: ["b", "y", 1],
  arrowleft: ["b", "x", -1],
  arrowright: ["b", "x", 1],
};

export function keyboardInput(options: {
  blocked: () => boolean;
  moveCameras: (movement: CameraMovement) => void;
  selection: (description: string) => void;
}) {
  // Discrete counts/modes retain fractional travel between whole-number updates.
  const travel = new Map<HTMLInputElement, { value: number; output: number }>();
  const keys = new HeldKeys<Motion>((motions, seconds) => {
    if (options.blocked() || document.hidden) {
      clear();
      return;
    }
    const cameras: CameraMovement = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
    const directions = new Map<HTMLInputElement, number>();
    for (const motion of motions) {
      if (motion.kind === "camera") {
        cameras[motion.camera][motion.axis] +=
          motion.direction * 0.15 * seconds;
      } else {
        const input = motion.input ?? currentSlider();
        if (input && available(input))
          directions.set(
            input,
            (directions.get(input) ?? 0) + motion.direction,
          );
      }
    }
    if (cameras.a.x || cameras.a.y || cameras.b.x || cameras.b.y)
      options.moveCameras(cameras);
    for (const [input, direction] of directions) {
      if (!direction) continue;
      const spec = sliders.get(input)!();
      const previous = travel.get(input),
        current = Number(input.value);
      const from = previous?.output === current ? previous.value : current;
      const value = Math.max(
        spec.min,
        Math.min(
          spec.max,
          from + Math.sign(direction) * (spec.max - spec.min) * 0.2 * seconds,
        ),
      );
      const output = spec.step === 1 ? Math.round(value) : value;
      travel.set(input, { value, output });
      if (output !== current) {
        input.value = String(output);
        spec.onChange(output);
        options.selection(sliderDescription(input));
      }
    }
  });
  const clear = () => {
    keys.clear();
    travel.clear();
  };
  const release = (event: KeyboardEvent) =>
    keys.release(event.code || event.key.toLowerCase());
  const visibility = () => {
    if (document.hidden) clear();
  };
  window.addEventListener("keyup", release);
  window.addEventListener("blur", clear);
  window.addEventListener("pagehide", clear);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("focusin", clear);
  document.addEventListener("pointerdown", clear);

  return {
    keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return false;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        isTyping(event.target) ||
        options.blocked() ||
        document.hidden
      ) {
        clear();
        return false;
      }
      const key = event.key.toLowerCase();
      const range =
        event.target instanceof HTMLInputElement && sliders.has(event.target)
          ? event.target
          : undefined;
      let motion: Motion | undefined;
      if (key === "," || key === ".")
        motion = { kind: "slider", direction: key === "." ? 1 : -1 };
      else if (
        range &&
        [
          "arrowup",
          "arrowright",
          "arrowdown",
          "arrowleft",
          "pageup",
          "pagedown",
        ].includes(key)
      )
        motion = {
          kind: "slider",
          input: range,
          direction: ["arrowup", "arrowright", "pageup"].includes(key) ? 1 : -1,
        };
      else if (cameraKeys[key]) {
        const [camera, axis, direction] = cameraKeys[key];
        motion = { kind: "camera", camera, axis, direction };
      }
      if (motion) {
        event.preventDefault();
        if (!event.repeat) keys.press(event.code || key, motion);
        return true;
      }
      if (event.repeat) return false;
      const description = sliderKey(event);
      if (!description) return false;
      travel.clear();
      options.selection(description);
      return true;
    },
    dispose() {
      clear();
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", clear);
      window.removeEventListener("pagehide", clear);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("focusin", clear);
      document.removeEventListener("pointerdown", clear);
    },
  };
}
