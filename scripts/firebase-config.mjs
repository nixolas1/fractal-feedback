import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const project = "fractal-feedback";
const env = {
  ...process.env,
  npm_config_cache:
    process.env.npm_config_cache ?? `${root}.cache/firebase-npm`,
};
function cli(...args) {
  return JSON.parse(
    execFileSync(
      "npx",
      ["-y", "firebase-tools@latest", ...args, "--project", project, "--json"],
      {
        cwd: root,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  ).result;
}
const apps = cli("apps:list", "WEB");
const app = apps.find((a) => a.displayName === "Feedback studio") ?? apps[0];
if (!app)
  throw new Error("Create a Firebase web app in fractal-feedback first.");
const sdk = cli("apps:sdkconfig", "WEB", app.appId).sdkConfig;
const keys = {
  VITE_FIREBASE_API_KEY: "apiKey",
  VITE_FIREBASE_AUTH_DOMAIN: "authDomain",
  VITE_FIREBASE_PROJECT_ID: "projectId",
  VITE_FIREBASE_STORAGE_BUCKET: "storageBucket",
  VITE_FIREBASE_DATABASE_URL: "databaseURL",
  VITE_FIREBASE_APP_ID: "appId",
};
const file = `${root}.env.local`;
const retained = existsSync(file)
  ? readFileSync(file, "utf8")
      .split("\n")
      .filter(
        (line) =>
          !/^VITE_(FIREBASE_|FUNCTIONS_REGION=|USE_EMULATORS=)/.test(line),
      )
      .join("\n")
      .trim()
  : "";
const values = Object.entries(keys).map(([key, value]) => {
  if (!sdk[value]) throw new Error(`Missing Firebase configuration: ${value}`);
  return `${key}=${sdk[value]}`;
});
writeFileSync(
  file,
  [
    retained,
    ...values,
    "VITE_FUNCTIONS_REGION=europe-west1",
    "VITE_USE_EMULATORS=false",
    "",
  ]
    .filter((v, i) => v || i > 0)
    .join("\n"),
  { mode: 0o600 },
);
console.log(
  "Configured fractal-feedback in .env.local (excluded from Git). TURN remains optional.",
);
