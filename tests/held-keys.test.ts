import { describe, expect, it } from "vitest";
import { HeldKeys } from "../src/services/held-keys";

function fixture(move: (values: Iterable<number>, seconds: number) => void) {
  let now = 0,
    nextId = 0;
  const callbacks = new Map<number, (time: number) => void>();
  const keys = new HeldKeys(move, {
    now: () => now,
    request: (callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
  });
  return {
    keys,
    callbacks,
    time(value: number) {
      now = value;
    },
    frame(time: number) {
      now = time;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(time));
    },
  };
}

describe("held-key motion", () => {
  it("has the same linear speed at 30, 60 and 144 Hz, independent of repeated keydowns", () => {
    for (const fps of [30, 60, 144])
      for (const repeats of [0, 1, 8]) {
        let value = 0;
        const input = fixture((directions, seconds) => {
          value += [...directions].reduce((sum, v) => sum + v, 0) * seconds;
        });
        input.keys.press("increase", 1);
        expect(value).toBe(0);
        for (let frame = 1; frame <= fps; frame++) {
          input.time((frame * 1000) / fps);
          for (let i = 0; i < repeats; i++) input.keys.press("increase", 1);
          input.frame((frame * 1000) / fps);
          expect(value).toBeCloseTo(frame / fps, 12);
        }
        input.keys.release("increase");
        expect(value).toBeCloseTo(1, 12);
        expect(input.callbacks.size).toBe(0);
      }
  });

  it("integrates a short tap exactly through keyup, without a fixed initial nudge", () => {
    let value = 0;
    const input = fixture((_, seconds) => {
      value += seconds;
    });
    input.keys.press("increase", 1);
    input.time(7.25);
    input.keys.release("increase");
    expect(value).toBeCloseTo(0.00725, 12);
    input.frame(100);
    expect(value).toBeCloseTo(0.00725, 12);
  });

  it("integrates changes in opposing directions at their actual press and release times", () => {
    let value = 0;
    const input = fixture((directions, seconds) => {
      value += [...directions].reduce((sum, v) => sum + v, 0) * seconds;
    });
    input.keys.press("up", 1);
    input.time(40);
    input.keys.press("down", -1);
    input.frame(100);
    expect(value).toBeCloseTo(0.04, 12);
    input.time(150);
    input.keys.release("up");
    input.time(190);
    input.keys.release("down");
    expect(value).toBeCloseTo(0, 12);
  });

  it("drops held input on cancellation and after a suspended frame", () => {
    let value = 0;
    const input = fixture((_, seconds) => {
      value += seconds;
    });
    input.keys.press("up", 1);
    input.frame(16);
    input.keys.clear();
    input.frame(1000);
    input.keys.release("up");
    expect(value).toBeCloseTo(0.016, 12);
    input.keys.press("up", 1);
    input.frame(1016);
    input.frame(5000);
    expect(value).toBeCloseTo(0.032, 12);
    expect(input.callbacks.size).toBe(0);
  });
});
