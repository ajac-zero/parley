import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-server stability fixes:
 *
 * 1. Node's default `keepAliveTimeout` is 5s; Chromium reuses idle sockets
 *    for far longer. When a request lands on a socket the server just
 *    closed, module loads fail. Raise the timeout above the reuse window.
 *
 * 2. The TanStack Start client entry is served un-versioned (no `?v=` hash),
 *    so browsers revalidate it and can receive a 304 against an evicted
 *    cache entry, which breaks the dynamic import that boots the app
 *    ("Failed to fetch dynamically imported module"). Serve it `no-store`.
 */
const devStability: Plugin = {
  name: "parley:dev-stability",
  configureServer(server) {
    server.httpServer?.on("listening", () => {
      const http = server.httpServer as unknown as {
        keepAliveTimeout: number;
        headersTimeout: number;
      };
      http.keepAliveTimeout = 65_000;
      http.headersTimeout = 66_000;
    });
    server.middlewares.use((req, res, next) => {
      if (req.url?.includes("/default-entry/client.tsx")) {
        res.setHeader("cache-control", "no-store");
        // Revalidation is pointless for a no-store resource; drop the
        // conditional headers so the transform middleware replies 200.
        delete req.headers["if-none-match"];
        delete req.headers["if-modified-since"];
      }
      next();
    });
  },
};

export default defineConfig({
  server: {
    port: 3000,
    // Remote access to the dev server: listen on all interfaces and skip
    // the Host-header allowlist (dev only; production serving is server.ts).
    host: true,
    allowedHosts: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    devStability,
    tailwindcss(),
    tanstackStart(),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
});
