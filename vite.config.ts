import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import studio from "./studio.config.ts";

const fromRoot = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: fromRoot(`./${studio.paths.preview}/`),
  base: "./",
  optimizeDeps: { noDiscovery: true, include: [] },
  publicDir: false,
  server: {
    fs: {
      allow: [fromRoot("./")],
    },
  },
  build: {
    outDir: fromRoot(`./${studio.paths.output}/preview/`),
    emptyOutDir: true,
    target: "es2022",
  },
});
