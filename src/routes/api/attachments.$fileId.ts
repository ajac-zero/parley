import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { verifyAttachmentCapability } from "~/server/attachment-capability";
import { jsonError } from "~/server/http";
import { serverRuntime } from "~/server/runtime";
import { Files } from "~/server/services/files";

export const Route = createFileRoute("/api/attachments/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const userId = url.searchParams.get("user") ?? "";
        const expires = Number(url.searchParams.get("expires"));
        const signature = url.searchParams.get("signature") ?? "";
        if (
          !userId ||
          !verifyAttachmentCapability(params.fileId, userId, expires, signature)
        ) {
          return jsonError(403, "Invalid or expired attachment capability.");
        }

        const result = await serverRuntime.runPromise(
          Effect.gen(function* () {
            const files = yield* Files;
            return yield* files.getStream(userId, params.fileId);
          }).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catchTag("FileNotFoundError", () =>
              Effect.succeed({ ok: false as const }),
            ),
          ),
        );
        if (!result.ok) return jsonError(404, "File not found.");

        const { file, stream } = result.value;
        return new Response(stream, {
          headers: {
            "content-type": file.mimeType,
            "content-length": String(file.size),
            "content-disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
