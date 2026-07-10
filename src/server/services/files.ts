import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { Db, schema } from "~/server/db/client";
import { appEnv } from "~/server/env";
import { fileId } from "~/server/ids";
import { S3 } from "~/server/services/s3";

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

/** Presigned URL lifetime handed to agents — just long enough to cover a slow fetch. */
const PRESIGNED_URL_TTL_SECONDS = 600;

export class Files extends Effect.Service<Files>()("Files", {
  effect: Effect.gen(function* () {
    const { db } = yield* Db;
    const s3 = yield* S3;
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
        const storageKey = `${userId}/${id}`;
        yield* s3.putObject(storageKey, data, mimeType);
        yield* Effect.promise(() =>
          db.insert(schema.files).values({
            id,
            userId,
            name: name.slice(0, 300) || "file",
            mimeType: mimeType.slice(0, 200) || "application/octet-stream",
            size: data.byteLength,
            storageKey,
          }),
        );
        return { id, name, mimeType, size: data.byteLength };
      });

    /** Ownership-checked metadata lookup (no bytes). */
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

    /** Ownership-checked byte fetch, e.g. for direct download or base64 hydration. */
    const getBytes = (userId: string, id: string) =>
      Effect.gen(function* () {
        const file = yield* getOwned(userId, id);
        const data = yield* s3.getObjectBytes(file.storageKey);
        return { ...file, data };
      });

    /**
     * Presigned URL for an external agent to fetch the file directly, or
     * `null` if no publicly-reachable S3 endpoint is configured — callers
     * should fall back to inlining base64 via `getBytes` in that case.
     */
    const getUrl = (userId: string, id: string) =>
      Effect.gen(function* () {
        const file = yield* getOwned(userId, id);
        const url = yield* s3.getPresignedUrl(
          file.storageKey,
          PRESIGNED_URL_TTL_SECONDS,
        );
        return { file, url };
      });

    return { save, getOwned, getBytes, getUrl, maxBytes };
  }),
  dependencies: [Db.Default, S3.Default],
}) {}
