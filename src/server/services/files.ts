import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { Db, schema } from "~/server/db/client";
import { appEnv } from "~/server/env";
import { fileId } from "~/server/ids";

export class FileNotFoundError extends Data.TaggedError("FileNotFoundError")<{
  message: string;
}> {}

export class FileTooLargeError extends Data.TaggedError("FileTooLargeError")<{
  message: string;
}> {}

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const isImageMime = (mime: string) => ALLOWED_IMAGE_TYPES.has(mime);

export class Files extends Effect.Service<Files>()("Files", {
  effect: Effect.gen(function* () {
    const { db } = yield* Db;
    const maxBytes = Math.floor(appEnv.fileMaxMb * 1024 * 1024);

    const save = (
      userId: string,
      name: string,
      mimeType: string,
      data: Uint8Array,
    ) =>
      Effect.gen(function* () {
        if (data.byteLength > maxBytes) {
          return yield* new FileTooLargeError({
            message: `File exceeds the ${appEnv.fileMaxMb} MB limit.`,
          });
        }
        const id = fileId();
        yield* Effect.promise(() =>
          db.insert(schema.files).values({
            id,
            userId,
            name: name.slice(0, 300) || "file",
            mimeType: mimeType.slice(0, 200) || "application/octet-stream",
            size: data.byteLength,
            data,
          }),
        );
        return { id, name, mimeType, size: data.byteLength };
      });

    const getOwned = (userId: string, id: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(schema.files)
            .where(
              and(eq(schema.files.id, id), eq(schema.files.userId, userId)),
            ),
        );
        const row = rows[0];
        if (!row) {
          return yield* new FileNotFoundError({ message: "File not found." });
        }
        return row;
      });

    return { save, getOwned, maxBytes };
  }),
  dependencies: [Db.Default],
}) {}
