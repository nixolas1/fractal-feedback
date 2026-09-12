# Deployment

## This installation

The deployed project is **fractal-feedback** (970782929133), at [fractal-feedback.web.app](https://fractal-feedback.web.app). Firestore, Realtime Database, Storage, and Functions use `europe-west1`. See [deployment status](deployment-status.md) for verified services and the remaining physical-device checks.

After cloning the repository:

```sh
pnpm install
npm --prefix functions ci
pnpm firebase:configure
pnpm deploy
```

`firebase:configure` retrieves the public web configuration using your existing Firebase CLI login and writes the ignored `.env.local`. It does not download service-account credentials. The scripts use an isolated npm cache because the machine’s shared npx cache had a corrupted dependency tree.

The bucket CORS configuration is checked in as `storage.cors.json`. Apply it with `gcloud storage buckets update gs://fractal-feedback.firebasestorage.app --cors-file=storage.cors.json` when changing hostnames.

## Local emulator installation

Use Node.js 22+, pnpm, Firebase CLI, and Java 21+. The project uses no paid service when run as `demo-feedback`.

```sh
pnpm install
npm --prefix functions ci
pnpm build:functions
npx -y firebase-tools@latest emulators:start --project demo-feedback
```

In another terminal:

```sh
pnpm dev --mode emulator --port 5174
```

Open `http://localhost:5174`. The checked-in `.env.emulator` contains fake public configuration for this emulator only. Client and Functions use `demo-feedback-default-rtdb`; the rule-unit tests use a separate isolated namespace provided by Firebase's testing library. The emulator has a localhost-only stand-in for short-lived Storage signed URLs. Production always uses GCS V4 signed URLs. Emulator asset PUTs are limited to 8 MB; production uploads go directly to Storage.

Phone pairing defaults to direct WebRTC with STUN, both locally and in production. No Twilio secrets are required. Use the same Wi-Fi network for the host and visitor phone. Firebase still provides signaling, leases, and a throttled control fallback; new pairing requires internet access. If Wi-Fi client isolation prevents a direct path, video needs an optional TURN relay.

```sh
pnpm test:rules
FEEDBACK_CLOUD_TEST=1 pnpm exec playwright test tests/cloud.spec.ts
```

`test:rules` starts its own database, Firestore, and Storage emulators. If they are already running, use `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm exec vitest run tests/firebase.rules.test.ts` instead.

## Firebase project

Create or select your own project and enable these products:

1. Firebase Authentication: anonymous and Google providers; add the final host domain to authorized domains.
2. Firestore in Native mode, Realtime Database, and Cloud Storage. Select a region near the installation.
3. Cloud Functions with billing enabled. Functions currently deploy in `europe-west1`.
4. Firebase Hosting or another HTTPS static host.

Copy `.env.example` to `.env.local` and fill in the public Firebase web-app configuration. Copy the exact Realtime Database URL from the Firebase console, including its region. Keep `VITE_USE_EMULATORS=false`. These Firebase web configuration values identify the project; security comes from the checked-in rules and server authorization.

Twilio TURN is optional. To enable it later, set `TURN_PROVIDER=twilio` in `functions/.env.YOUR_PROJECT_ID`, create the secrets below, and redeploy Functions:

```sh
npx -y firebase-tools@latest functions:secrets:set TWILIO_ACCOUNT_SID --project YOUR_PROJECT_ID
npx -y firebase-tools@latest functions:secrets:set TWILIO_AUTH_TOKEN --project YOUR_PROJECT_ID
npx -y firebase-tools@latest deploy --only functions --project YOUR_PROJECT_ID
```

The API exchanges the secrets for temporary relay credentials with a one-hour TTL. Secrets are bound only when this provider is enabled. The default `TURN_PROVIDER=none` needs no secret configuration. A relay request failure falls back to direct WebRTC and Firebase controls instead of blocking pairing. STUN discovers direct routes; it does not relay camera footage.

For a custom host, set `ALLOWED_ORIGINS` in `functions/.env.YOUR_PROJECT_ID` to a comma-separated list of exact HTTPS origins. The default `<project>.web.app` and `<project>.firebaseapp.com` origins are already allowed. See `functions/.env.example`.

The Functions runtime service account needs object access to the application's Storage bucket and permission to sign blobs (`iam.serviceAccounts.signBlob`, typically via Service Account Token Creator on the signing service account). Grant the narrow required permissions to the runtime service account; do not distribute a service-account key to browsers or agents.

Configure Storage CORS for your actual host origins so authenticated SDK downloads and signed-URL PUT/GET requests work:

```json
[
  {
    "origin": ["https://YOUR_PROJECT_ID.web.app"],
    "method": ["GET", "HEAD", "PUT", "POST"],
    "responseHeader": [
      "Content-Type",
      "Content-Length",
      "Range",
      "Content-Range"
    ],
    "maxAgeSeconds": 3600
  }
]
```

Apply that configuration with your GCS tooling to the specific project bucket. Keep media private. Do not add public bucket permissions or long-lived download tokens as a shortcut for sharing.

Build and deploy to the explicitly selected project:

```sh
pnpm build
pnpm build:functions
npx -y firebase-tools@latest deploy --project YOUR_PROJECT_ID
```

Deploy hosting, Functions, and all three access-rule files together. The checked-in default project is `fractal-feedback`; emulator commands explicitly use `--project demo-feedback`. No real Firebase or TURN credentials are included in this repository.

## Access and retention

Scene metadata and media belong to an authenticated UID. Anonymous users can pair without an account; Google linking preserves the owner's anonymous UID when possible. A phone can read status and send bounded input only while it holds the server-issued controller lease. It cannot mint a lease, write the agent inbox, read command results, or replace host signaling.

Every cloud save gets an immutable revision ID. Upload progress is preserved locally; retry continues the incomplete revision instead of changing a shared object. The server creates a separate hashed share grant and returns media URLs valid for 60 seconds. Revocation stops new grant resolution; an already-issued URL remains valid until it expires. Remix permission is checked separately.

Agent grants are scoped to one session, expire after four hours, and exclude publishing. Pending commands are reauthorized by the host before execution, so revoked grants cannot drain a queued command list. A command already executing cannot be undone by revoking its grant.

The scheduled cleanup removes expired sessions, grants, rate-limit records, and temporary agent-upload assets. Private gallery moments remain until the owner removes them through their chosen retention process. Browser-local deletion does not delete a cloud revision or revoke an existing share; revoke the link explicitly first when desired.

## Installation gates

Before opening to visitors, test physical iOS Safari and Android Chrome on the actual Wi-Fi and on cellular data. Verify HTTPS, separate sensor permission denial, relative tilt/recentering, camera selection, reconnection, and exclusive handover. If TURN is enabled, test TURN-only connectivity across networks. Emulator success and desktop WebKit checks do not replace those hardware/network tests.
