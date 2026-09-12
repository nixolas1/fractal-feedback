# Optical model

The feedback image is state, not a procedural fractal evaluated independently each frame. The procedural marks are a finite initial light source. External imagery goes through the same capture path.

```text
Source → injection/routing → independent screens → glass / projection
                                ↑                        ↓
                          frame history ← camera response
```

Screens convert the video signal through brightness, contrast, hue, saturation, clipping, a display transfer curve, black level, and temporal response into emitted linear light. The optical pass combines a direct screen and a reflected screen in that linear space. Each branch has roll, magnification, placement, mirror flips, reflected magnification, and perspective. The camera samples the combined light, with defocus, sensor sharpening, exposure, white balance, noise, highlight response, clipping, and its transfer curve. These operations happen on every recursive capture.

The model approximates a modern camera and display pair. It is not a measured digital twin of a particular Sony camera, panel, or sheet of glass. Perspective is a planar approximation; blur and sampling approximate the sensor/lens response. Noise is deterministic from the scene seed and frame number. There is no decorative CRT overlay or unrelated fractal shader standing in for the feedback loop.

## Causality

Graph compilation rejects every instantaneous cycle. History nodes explicitly break cycles: all read their previous captures before any current capture is written. This is also true for Mutual's two coupled assemblies, so neither camera gets an artificial one-frame advantage from JavaScript node order.

Each history has two full-resolution targets for the latest capture and a 31-frame ring at an independently controlled history resolution. A delay of zero uses the full-resolution latest capture; additional delay samples the smaller ring. A screen and the emulsion field each keep two state textures. GPU resources are reused between frames.

RGBA16F is preferred when the browser exposes renderable half-float textures. RGBA8 is the identified standard-precision fallback. Settings and saved moments report actual precision and dimensions. History resolution is reduced first when a graph exceeds its memory budget; processing resolution is reduced next. Target selection is not a promise that an over-budget patch renders at the requested size.

## Instruments

| Instrument | Feedback arrangement                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Drift      | One camera/display loop; a translated and rotated image leaves echoes.                                     |
| Fold       | Upper and lower screens combine through virtual glass; direct and reflected paths can magnify differently. |
| Mutual     | Two complete assemblies exchange delayed captures through their lower screens.                             |
| Captive    | A source-injection gate holds a picture in a slowly moving optical loop after Capture.                     |
| Time loom  | A second history path and a luminance key weave older captures into the present.                           |
| Emulsion   | Image-gradient advection, diffusion, and field persistence alter the feedback signal before recapture.     |

## Anchored balance

Calibration copies the existing state into an isolated, smaller apparatus. It tests seven nearby exposure references over a bounded number of frames and compares spatial variance, linear-light energy drift corrected for projected area, blackness, and clipping. It examines the loop with continuous injection cut, so a bright live source cannot hide a dying feedback path. It uses a held source image; it never requests another camera or microphone.

The chosen reference is applied once. The Balance macro remains a relative exposure offset. Ordinary control movement, incoming video frames, and sensor samples do not recalibrate. Loading an instrument, replacing its source, and pressing Find balance do. A failed probe retains the previous reference and offers reset or reseeding. Free mode is unassisted. Switching to it bakes the held reference into camera exposure, preserving the current frame memory.

An optical image can still escape the field of view, extinguish, or saturate. This is part of the apparatus. Balance is an aid to exploration, not a guarantee that every arbitrary graph or gesture will remain stable indefinitely.

## Moments

A save holds the renderer at a JavaScript frame boundary. It records every stateful target, the history heads, front-buffer indices, frame/random phase, injection pulse, full scene, modulation and gesture data, source playback state, and each source's immutable asset snapshot. Textures are gzip-compressed separately and stored in IndexedDB with progress. The `.feedback` archive contains a versioned JSON manifest, compressed frame chunks, source files, thumbnail, and optional recording.

Live sources are saved as their last captured image. Restoring them never reopens a camera or microphone without an explicit action. A change of GPU precision or memory budget can resample stored textures, so restoration promises visual continuation rather than pixel-identical future replay across devices.
