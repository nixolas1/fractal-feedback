type Clock = {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

// Key events only change intent. Motion integrates elapsed time once per frame,
// including the fraction of a frame between the last update and key release.
export class HeldKeys<T> {
  private held = new Map<string, T>();
  private previous = 0;
  private frame: number | undefined;

  constructor(
    private move: (values: Iterable<T>, seconds: number) => void,
    private clock: Clock = {
      now: () => performance.now(),
      request: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
    },
  ) {}

  press(key: string, value: T) {
    if (this.held.has(key)) return;
    this.advance(this.clock.now());
    this.held.set(key, value);
    this.schedule();
  }

  release(key: string) {
    if (!this.held.has(key)) return;
    this.advance(this.clock.now());
    this.held.delete(key);
    if (!this.held.size) this.clear();
  }

  clear = () => {
    this.held.clear();
    if (this.frame !== undefined) this.clock.cancel(this.frame);
    this.frame = undefined;
  };

  private advance(now: number) {
    const seconds = (now - this.previous) / 1000;
    this.previous = now;
    if (!this.held.size || seconds <= 0) return;
    // A suspended page must never replay a long interval of unseen movement.
    if (seconds > 0.25) {
      this.clear();
      return;
    }
    this.move(this.held.values(), seconds);
  }

  private schedule() {
    if (this.frame !== undefined || !this.held.size) return;
    this.frame = this.clock.request(() => {
      this.frame = undefined;
      this.advance(this.clock.now());
      this.schedule();
    });
  }
}
