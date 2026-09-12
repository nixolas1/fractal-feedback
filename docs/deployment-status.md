# Deployment status

Project: **fractal-feedback** · project number **970782929133** · 12 September 2026.

- Studio: https://fractal-feedback.web.app
- Repository: https://github.com/nixolas1/fractal-feedback
- API: https://europe-west1-fractal-feedback.cloudfunctions.net/api/v1
- Web app: `1:970782929133:web:1a21c2cc6e55b5409c5ce4`
- Realtime Database: `https://fractal-feedback-default-rtdb.europe-west1.firebasedatabase.app`
- Storage: `fractal-feedback.firebasestorage.app`

## Provisioned

Hosting serves the production build over HTTPS. Anonymous and Google Authentication are enabled. The Firebase Hosting domains and localhost are authorized.

The default Firestore database is Standard edition, Native mode, in `europe-west1`. The existing Realtime Database, new default Storage bucket, and both second-generation Node.js 22 Functions (`api`, `cleanup`) use the same region. Access rules for all three stores are deployed. Storage CORS permits the two Firebase Hosting origins.

The API runs as `970782929133-compute@developer.gserviceaccount.com`. It can sign blobs using Service Account Token Creator scoped to itself, and has Storage Object User on the application bucket. This project's pre-existing default account already had the Editor role; the deployment did not add that project-wide grant. No service-account key was downloaded.

The hourly cleanup job is enabled and was successfully invoked. Artifact Registry removes deployment images older than seven days.

## Phone connectivity

`TURN_PROVIDER=none` is deployed. No Twilio secrets are bound. Same-Wi-Fi/direct WebRTC is the default, assisted by STUN. Firebase handles pairing and a throttled control fallback. Pairing still needs internet access. A Wi-Fi network with client isolation may prevent direct video; an optional TURN provider can be enabled later using the deployment guide.

Phone camera activation now works during ICE setup. A fresh offer after camera permission can discover previously unavailable routes. Stalled video gets one automatic retry and then a clear failure status with manual retry; signaling operations have timeouts. The preview states when video is only local, and sensor shutdown remains available during setup. If Chrome-to-Chrome works while Brave fails, check Brave's WebRTC IP handling policy, VPNs, and Wi-Fi isolation. The installation guide includes the specific setting.

## Verification

The current release includes native 4K with automatic 60-to-30 fps fallback, landscape phone capture, camera-motion modulation, shake-triggered image transfer, independent camera-to-screen distances, keyboard performance controls, and Space injection onto selected screens. Hosting, both Functions, and access rules were deployed on 12 September 2026; the final frontend build includes saved-image remapping and phone-release retention fixes.

The production build and App, Functions, and MCP TypeScript checks pass. The camera-recovery update passes all 24 local Chromium tests, 24 unit tests, and three additional Firebase connection scenarios covering blocked startup, persistent video blocking, and interrupted signaling. The previous release also passed 6 Firebase emulator rule tests; backend behavior and rules are unchanged by this frontend update. The separately gated cloud emulator specs were not rerun; the hosted cloud flow was verified below. Command payloads use JSON strings inside RTDB so empty collections retain their meaning.

The earlier keyboard release replaced key-repeat stepping with elapsed-time motion for held camera and slider controls. The live check at 13:24 UTC verified a constant slider rate despite 50 synthetic repeat events, simultaneous independent camera movement, immediate stopping on release and window blur, and no page errors. [Live keyboard verification](keyboard-2026-09-12.json).

The production smoke test passed against the hosted camera-recovery update at 14:02 UTC: native 3840 × 2160 output, keyboard slider adjustment, independent WASD/arrow camera movement, image selection and contrast, Space injection and P freeze; direct phone controls, full-resolution PNG/JPEG image preload and manual impulse, landscape camera transfer with a live-preview status and release between two Chromium contexts; a real stdio MCP client loading a scene, uploading an asset through a signed URL, capturing and saving artwork; browser Storage upload with CORS; owner-only Firestore metadata; real GCS signed downloads; the hosted share viewer; and share revocation. There were no page JavaScript errors on either host or phone. Temporary cloud moment objects and metadata were removed after verification. The anonymous session records and agent-upload assets expire through scheduled cleanup.

A final CSS adjustment keeps the preset rail clear of the caption at shorter desktop heights and preserves the full camera preview. Desktop spacing was verified at 1440 × 1000 and 1440 × 768 before publishing that adjustment.

[Production test results](production-2026-09-12.json). To repeat this test intentionally against the live project, run `FEEDBACK_PRODUCTION_TEST=fractal-feedback node tests/production-smoke.mjs`. It creates temporary test data; it does not sign into a personal Google account.

## What the owner should do

Open the hosted studio and sign in with Google when saving to the cloud. Pair a real iOS or Android phone on the installation's Wi-Fi and test touch, tilt permissions, recentering, camera/microphone permissions, and handover. Physical phones, real sensor accuracy, and an interactive Google account consent flow cannot be verified by the automated desktop-browser run.

Twilio is not needed for this installation's default mode. To add cross-network relay connectivity later, follow the optional TURN section in [deployment](deployment.md). Custom domains also require adding the exact domain to Auth, Functions' allowed origins, and Storage CORS.

## Future deployments

```sh
pnpm install
npm --prefix functions ci
pnpm firebase:configure
pnpm deploy
```

Configuration retrieval uses the existing Firebase CLI login and writes `.env.local`, which is ignored by Git. Build output, dependencies, credentials, temporary setup helpers, test artifacts, and logs are also ignored. The Firebase skills installed in the repository are retained.
