import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { ensureBoot } from "~/server/boot";
import { Db } from "~/server/db/client";
import { serverRuntime } from "~/server/runtime";
import { Redis } from "~/server/services/redis";
import { S3 } from "~/server/services/s3";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      /** Liveness/readiness probe: verifies boot, Postgres, Redis, and S3. */
      GET: async () => {
        try {
          await ensureBoot();
          await serverRuntime.runPromise(
            Effect.gen(function* () {
              const { sql } = yield* Db;
              const { client } = yield* Redis;
              const s3 = yield* S3;
              yield* Effect.promise(() => sql`select 1`);
              yield* Effect.promise(() => client.ping());
              yield* s3.ping;
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
