import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the site works from any GitHub Pages sub-path
  // (https://<user>.github.io/<repo>/) without configuration.
  base: "./",
  worker: { format: "es" },
  optimizeDeps: { exclude: ["replicad-opencascadejs"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
