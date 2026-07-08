import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { ensureBoot } from "~/server/boot";
import { Db } from "~/server/db/client";
import { serverRuntime } from "~/server/runtime";
import { Redis } from "~/server/services/redis";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      /** Liveness/readiness probe: verifies boot, Postgres, and Redis. */
      GET: async () => {
        try {
          await ensureBoot();
          await serverRuntime.runPromise(
            Effect.gen(function* () {
              const { sql } = yield* Db;
              const { client } = yield* Redis;
              yield* Effect.promise(() => sql`select 1`);
              yield* Effect.promise(() => client.ping());
            }),
          );
          return Response.json({ ok: true });
        } catch (error) {
          console.error("[parley] health check failed:", error);
          return Response.json(
            { ok: false, error: "Dependency check failed." },
            { status: 503 },
          );
        }
      },
    },
  },
});
