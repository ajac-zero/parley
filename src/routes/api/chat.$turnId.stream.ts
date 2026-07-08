import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { jsonError, requireSession, sseResponse } from "~/server/http";
import { serverRuntime } from "~/server/runtime";
import { Turns } from "~/server/services/turns";

export const Route = createFileRoute("/api/chat/$turnId/stream")({
  server: {
    handlers: {
      /**
       * (Re)attach to a running or recently finished turn. `?after=<index>`
       * skips frames already seen (the SSE `id` field carries the index).
       */
      GET: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;

        const url = new URL(request.url);
        const afterRaw =
          url.searchParams.get("after") ??
          request.headers.get("last-event-id") ??
          "-1";
        const after = Number.parseInt(afterRaw, 10);
        const afterIndex = Number.isFinite(after) ? after : -1;

        const actor = { userId: session.user.id, isAdmin: session.isAdmin };

        const result = await serverRuntime.runPromise(
          Effect.gen(function* () {
            const turns = yield* Turns;
            yield* turns.getOwned(actor, params.turnId);
            return turns.streamFrames(params.turnId, afterIndex);
          }).pipe(
            Effect.map((frames) => ({ ok: true as const, frames })),
            Effect.catchTag("TurnError", (error) =>
              Effect.succeed({ ok: false as const, error }),
            ),
          ),
        );

        if (!result.ok) {
          return jsonError(result.error.status ?? 500, result.error.message);
        }

        return sseResponse(result.frames, {
          headers: { "x-parley-turn-id": params.turnId },
        });
      },
    },
  },
});
