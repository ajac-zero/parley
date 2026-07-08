import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { jsonError, requireSession } from "~/server/http";
import { serverRuntime } from "~/server/runtime";
import { Turns } from "~/server/services/turns";

export const Route = createFileRoute("/api/chat/$turnId/cancel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;

        const actor = { userId: session.user.id, isAdmin: session.isAdmin };

        const result = await serverRuntime.runPromise(
          Effect.gen(function* () {
            const turns = yield* Turns;
            yield* turns.cancel(actor, params.turnId);
          }).pipe(
            Effect.map(() => ({ ok: true as const })),
            Effect.catchTag("TurnError", (error) =>
              Effect.succeed({ ok: false as const, error }),
            ),
          ),
        );

        if (!result.ok) {
          return jsonError(result.error.status ?? 500, result.error.message);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
