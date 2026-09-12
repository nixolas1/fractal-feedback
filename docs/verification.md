# Verification

Measured on 11 September 2026 on the available Apple M2 Max. For the subsequent production deployment and checks on 12 September, see [deployment status](deployment-status.md). These are observed results, not a guarantee for every browser, media source, or custom patch.

## Automated checks

### Phone video recovery — 12 September 2026

- All 24 local Chromium tests, 24 unit tests, and three opted-in Firebase video scenarios pass. App, Functions, and MCP checks and the production build pass. The three separate cloud-emulator specs remain gated.
- Camera setup waits for the initial SDP exchange rather than requiring an already-connected ICE transport. Granting camera permission can therefore precede a fresh ICE offer. Description changes are serialized, answers identify their offer, and candidates arriving before a restart's description are retained.
- A stalled route retries after 12 seconds, then reports unavailable video after another 15 seconds. Manual retry and browser network restoration can start another attempt. Signaling writes and waits each time out after ten seconds. Local preview, direct video, and cloud controls have distinct status text; sensors can be stopped during camera setup.
- Real Firebase Auth, Functions and RTDB with two isolated Chromium contexts verify: camera activation before ICE is connected, fresh ICE credentials, delivered camera frames, stopping/reusing one sender; persistent candidate blocking with a finite failure status and working fallback controls; and lost signaling with a bounded setup error and immediate device shutdown. The tests proxy only their own authenticated API requests to accommodate production's Hosting-origin restriction. Access rules and backend configuration are unchanged.
- Unit checks cover signaling readiness without ICE, lagging aggregate connection state, bounded retries, release cancellation, missing signaling, and early candidates from a new ICE generation. Brave and physical phones were not available for automated verification; the user confirmed Chrome-to-Chrome camera operation.

Repeat the opted-in video scenarios with `FEEDBACK_VIDEO_TEST=fractal-feedback pnpm exec playwright test tests/video-connection.spec.ts`. This creates temporary anonymous phone leases in the existing project and releases them afterward; session records expire through scheduled cleanup. Ordinary browser runs skip these three scenarios.

### Continuous keyboard motion — 12 September 2026

- All 24 local Chromium tests and 18 unit tests pass. App, Functions, and MCP checks and the production build pass. Cloud rules and backend behavior are unchanged by this frontend update.
- Held keys record direction on keydown and stop on keyup. Animation frames integrate elapsed time; repeated keydown events do not add movement. Continuous sliders and camera positions retain fractional values. Whole-number controls accumulate fractional travel before changing their count.
- Deterministic unit checks compare 30, 60, and 144 Hz with no repeats, sparse repeats, and dense repeats; each produces the same linear motion. They also verify short taps between frames, opposing keys, cancellation, and suspension without a later jump.
- Browser checks use a controlled clock to verify exact travel (a 123 ms slider hold changes a −1…1 range by 0.0492), smooth focused-slider arrows, independent simultaneous camera movement, opposing keys, endpoint reversal, immediate key release, focus loss, hidden pages, and saves interrupting input.
- The deployed build passes a real-time check of slider rate with 50 synthetic repeated keydowns, simultaneous camera motion, and stopping on release and blur, without JavaScript errors. [Live measurements](keyboard-2026-09-12.json).

### Keyboard performance and screen image injection — 12 September 2026

- 22 local Chromium tests, 14 unit tests, and 6 Firebase emulator rule tests pass. App, Functions, and MCP checks and the production build pass. Three cloud integration specs are separately gated; deployment is checked with the live production smoke script.
- Keyboard tests exercise all eleven performance slider selectors, bracket traversal into panel sliders, adjustment, limits and reset, independent WASD/arrow camera movement, native focused-slider arrows, ignored browser modifier combinations, typing, and non-repeating freeze actions.
- A test patch with no source connected to its screen verifies that a prepared image leaves the live source and frame counter unchanged; Space replaces only the targeted screen, applies the previewed contrast while preserving edge pixels, reaches the camera and frame memory, and releases after twelve frames at 60 fps. Saving/restoring the queued pulse and feedback buffers reproduces the same continuation. Portable moment export/import remaps both selected and active image references; releasing the phone retains images already used in the scene.
- The 390-pixel layout fits without horizontal overflow. H opens the complete keyboard guide; I opens the screen image picker, contrast preview, and target selector. P now freezes; Space injects.

