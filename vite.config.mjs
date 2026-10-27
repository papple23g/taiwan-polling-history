import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    entries: ["index.html"],
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    port: 26298,
    strictPort: true,
    allowedHosts: ["terminal.local"],
    watch: {
      ignored: [`${normalizePath(fileURLToPath(new URL("./report", import.meta.url)))}/**`],
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 26298,
    strictPort: true,
  },
  plugins: [react(), {
    name: "fixed-local-address",
    configResolved(config) {
      Object.assign(config.server, { host: "0.0.0.0", port: 26298, strictPort: true });
      Object.assign(config.preview, { host: "0.0.0.0", port: 26298, strictPort: true });
    },
  }, {
    name: "drive-watch-deletion",
    configureServer(server) {
      server.watcher.on("error", error => {
        // Google Drive can report EINVAL when a watched file has already been deleted.
        if (error.code === "EINVAL" && error.syscall === "lstat" && typeof error.path === "string" && !existsSync(error.path)) {
          server.config.logger.warn(`File watcher skipped a deleted file: ${error.path}`);
          return;
        }
        throw error;
      });
    },
  }],
});
