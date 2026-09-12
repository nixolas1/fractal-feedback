import { OpticalEngine } from "../../src/engine/renderer";
import { PRESETS } from "../../src/core/presets";
const engine = new OpticalEngine(
  document.querySelector("canvas")!,
  PRESETS[0].make(),
);
const events: unknown[] = [];
engine.onLost = () => events.push({ type: "lost", at: Date.now() });
engine.onRestored = () => events.push({ type: "restored", at: Date.now() });
engine.onError = (error) =>
  events.push({ type: "error", error, at: Date.now() });
engine.start();
Object.assign(window, {
  harness: {
    engine,
    events,
    preset(index: number, width = 1920, budget = 384) {
      const scene = PRESETS[index].make();
      scene.simulation.width = width;
      scene.simulation.height = Math.round((width * 9) / 16);
      scene.simulation.memoryBudgetMB = budget;
      engine.configure(scene);
    },
    lose() {
      const extension = engine.gpu.gl.getExtension("WEBGL_lose_context");
      extension?.loseContext();
      setTimeout(() => extension?.restoreContext(), 1500);
    },
  },
});
