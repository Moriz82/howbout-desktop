import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { dedupe: ["react", "react-dom", "ical.js"] },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [path.resolve(import.meta.dirname, "..")] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: ["es2021", "safari13"], minify: "oxc", sourcemap: true },
});
