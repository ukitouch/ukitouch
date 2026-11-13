import { defineConfig, type Plugin, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const devRedirect = (): Plugin => ({
  name: "ext-dev-redirect",
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const map: Record<string, string> = {
        "/api.js": "/src/api/index.ts",
        "/react.js": "/src/host/react.ts",
        "/jsx-runtime.js": "/src/host/jsx-runtime.ts",
      };
      if (req.url && req.url in map) req.url = map[req.url];
      next();
    });
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devRedirect()] as PluginOption[],
  resolve: {
    alias: {
      "@ukitouch/api": r("src/api/index.ts"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        main: r("index.html"),
        "api": r("src/api/index.ts"),
        "react": r("src/host/react.ts"),
        "jsx-runtime": r("src/host/jsx-runtime.ts"),
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});