### Native 4K and phone image impulses — 12 September 2026

- 14 unit tests, 19 local Chromium tests, and 6 Firebase emulator rule tests pass. App, Functions, and MCP builds pass. The three deployment integration tests remain separate and were not rerun for this change.
- All eight built-in instruments retain actual 3840 × 2160 RGBA16F processing and average 60.0 fps on the available M2 Max. Mutual and Kaleidoscope use approximately 1,327 MB of frame targets. The measurement uses a two-second warmup followed by six one-second samples per instrument.
- Five-second Kaleidoscope MP4 recordings were decoded in Chromium and checked for native dimensions, duration, and frame count. At the 60 fps target, the clip contains 292 frames over 4.999 seconds, about 58.4 fps; the renderer still reports 60 fps. A roughly 133 ms startup encoding gap accounts for most of the short clip's deficit. At the 30 fps target, the clip contains 149 frames over 4.964 seconds, about 30.0 fps. Browser recording is variable-frame-rate; these results do not claim frame-perfect 60 fps encoding. Select 30 fps when a steady recorded cadence matters most.
- A forced 40 Hz frame-delivery test verifies automatic fallback to 30 without changing dimensions, clearing feedback memory, or jumping motor/automation time.
- Camera tests verify native 4K60 → 4K30 constraint fallback, a single stream shared by live camera and motion analysis, full-frame corner preservation for portrait/wide sources, motion detection and its default effect mapping, and device cleanup.
- A real local WebRTC image channel with controlled pairing verifies gallery selection, contrast processing, 4K host preparation, and a synthetic gravity-only shake that overrides the source without resetting feedback or calibration. The phone's native photo picker is configured for the rear camera. Physical iOS/Android permission and camera behavior still require a device check.
- Desktop and 390-pixel phone layouts were visually checked. The phone offers Image on shake, Image contrast, a manual Send image now button, a camera-motion meter, and independent camera-to-screen distance controls.

[Current render and recording measurements](benchmark-4k-2026-09-12.json). Repeat with `node tests/benchmark-4k.mjs` while the local Vite server runs on port 5173; sample clips are written to `tests/artifacts`.

### Fractal controls — 12 September 2026

- 14 unit tests, 15 local Chromium tests, and 6 Firebase emulator rule tests pass. App, Functions, and MCP builds pass.
- Kaleidoscope and Branches each run for 7,200 simulation frames at 60 fps, sampled every 120 frames. Every sample retains luminance and spatial detail without excessive clipping. Disconnecting the source and reducing Contrast and Balance still produces deliberate extinction.
- Motor checks cover independent camera and screen speeds, reversal, stopping without an angle jump, consistent integration at 24/30/60 fps, frozen phases, and saved-state restoration. Separate rendered-image comparisons verify that each of the three motors affects the picture with a still source.
- Desktop and 390-pixel mobile layouts were visually checked. The main shelf exposes Contrast and all three rotation controls. The phone fallback accepts speeds through ±30°/s while retaining the existing limits on other controls.

### Earlier installation checks

- TypeScript checks cover the React app, Firebase Functions, and Node MCP adapter. The production Vite build succeeds.
- Six graph/command unit tests cover causal routing, socket validity, all six presets, atomic rejection, and gesture interpolation.
- Ten local Chromium tests cover optical unity/decay/saturation, coupled-loop order independence, mirrored paths, precision fallback and memory limits, calibration isolation, exact same-device checkpoint restoration, image fitting, literal Unicode, GIF disposal/timing/seeking, video seeking, recording, and camera-to-still restoration.
- Five Firebase rule tests check owner-only sessions/results/gallery, bounded phone samples, protected host signaling, and immutable media.
- Three integration tests use Firebase Auth, Functions, RTDB, Firestore, and Storage emulators. They exercise real WebRTC between browser contexts, sensor denial, camera transfer, exclusive handover, RTDB fallback, HTTP commands, a real stdio MCP client creating and saving art, stale revision rejection, scope/lease enforcement, revocation, renderer-offline responses, immutable share access, remix grants, and media-URL expiry.
- A production-build offline check loads the instrument on its first online visit, disconnects networking, reloads, opens the separately bundled patch workspace, and saves a local moment.
- Desktop WebKit 26.6 renders the instrument and opens the patch workspace without JavaScript errors. A sample under concurrent test load measured about 29 fps. This is not an iOS Safari hardware test.

