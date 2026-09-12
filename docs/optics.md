# Optical model

The feedback image is state, not a procedural fractal evaluated independently each frame. The built-in geometric marks are a source that can flow continuously or be disconnected with Capture. External imagery goes through the same capture path.

```text
Source → injection/routing → independent screens → glass / projection
                                ↑                        ↓
                          frame history ← camera response
```

Screens convert the video signal through brightness, contrast, hue, saturation, clipping, a display transfer curve, black level, and temporal response into emitted linear light. The optical pass combines a direct screen and a reflected screen in that linear space. Each branch has roll, magnification, placement, mirror flips, reflected magnification, and perspective. The camera samples the combined light, with defocus, sensor sharpening, exposure, white balance, noise, highlight response, clipping, and its transfer curve. These operations happen on every recursive capture.

The model approximates a modern camera and display pair. It is not a measured digital twin of a particular Sony camera, panel, or sheet of glass. Perspective is a planar approximation; blur and sampling approximate the sensor/lens response. Noise is deterministic from the scene seed and frame number. There is no decorative CRT overlay or unrelated fractal shader standing in for the feedback loop.

The fractal presets extend the optical arrangement with optional digital mirrors and brightest-signal blending. `symmetry = 1` leaves the projection unchanged; larger values fold it into mirrored angular sectors. `reflectionBlend = 0` retains linear glass mixing, while `1` chooses the brighter reflected or direct signal by luminance, preserving its color. Mixer mode 3 similarly injects source pixels only where they are brighter than the returning image. This avoids both continually diluting feedback with a black source background and accumulating bright sources until they turn white. Magnification, mirrored branches, and frame history create the repeated detail at different scales. These controls are also available through Free mode and MCP.

Camera A, Camera B, and screen rotation have independent motors. Each frame integrates speed in degrees per second using the simulation cadence; changing speed does not jump to a new angle. Motor phase is added to the node's static angle. The main screen motor drives the screens together; Free mode can offset each screen's speed individually. Freeze stops integration, Reset clears the phases, and moments save them alongside frame history. Version-one moments saved before motors existed restore with zero motor speeds and phases.

## Causality

Graph compilation rejects every instantaneous cycle. History nodes explicitly break cycles: all read their previous captures before any current capture is written. This is also true for Mutual's two coupled assemblies, so neither camera gets an artificial one-frame advantage from JavaScript node order.

Each history has two full-resolution targets for the latest capture and a 31-frame ring at an independently controlled history resolution. A delay of zero uses the full-resolution latest capture; additional delay samples the smaller ring. A screen and the emulsion field each keep two state textures. GPU resources are reused between frames.

RGBA16F is preferred when the browser exposes renderable half-float textures. RGBA8 is the identified standard-precision fallback. Settings and saved moments report actual precision and dimensions. History resolution is reduced first when a graph exceeds its memory budget; processing resolution is reduced next. Target selection is not a promise that an over-budget patch renders at the requested size.

## Instruments

| Instrument   | Feedback arrangement                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Drift        | One camera/display loop; a translated and rotated image leaves echoes.                                               |
| Fold         | Upper and lower screens combine through virtual glass; direct and reflected paths can magnify differently.           |
| Mutual       | Two complete assemblies exchange delayed captures through their lower screens.                                       |
| Captive      | A source-injection gate holds a picture in a slowly moving optical loop after Capture.                               |
| Time loom    | A second history path and a luminance key weave older captures into the present.                                     |
| Emulsion     | Image-gradient advection, diffusion, and field persistence alter the feedback signal before recapture.               |
| Kaleidoscope | Two independently rotating cameras, six mirrored sectors, and a continuous geometric source sustain nested patterns. |
| Branches     | Two shrinking mirrored projections recursively repeat a triangle source at smaller scales.                           |

## Anchored balance

Calibration copies the existing state into an isolated, smaller apparatus. It tests seven nearby exposure references over a bounded number of frames and compares spatial variance, linear-light energy drift corrected for projected area, blackness, and clipping. It examines the loop with continuous injection cut, so a bright live source cannot hide a dying feedback path. It uses a held source image; it never requests another camera or microphone.

The chosen reference is applied once. The Balance macro remains a relative exposure offset. Ordinary control movement, incoming video frames, and sensor samples do not recalibrate. Loading an instrument, replacing its source, and pressing Find balance do. A failed probe retains the previous reference and offers reset or reseeding. Free mode is unassisted. Switching to it bakes the held reference into camera exposure, preserving the current frame memory.

Kaleidoscope and Branches use tuned settings and continuous source injection by default, so loading them or replacing their source does not trigger automatic calibration. Find balance remains available for exploring a captured loop. Keeping the source flowing sustains the default patterns; Capture with reduced Contrast or Balance intentionally allows them to disappear.

An optical image can still escape the field of view, extinguish, or saturate. This is part of the apparatus. Balance is an aid to exploration, not a guarantee that every arbitrary graph or gesture will remain stable indefinitely.

## Moments

A save holds the renderer at a JavaScript frame boundary. It records every stateful target, the history heads, front-buffer indices, frame/random phase, injection pulse, full scene, modulation and gesture data, source playback state, and each source's immutable asset snapshot. Textures are gzip-compressed separately and stored in IndexedDB with progress. The `.feedback` archive contains a versioned JSON manifest, compressed frame chunks, source files, thumbnail, and optional recording.

Live sources are saved as their last captured image. Restoring them never reopens a camera or microphone without an explicit action. A change of GPU precision or memory budget can resample stored textures, so restoration promises visual continuation rather than pixel-identical future replay across devices.
