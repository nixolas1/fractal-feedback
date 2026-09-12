export function KeyboardHelp() {
  return (
    <>
      <div className="drawer-intro">
        <h2>Play from the keyboard</h2>
        <p>
          Single keys, with no modifier combinations. Shortcuts pause while you
          type in a field.
        </p>
      </div>
      <section className="keyboard-help">
        <h3>Cameras</h3>
        <p>
          Hold to move at a steady speed. Release to stop. Opposite keys cancel;
          both cameras can move at once.
        </p>
        <dl>
          <dt>
            <kbd>W A S D</kbd>
          </dt>
          <dd>Move camera A up, left, down, right</dd>
          <dt>
            <kbd>↑ ← ↓ →</kbd>
          </dt>
          <dd>Move camera B independently</dd>
        </dl>
        <h3>Every slider</h3>
        <p>
          Click a slider or select it with a key. The selected slider is
          outlined.
        </p>
        <dl>
          <dt>
            <kbd>1</kbd>–<kbd>6</kbd>
          </dt>
          <dd>Linked distance, angle, contrast, balance, color, memory</dd>
          <dt>
            <kbd>7</kbd> / <kbd>8</kbd>
          </dt>
          <dd>Camera A / B distance to screen</dd>
          <dt>
            <kbd>9</kbd> / <kbd>0</kbd> / <kbd>−</kbd>
          </dt>
          <dd>Camera A / B / screen rotation speed</dd>
          <dt>
            <kbd>[</kbd> / <kbd>]</kbd>
          </dt>
          <dd>Select previous / next slider, including open panel controls</dd>
          <dt>
            <kbd>,</kbd> / <kbd>.</kbd>
          </dt>
          <dd>Hold to smoothly decrease / increase the selected slider</dd>
          <dt>
            <kbd>Home</kbd> / <kbd>End</kbd>
          </dt>
          <dd>Minimum / maximum</dd>
          <dt>
            <kbd>Backspace</kbd>
          </dt>
          <dd>Reset selected slider</dd>
        </dl>
        <p>
          Tab focuses controls normally. When a slider has keyboard focus,
          arrows smoothly adjust that slider while held. Click the artwork to
          return arrows to camera B.
        </p>
        <h3>Performance</h3>
        <dl>
          <dt>
            <kbd>Space</kbd>
          </dt>
          <dd>Inject the chosen image onto the screen for 0.2 seconds</dd>
          <dt>
            <kbd>I</kbd>
          </dt>
          <dd>Choose the next image and its contrast in Sources</dd>
          <dt>
            <kbd>P</kbd>
          </dt>
          <dd>Freeze / continue</dd>
          <dt>
            <kbd>C</kbd>
          </dt>
          <dd>Capture / resume the live source</dd>
          <dt>
            <kbd>B</kbd>
          </dt>
          <dd>Find balance</dd>
          <dt>
            <kbd>X</kbd>
          </dt>
          <dd>Reset loop memory</dd>
          <dt>
            <kbd>R</kbd>
          </dt>
          <dd>Record / stop and save video</dd>
          <dt>
            <kbd>M</kbd>
          </dt>
          <dd>Save a moment</dd>
          <dt>
            <kbd>F</kbd>
          </dt>
          <dd>Fullscreen</dd>
          <dt>
            <kbd>V</kbd>
          </dt>
          <dd>Clean view / show controls</dd>
          <dt>
            <kbd>G</kbd>
          </dt>
          <dd>Open / close gallery</dd>
          <dt>
            <kbd>H</kbd>
          </dt>
          <dd>This keyboard guide</dd>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>Close panel / leave clean view</dd>
        </dl>
      </section>
    </>
  );
}
