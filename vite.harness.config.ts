import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: ".cache/harness",
    emptyOutDir: true,
    rollupOptions: { input: "tests/harness/index.html" },
  },
});
