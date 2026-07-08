import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { appEnv } from "~/server/env";
import { jsonError, requireSession } from "~/server/http";
import { serverRuntime } from "~/server/runtime";
import { Files } from "~/server/services/files";

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      /** Upload an attachment (multipart/form-data with a `file` field). */
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return jsonError(400, "Expected multipart/form-data.");
        }
        const file = form.get("file");
        if (!(file instanceof File)) {
          return jsonError(400, "Missing `file` field.");
        }
        if (file.size > appEnv.fileMaxMb * 1024 * 1024) {
          return jsonError(
            413,
            `File exceeds the ${appEnv.fileMaxMb} MB limit.`,
          );
        }

        const bytes = new Uint8Array(await file.arrayBuffer());

        const result = await serverRuntime.runPromise(
          Effect.gen(function* () {
            const files = yield* Files;
            return yield* files.save(
              session.user.id,
              file.name,
              file.type || "application/octet-stream",
              bytes,
            );
          }).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catchTag("FileTooLargeError", (error) =>
              Effect.succeed({ ok: false as const, message: error.message }),
            ),
          ),
        );

        if (!result.ok) return jsonError(413, result.message);
        return Response.json(result.value);
      },
    },
  },
});
