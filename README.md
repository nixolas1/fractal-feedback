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

- Choose **Drift**, **Fold**, **Mutual**, **Captive**, **Time loom**, or **Emulsion**. They use different feedback arrangements, rather than switching fractal equations.
- Move the XY pad and try **Distance**, **Turn**, **Balance**, **Color**, and **Memory**. Small changes matter over many recursions. Shift-drag a slider for fine adjustment, use its arrow keys, or enter a number.
- **Capture source** disconnects incoming light after a final injection. The image continues evolving inside the loop. **Freeze** holds the actual simulation. Space also freezes it.
- **Find balance** tests isolated copies and latches an exposure reference. Balance offsets that held reference. It is not a live brightness controller. Free mode disables calibration.
- Open **Sources** for images, animated GIFs, video, Unicode text, and an explicitly enabled webcam. Drag a file into the studio to import it. A `.feedback` file restores a saved moment.
- **Free mode** opens the optical bench. Connect typed sockets, adjust the screens and cameras independently, add memory and keys, map modulation, or record a loop of control gestures. An instantaneous cycle is rejected; route feedback through Frame memory.
- **Save moment** stores the editable scene, feedback and delay buffers, source positions, and a still in the private browser gallery. **Moment** exports its portable package. The down-arrow in the artwork exports a PNG. Recordings use the actual browser-supported format shown in Settings; microphone recording is separately opt-in.
- Clean view hides the shelf; F enters fullscreen. Freeze remains immediately accessible.

A setup describes the instrument. A moment also preserves its running memory. A clip records its visible performance. Visual continuation is supported; exact replay between GPUs is not promised.

## Connected installation

The deployed studio is [fractal-feedback.web.app](https://fractal-feedback.web.app). Phone pairing, remote agents, cloud ownership, and share links use the `fractal-feedback` Firebase project. See [deployment](docs/deployment.md) for Firebase, Google sign-in, Storage CORS, and Twilio TURN configuration. The default Firebase project is `fractal-feedback`; emulator commands explicitly target the isolated `demo-feedback` project. Run `pnpm firebase:configure` after cloning to download the public web configuration into the ignored `.env.local`.

The phone receives an exclusive, revocable lease. Touch works without sensor permissions. Tilt, microphone, live camera, local camera analysis, and impulse gestures are enabled separately. Use the same Wi-Fi for the phone and host. Direct WebRTC carries controls and optional video; RTDB provides a throttled control fallback. Twilio TURN is optional and disabled by default. New pairing still requires internet access to Firebase. The host can release the visitor at any time.

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
| Six optical instruments                           | `src/core/presets.ts`                       |
| WebGL resources, shaders and fixed-cadence engine | `src/engine/`                               |
| Visitor shelf and Free mode workspace             | `src/components/`                           |
| Phone lease, WebRTC and sensors                   | `src/remote/`, `src/services/sensors.ts`    |
| Local moments, recording and optional cloud       | `src/services/`                             |
| Firebase HTTP API and access rules                | `functions/`, root `*.rules*` files         |
| External stdio MCP adapter                        | `mcp/`                                      |

The supplied transcript is source material, not an executable specification. See [optical model](docs/optics.md) for the relationship between this simulation and the apparatus in the reference.
