import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { Data, Effect } from "effect";
import { appSecretValue } from "~/server/env";

export class DecryptionError extends Data.TaggedError("DecryptionError")<{
  message: string;
}> {}

/**
 * AES-256-GCM encryption for secrets at rest (agent API keys). The key is
 * derived from APP_SECRET via HKDF so rotating APP_SECRET invalidates stored
 * ciphertexts, which is documented behavior.
 */
export class Crypto extends Effect.Service<Crypto>()("Crypto", {
  sync: () => {
    const key = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(appSecretValue(), "utf8"),
        Buffer.alloc(0),
        "parley.agent-api-keys.v1",
        32,
      ),
    );

    const encrypt = (plaintext: string): string => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64");
    };

    const decrypt = (ciphertext: string) =>
      Effect.try({
        try: () => {
          const raw = Buffer.from(ciphertext, "base64");
          const iv = raw.subarray(0, 12);
          const tag = raw.subarray(12, 28);
          const data = raw.subarray(28);
          const decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAuthTag(tag);
          return Buffer.concat([
            decipher.update(data),
            decipher.final(),
          ]).toString("utf8");
        },
        catch: () =>
          new DecryptionError({
            message:
              "Failed to decrypt stored secret. Was APP_SECRET rotated? Re-enter the agent API key.",
          }),
      });

    return { encrypt, decrypt };
  },
}) {}
