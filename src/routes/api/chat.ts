import { createFileRoute } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { MAX_MESSAGE_ATTACHMENTS } from "~/lib/limits";
import { jsonError, requireSession, sseResponse } from "~/server/http";
import { serverRuntime } from "~/server/runtime";
import { Turns } from "~/server/services/turns";

const ChatRequestSchema = Schema.Struct({
  conversationId: Schema.optional(Schema.NullOr(Schema.String)),
  agentId: Schema.optional(Schema.NullOr(Schema.String)),
  message: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        text: Schema.String.pipe(Schema.maxLength(64_000)),
        fileIds: Schema.optionalWith(
          Schema.Array(Schema.String).pipe(
            Schema.maxItems(MAX_MESSAGE_ATTACHMENTS),
          ),
          { default: () => [] },
        ),
        /** A2UI client -> server messages (user actions from surfaces). */
        a2ui: Schema.optionalWith(
          Schema.Array(Schema.Unknown).pipe(Schema.maxItems(16)),
          { default: () => [] },
        ),
      }),
    ),
  ),
  regenerate: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  editFromItemId: Schema.optional(Schema.NullOr(Schema.String)),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      /**
       * Starts a turn and streams its events as SSE. The turn keeps running
       * server-side even if this connection drops; reconnect via
       * GET /api/chat/{turnId}/stream.
       */
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return jsonError(400, "Request body must be valid JSON.");
        }

        const decoded = Schema.decodeUnknownEither(ChatRequestSchema)(raw);
        if (decoded._tag === "Left") {
          return jsonError(400, "Invalid chat request.");
        }
        const params = decoded.right;

        const actor = { userId: session.user.id, isAdmin: session.isAdmin };

        const result = await serverRuntime.runPromise(
          Effect.gen(function* () {
            const turns = yield* Turns;
            return yield* turns.start(actor, {
              conversationId: params.conversationId ?? null,
              agentId: params.agentId ?? null,
              message: params.message
                ? {
                    text: params.message.text,
                    fileIds: [...params.message.fileIds],
                    a2ui: [...params.message.a2ui],
                  }
                : null,
              regenerate: params.regenerate,
              editFromItemId: params.editFromItemId ?? null,
            });
          }).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catchTag("TurnError", (error) =>
              Effect.succeed({ ok: false as const, error }),
            ),
          ),
        );

        if (!result.ok) {
          return jsonError(result.error.status ?? 500, result.error.message);
        }

        const frames = await serverRuntime.runPromise(
          Effect.gen(function* () {
            const turns = yield* Turns;
            return turns.streamFrames(result.value.turnId, -1);
          }),
        );

        return sseResponse(frames, {
          headers: {
            "x-parley-turn-id": result.value.turnId,
            "x-parley-conversation-id": result.value.conversationId,
          },
        });
      },
    },
  },
});
