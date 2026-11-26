import { defineConfig } from "vite";

// No React plugin needed: Vite's built-in esbuild handles TSX with the automatic JSX runtime.
// (We skip it to keep dependencies minimal; the trade-off is no React Fast Refresh in dev.)
export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist" },
});
