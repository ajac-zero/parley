/**
 * Production entrypoint (Bun).
 *
 * Serves the static client build with sensible cache headers and delegates
 * every other request — SSR, server functions, and /api routes — to the
 * TanStack Start fetch handler produced by `vite build`.
 *
 * Run with: bun run server.ts (or `bun run start`).
 */
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import handler from "./dist/server/server.js";

const clientDir = join(import.meta.dir, "dist", "client");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!existsSync(join(clientDir, "assets"))) {
  console.error(
    "[parley] dist/client not found - run `bun run build` before `bun run start`.",
  );
  process.exit(1);
}

const server = Bun.serve({
  port,
  // Long-running SSE turns; never kill a streaming response mid-flight.
  idleTimeout: 240,
  async fetch(request) {
    const url = new URL(request.url);

    // Static assets (hashed filenames under /assets get immutable caching).
    if (request.method === "GET" || request.method === "HEAD") {
      const pathname = normalize(decodeURIComponent(url.pathname));
      if (!pathname.includes("..") && pathname !== "/") {
        const file = Bun.file(join(clientDir, pathname));
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "cache-control": pathname.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "public, max-age=3600",
            },
          });
        }
      }
    }

    return handler.fetch(request);
  },
});

console.log(`[parley] listening on http://localhost:${server.port}`);
