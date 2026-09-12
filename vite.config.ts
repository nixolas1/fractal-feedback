import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "offline-instrument",
      generateBundle(_options, bundle) {
        const assets = [
          "/",
          "/favicon.svg",
          "/examples/landscape.svg",
          "/examples/orbit.gif",
          "/examples/passing-light.txt",
          ...Object.keys(bundle)
            .filter((name) => name !== "index.html")
            .map((name) => `/${name}`),
        ];
        const version = createHash("sha256")
          .update(assets.join("\n"))
          .digest("hex")
          .slice(0, 12);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: readFileSync(
            "src/services/service-worker.template.js",
            "utf8",
          )
            .replace("__CACHE_VERSION__", version)
            .replace("__PRECACHE_ASSETS__", JSON.stringify(assets)),
        });
      },
    },
  ],
  server: { host: "0.0.0.0" },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@xyflow")) return "patch-workspace";
          if (id.includes("firebase")) return "cloud-services";
        },
      },
    },
  },
});
