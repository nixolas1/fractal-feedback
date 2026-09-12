# Verification

Measured on 11 September 2026 on the available Apple M2 Max. For the subsequent production deployment and checks on 12 September, see [deployment status](deployment-status.md). These are observed results, not a guarantee for every browser, media source, or custom patch.

## Automated checks

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

## M2 Max rendering

Chromium 153.0.8010.12 uses ANGLE Metal on the Apple M2 Max. Each case warms for two seconds and collects ten one-second samples. A separate optical-core soak was running during these measurements. Values below are means; sub-frame rounding can report fractionally above 60.

| Instrument | 1080p fps | Frame targets | 4K-request actual size |  fps | Frame targets |
| ---------- | --------: | ------------: | ---------------------- | ---: | ------------: |
| Drift      |      60.0 |        157 MB | 3840 × 2160            | 60.0 |        537 MB |
| Fold       |      60.0 |        189 MB | 3840 × 2160            | 60.0 |        663 MB |
| Mutual     |      60.0 |        378 MB | 2774 × 1560            | 60.0 |        663 MB |
| Captive    |      60.0 |        157 MB | 3840 × 2160            | 59.8 |        537 MB |
| Time loom  |      60.0 |        235 MB | 3840 × 2160            | 60.0 |        757 MB |
| Emulsion   |      60.0 |        220 MB | 3840 × 2160            | 60.0 |        767 MB |

All cases used RGBA16F. The default budget is 384 MB; choosing 4K raises it to 768 MB. Mutual exceeds that limit at 4K and is explicitly reduced to 2774 × 1560. Emulsion keeps 4K processing but reduces history width to 244 pixels. Memory figures describe allocated render targets, not total browser-process or driver memory. The latest capture stays full resolution; older delays have their own resolution.

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
