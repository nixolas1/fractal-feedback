# Running an installation

## Before visitors arrive

Use the production build on the display computer, enable hardware acceleration, and open the studio once while online so its offline cache finishes installing. Choose a preset, a source, and the display resolution. Use the actual dimensions and frame rate in Settings, rather than assuming a 4K selection fits every patch's budget.

Save an opening moment and export a backup `.feedback` file. Browser storage is private to this profile and can be evicted or cleared by the browser; exported files are portable. A cloud copy provides another backup when configured.

Enter fullscreen with F, then Clean view if desired. Freeze is always available. Avoid operating-system sleep during the performance. A single visible renderer is the intended display setup; background browser tabs may be throttled.

## Visitor controls

Distance changes magnification, Turn changes camera roll, and the XY pad moves its view. Color adjusts the screen before its light is recaptured. Memory inserts additional delayed captures. Balance changes exposure relative to a held reference. Changes compound across successive frames: a small motion can transform an entire image over several seconds.

Capture disconnects the incoming source. Freeze stops the recursive simulation, while Capture lets it continue. If the image goes dark or flat, try a small Balance movement, inject some light from Sources, or Reset. Find balance runs a finite probe, then holds its result; it does not undo future visitor gestures.

The Sources drawer includes three studies: a landscape, animated moving figures, and a Unicode text fragment. Try the landscape in Captive or Emulsion, and the animation in Time loom. Text can be loaded from a file or pasted literally.

## Phone handover

Connect the phone and display computer to the same Wi-Fi, then open Pair phone and display its QR code. Twilio is optional and disabled by default. Firebase signaling and fallback controls still require internet access. Codes expire after ten minutes; Refresh pairing code invalidates the old code. A session lasts at most 24 hours. Each phone gets a renewable 35-second lease, with heartbeats every ten seconds. Only one phone controls the studio at a time.

On the phone, enable capabilities individually. Tilt is relative to its position when enabled; Recenter makes the current position neutral. Sensitivity controls its range. Sound stays local and sends levels/bands/onsets, not an audio stream. Camera motion stays local and sends motion and color; Live camera explicitly sends a video track to the host. Deliberate accelerometer impulses inject a pulse and never pretend to measure absolute position.

The phone can release its lease, or the host can use Release this phone. A new visitor can then pair. Network loss fades sensor offsets toward neutral and leaves the scene in place. Touch controls fall back to throttled RTDB delivery when the direct data channel is unavailable. Video still requires working WebRTC connectivity. Wi-Fi client isolation can prevent a direct connection; use a network without client isolation or configure optional TURN relaying.

## Saving and recovering

Save moment briefly holds the simulation while its frame memories and source state are compressed. The progress display covers the complete checkpoint. A failed local save is removed; the running loop resumes. Cloud uploads track completed objects locally and can be retried. In Gallery, use the cloud icon for private backup or Share for an explicit view link.

Resume opens an editable copy of the scene with its checkpoint. Live sources restore as captured stills until re-enabled. A still PNG can be opened independently; a clip uses the browser-selected format shown in Settings. Recordings are intended as clips; monitor browser storage during long performances and export them regularly.

A WebGL context interruption stops the renderer. On restoration it reconstructs GPU resources and seeds a new evolution. Resume the saved opening moment or any later checkpoint to recover its frame memory. Unsaved GPU texture contents cannot be recovered after the browser discards the context.

Cloud or TURN failure does not stop local art creation. A disconnected external agent receives an offline error; it does not continue rendering elsewhere. Keep the studio open for agent-led performances.

## Access boundaries

A public QR link is only for a visitor controller lease. It is not an owner login. A share link grants viewing of one immutable cloud moment, with optional remix. An agent grant controls one active studio and cannot publish. These three grants are separate.

Revoke a share before removing a local moment if the published link should stop working. Local deletion does not erase its cloud revision. Signed media links expire after 60 seconds, but downloaded copies cannot be recalled.
