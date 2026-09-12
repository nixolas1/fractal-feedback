# Agent HTTP API and MCP

The agent operates an open Feedback studio. It observes and controls the same optical graph as the host. It cannot run arbitrary GLSL, publish shares, or create a server-side renderer.

## Connect

Open **Agent connection → Create agent grant** in the studio. The grant is scoped to that installation session and expires after four hours. Creating it from the panel releases an active visitor phone; the host may reclaim control at any time.

Run `pnpm build:mcp` once, then copy the connection details into the MCP client's environment. Launch the compiled adapter with Node directly so package-manager status messages cannot enter the stdio protocol:

```json
{
  "mcpServers": {
    "feedback": {
      "command": "node",
      "args": ["/absolute/path/to/feedback/mcp/dist/mcp/src/index.js"],
      "env": {
        "FEEDBACK_API_URL": "https://europe-west1-YOUR_PROJECT.cloudfunctions.net/api/v1",
        "FEEDBACK_SESSION_ID": "COPY_FROM_STUDIO",
        "FEEDBACK_AGENT_TOKEN": "COPY_FROM_STUDIO"
      }
    }
  }
}
```

Only stdio protocol messages go to stdout. The adapter requires HTTPS, except for localhost emulator use. Never commit the access token. Revoke it from the same panel when the performance ends.

## Tools

| Tool               | Operation                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `get_capabilities` | Version, presets, node sockets, performance macros, and exact parameter bounds and units.  |
| `get_scene`        | Current validated scene and its revision.                                                  |
| `get_frame`        | JPEG of the actual canvas, up to 1280 pixels wide.                                         |
| `get_metrics`      | Actual cadence/resolution/precision/memory, image statistics, and calibration diagnostics. |
| `upload_asset`     | Upload a local image/GIF/video/text file, then feed it to the browser.                     |
| `load_scene`       | Load a preset ID or a complete scene; starts a new evolution.                              |
| `apply_commands`   | Atomically apply a batch at an expected revision.                                          |
| `capture`          | Disconnect continuous source injection after trapping the image.                           |
| `freeze`           | Hold or resume the simulation.                                                             |
| `reset`            | Clear frame memory and reseed the current apparatus.                                       |
| `find_balance`     | One bounded calibration in visitor mode. Free mode returns an unassisted error.            |
| `save_scene`       | Save a named, editable local moment with a visual checkpoint.                              |
| `start_recording`  | Begin a silent recording of the actual canvas.                                             |
| `stop_recording`   | Stop and save the clip with its final moment.                                              |

A useful loop is: inspect capabilities, read a scene, make a small atomic adjustment, inspect the resulting frame and metrics, then capture or save it. There is no hidden quality judge. An agent can intentionally explore extinction or saturation just as a human can.

## HTTP v1

Use `Authorization: Bearer <session grant>` and JSON bodies.

- `POST /sessions/:session/commands` with `{ "method": "get_scene", "args": {} }` returns HTTP 202 and a `commandId`.
- `GET /sessions/:session/commands/:commandId` returns `pending`, `expired`, or `complete`. Completion contains `ok`, a `value` or `error`, and `finished`.
- `POST /sessions/:session/assets` with `name`, `mime`, and `bytes` returns an asset ID and a temporary signed PUT URL. Upload the file with that content type, then enqueue `upload_asset` with its `assetId`. Maximum declared asset size is 256 MB.

For example, after obtaining revision 12:

```json
{
  "method": "apply_commands",
  "args": {
    "expectedRevision": 12,
    "commands": [
      {
        "type": "macros",
        "values": {
          "contrast": 0.08,
          "cameraSpin": 3,
          "cameraBSpin": -2,
          "screenSpin": 1
        }
      },
      {
        "type": "parameter",
        "node": "optics-a",
        "key": "reflectionScale",
        "value": 0.975
      }
    ]
  }
}
```

A stale revision or any invalid member rejects the whole batch. Graph edits must retain one output, use valid sockets, and break recursive cycles with Frame memory. `src/core/model.ts` and `src/core/protocol.ts` are the shared versioned schemas used by the UI, phone, API, and MCP adapter.

Load `kaleidoscope` for two rotating cameras or `branches` for contracting mirrored feedback. No asset upload is needed. The three rotation macros are independent speeds in degrees per second, from -30 to 30; zero holds the current motor angle. The `turn` macro adjusts static camera angle. Each screen and optical node also exposes `rotation` and `rotationSpeed` for individual control. `contrast` ranges from -1 to 1 and affects screen contrast inside the loop. Capture disconnects the source and may allow decay; resume it with `{ "type": "feed", "enabled": true }` in an atomic batch.

The server rejects mutations while a visitor holds the lease. It returns HTTP 409 with `Renderer offline` when the browser is unavailable or stale. The host rechecks authority when dequeuing a command. Receipts belong to the caller; another grant cannot read them. Signed media URLs pin the selected object generation. Sharing is a separate owner operation and is intentionally absent from this tool set.

Command arguments and results preserve empty arrays, empty objects, and nulls through the RTDB queue using JSON-encoded payloads. The public HTTP and MCP interfaces continue to return ordinary structured JSON.
