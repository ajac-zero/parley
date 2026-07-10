import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { jsonError, requireSession } from "~/server/http";
import { serverRuntime } from "~/server/runtime";
import { Files, isImageMime } from "~/server/services/files";

export const Route = createFileRoute("/api/files/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;

        const result = await serverRuntime.runPromise(
          Effect.gen(function* () {
            const files = yield* Files;
            return yield* files.getBytes(session.user.id, params.fileId);
          }).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catchTag("FileNotFoundError", () =>
              Effect.succeed({ ok: false as const }),
            ),
          ),
        );

        if (!result.ok) return jsonError(404, "File not found.");
        const file = result.value;

        const disposition = isImageMime(file.mimeType)
          ? "inline"
          : `attachment; filename="${encodeURIComponent(file.name)}"`;

        const body = new Uint8Array(file.data);
        return new Response(body, {
          headers: {
            "content-type": file.mimeType,
            "content-length": String(body.byteLength),
            "content-disposition": disposition,
            "cache-control": "private, max-age=3600",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
