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

## Verification

The build and TypeScript checks pass. Twelve unit tests include the no-Twilio path and missing, rejected, malformed, or unavailable optional relay responses. The emulator phone test verifies real WebRTC, camera transfer, sensor denial, exclusive handover, and control fallback. The MCP integration test now also round-trips a complete scene, including empty arrays, through the real command queue. Command payloads use JSON strings inside RTDB so empty collections retain their meaning.

The production smoke test passed against the actual hosted build: direct phone controls and camera transfer between two Chromium contexts; a real stdio MCP client loading a scene, uploading an asset through a signed URL, capturing and saving artwork; browser Storage upload with CORS; owner-only Firestore metadata; real GCS signed downloads; the hosted share viewer; and share revocation. There were no page JavaScript errors. Temporary cloud moment objects and metadata were removed after verification. The anonymous session records and agent-upload assets expire through scheduled cleanup.

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
