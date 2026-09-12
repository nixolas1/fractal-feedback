# Feedback

A browser instrument for recursive optical video art. The artwork comes from a simulated screen, glass, lens, and camera feeding their previous captures back into themselves. React controls the instrument; an independent WebGL2 renderer advances the apparatus.

## Run locally

Requirements: Node.js 22 or newer and pnpm.

```sh
pnpm install
pnpm dev
```

Open **http://localhost:5173**. No account, Firebase project, API key, or TURN service is needed for rendering, importing media, patching, recording, local moments, or export.

```sh
pnpm build
pnpm preview
```

The production build precaches the instrument, fonts, and Free mode workspace. After one complete online visit, solo use works offline. Development mode does not install a service worker.

## Play

- Start with **Kaleidoscope**, the default: two cameras and mirrored feedback build a continuously changing pattern. **Branches** makes a fractal from two shrinking, mirrored copies of a triangle seed. Both keep their built-in geometric source flowing so the image stays visible without imported assets. **Drift**, **Fold**, **Mutual**, **Captive**, **Time loom**, and **Emulsion** offer the original optical arrangements.
- The studio starts at **3840 × 2160**, targeting **60 fps**. Auto cadence falls back to **30 fps** after sustained slow frames while keeping the picture resolution. Settings also offers fixed 60, 30, and 24 fps. Native 4K is available for all built-in instruments within the 1,536 MB frame-memory budget; custom patches can exceed it, so check Actual picture in Settings.
- Move the XY pad and try **Linked distance**, **Angle**, **Contrast**, **Balance**, **Color**, and **Memory**. **Camera–screen distance** separately moves Camera A and Camera B toward or away from their screens: 1× is the setup's original separation, below 1× is closer, and above 1× is farther. Linked distance is a fine adjustment of both cameras together. Contrast adjusts the screens inside the feedback loop. Small changes matter over many recursions. Shift-drag a slider for fine adjustment, use its arrow keys, or enter a number.
- **Continuous rotation** has independent **Camera A**, **Camera B**, and **Screen** speeds in degrees per second. Negative values reverse a motor; zero stops it at its current angle. Kaleidoscope and Mutual have both cameras. **Angle** sets the camera orientation separately; Free mode also exposes each screen's angle and each node's motor speed.
- **Capture source** disconnects incoming light after a final injection. The image continues evolving and may fade, especially at low Contrast or Balance. **Resume source** starts feeding it again. **Freeze** holds the simulation and all rotation motors; press **P** to freeze or continue.
- **Space** puts the chosen image onto the screen for 0.2 seconds so the camera takes it into feedback memory. Press **I** for Sources → Image on screen: choose an image from your gallery or camera, preview its contrast, and select all screens or one screen. Preparing an image does not change the live source. A frozen loop queues the injection until you continue.
- **WASD** moves camera A and **arrows** move camera B independently. **1–6** select the main sliders, **7/8** select camera distances, and **9/0/−** select the three rotation speeds. Hold **comma/period** to smoothly decrease/increase the selected slider; **brackets** select every visible slider, including Free mode parameters. Home/End set its limits and Backspace resets it. **H** opens the complete guide. Movement is linear in elapsed time, independent of operating-system key repeat and display frame rate. Opposite keys cancel; key release, focus loss, and hidden pages stop movement. A slider focused with Tab uses the same smooth motion for its arrow keys. Counts and mode selectors remain whole numbers. Typing and browser modifier combinations keep their normal behavior.
- **Find balance** tests isolated copies and latches an exposure reference. Balance offsets that held reference. It is not a live brightness controller. The original instruments calibrate automatically; Kaleidoscope and Branches start with their tuned settings. Free mode disables calibration.
- Open **Sources** for images, animated GIFs, video, Unicode text, and an explicitly enabled webcam. Drag a file into the studio to import it. A `.feedback` file restores a saved moment.
- **Free mode** opens the optical bench. Connect typed sockets, adjust the screens and cameras independently, add memory and keys, map modulation, or record a loop of control gestures. An instantaneous cycle is rejected; route feedback through Frame memory.
- **Save moment** stores the editable scene, feedback and delay buffers, source positions, and a still in the private browser gallery. **Moment** exports its portable package. The down-arrow in the artwork exports a PNG. Recordings use the actual browser-supported format shown in Settings; microphone recording is separately opt-in.
- Clean view hides the shelf; F enters fullscreen. Freeze remains immediately accessible.