## Earlier M2 Max rendering — 11 September

Chromium 153.0.8010.12 uses ANGLE Metal on the Apple M2 Max. Each case warms for two seconds and collects ten one-second samples. A separate optical-core soak was running during these measurements. Values below are means; sub-frame rounding can report fractionally above 60.

| Instrument | 1080p fps | Frame targets | 4K-request actual size |  fps | Frame targets |
| ---------- | --------: | ------------: | ---------------------- | ---: | ------------: |
| Drift      |      60.0 |        157 MB | 3840 × 2160            | 60.0 |        537 MB |
| Fold       |      60.0 |        189 MB | 3840 × 2160            | 60.0 |        663 MB |
| Mutual     |      60.0 |        378 MB | 2774 × 1560            | 60.0 |        663 MB |
| Captive    |      60.0 |        157 MB | 3840 × 2160            | 59.8 |        537 MB |
| Time loom  |      60.0 |        235 MB | 3840 × 2160            | 60.0 |        757 MB |
| Emulsion   |      60.0 |        220 MB | 3840 × 2160            | 60.0 |        767 MB |

These earlier cases used RGBA16F with the previous 384 MB default and 768 MB 4K budget. Mutual exceeded that limit and was reduced to 2774 × 1560; Emulsion reduced history width to 244 pixels. The current 1,536 MB 4K budget resolves these built-in allocation limits, as measured above. Memory figures describe allocated render targets, not total browser-process or driver memory. The latest capture stays full resolution; older delays have their own resolution.

[Raw benchmark measurements](benchmark-2026-09-11.json).

## Control transport

Thirty samples per transport used two Chromium contexts and Firebase emulators on the same computer. The Node-clock measurement includes automation dispatch and the callback after host command commit. It does not measure physical phone sensors, display scanout, Wi-Fi, cellular data, or a TURN relay.

| Transport                 |     Mean | 95th percentile |
| ------------------------- | -------: | --------------: |
| WebRTC data channel       |   3.5 ms |          9.0 ms |
| RTDB fallback (throttled) | 109.5 ms |        114.2 ms |

[Raw latency measurements](latency-2026-09-11.json).

## Sustained run

The one-hour optical-core soak rotates through all six routing structures every minute and deliberately loses/restores the WebGL context every ten minutes. The harness is a static build so ongoing UI edits cannot reset the test. Later preset/balance and media changes are covered separately by the final browser checks and benchmark.

Completed **3,603.6 seconds** with 360 samples, no JavaScript or sampled WebGL errors, and **five successful context recoveries**. Sampled frame rate averaged 60.0 fps (minimum 59.0); samples exclude the brief deliberate context interruptions. The JavaScript heap ranged from 2.2–7.0 MB and finished at 4.4 MB. Accounted render-target allocations stayed within 157–378 MB as instruments changed. This checks the core’s resource lifetime and recovery; it does not measure total driver memory or recover discarded unsaved textures.

[Soak measurements and recovery events](soak-2026-09-11.json).

To repeat against the current core, build a static harness and serve it in one terminal:

```sh
pnpm exec vite build --config vite.harness.config.ts
python3 -m http.server 8767 --directory .cache/harness
```

Then run `node tests/soak.mjs` in another terminal. It defaults to one hour and writes `tests/artifacts/soak.json`. For the shorter instrument benchmark, serve the same build on port 8768 and run `node tests/benchmark.mjs`.

## Deployment-dependent checks

Physical iOS Safari and Android Chrome, real sensor accuracy, cellular/Wi-Fi handover, TURN-only relaying, Google account popup behavior in the final authorized domain, production IAM signing, and production Storage CORS remain installation gates. No Firebase project or Twilio credentials were supplied, so production deployment and those external checks were not performed. The emulator substitutes a short-lived local asset URL for GCS signing; it does not claim to validate Google IAM or Twilio connectivity.

See [deployment](deployment.md) for configuration and [installation operation](installation.md) for recovery and visitor handover.