A setup describes the instrument. A moment also preserves its running memory. A clip records its visible performance. Visual continuation is supported; exact replay between GPUs is not promised.

## Connected installation

The deployed studio is [fractal-feedback.web.app](https://fractal-feedback.web.app). Phone pairing, remote agents, cloud ownership, and share links use the `fractal-feedback` Firebase project. See [deployment](docs/deployment.md) for Firebase, Google sign-in, Storage CORS, and Twilio TURN configuration. The default Firebase project is `fractal-feedback`; emulator commands explicitly target the isolated `demo-feedback` project. Run `pnpm firebase:configure` after cloning to download the public web configuration into the ignored `.env.local`.

The phone receives an exclusive, revocable lease. Touch works without sensor permissions. Tilt, microphone, live camera, local camera analysis, and impulse gestures are enabled separately. Use the same Wi-Fi for the phone and host. Direct WebRTC carries controls and optional video; RTDB provides a throttled control fallback. Twilio TURN is optional and disabled by default. New pairing still requires internet access to Firebase. The host can release the visitor at any time.

On the phone, **Image on shake → Choose from gallery** or **Take a photo** selects the impulse image. Adjust **Image contrast** using its preview, wait for **Image ready**, then enable **Impulse** and shake. **Send image now** performs the same action without motion permission. The photo is prepared over WebRTC before the shake; each shake overrides the current source and gives the existing feedback loop a short injection, then holds it captured. Screen Contrast and the accumulated feedback stay intact. Image contrast affects the photo; screen Contrast controls its survival in the loop.

Hold the phone sideways before enabling live camera or camera motion. Capture requests native 4K/60, falls back to 4K/30 and then supported HD modes, and shows the actual camera dimensions and rate. Portrait orientation pauses live transmission. Every source preserves the full frame with letterboxing when needed, without stretching or cropping. Live camera and motion analysis share one camera stream. In built-in instruments, detected camera motion modulates linked distance and camera color modulates hue; a meter confirms motion detection. Sensitivity also adjusts the shake threshold.

Cloud moments are private immutable revisions. Sharing creates a separate revocable grant, initially view-only. Enabling remix makes a new local copy for the recipient. Media URLs last 60 seconds. Already downloaded media cannot be recalled.

An agent connects to an **active browser renderer** through a scoped owner grant. Closing the studio produces an explicit offline response. There is no cloud renderer, arbitrary shader execution, or built-in AI chat. See [agent API and MCP](docs/agents.md).

## Verification

```sh
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build:functions
pnpm build:mcp
pnpm exec tsc -p mcp/tsconfig.json
```

Browser tests use Chromium with Metal on macOS. Install it with `pnpm exec playwright install chromium`. Tests cover causal routing, atomic commands, unity/decay/saturation, isolated calibration, checkpoints, GIF disposal and timing, text, image fitting, video seeking, webcam snapshots, and recording. Cloud tests use actual Firebase emulators and an actual stdio MCP client. See [verification](docs/verification.md) and [installation operation](docs/installation.md).

## Code map

| Area                                              | Location                                    |
| ------------------------------------------------- | ------------------------------------------- |
| Scene, graph, control and wire schemas            | `src/core/model.ts`, `src/core/protocol.ts` |
| Optical and fractal instruments                   | `src/core/presets.ts`                       |
| WebGL resources, shaders and fixed-cadence engine | `src/engine/`                               |
| Visitor shelf and Free mode workspace             | `src/components/`                           |
| Phone lease, WebRTC and sensors                   | `src/remote/`, `src/services/sensors.ts`    |
| Local moments, recording and optional cloud       | `src/services/`                             |
| Firebase HTTP API and access rules                | `functions/`, root `*.rules*` files         |
| External stdio MCP adapter                        | `mcp/`                                      |

The supplied transcript is source material, not an executable specification. See [optical model](docs/optics.md) for the relationship between this simulation and the apparatus in the reference.
