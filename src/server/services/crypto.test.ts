import { Effect, Exit } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_SECRET = "unit-test-secret-with-enough-entropy-0123456789";
});

const withCrypto = async <A>(
  f: (crypto: {
    encrypt: (plaintext: string) => string;
    decrypt: (ciphertext: string) => Effect.Effect<string, unknown>;
  }) => A | Promise<A>,
): Promise<A> => {
  const { Crypto } = await import("./crypto");
  return Effect.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto;
      return yield* Effect.promise(async () => f(crypto));
    }).pipe(Effect.provide(Crypto.Default)),
  );
};

describe("Crypto service", () => {
  it("round-trips plaintext", async () => {
    await withCrypto(async (crypto) => {
      const ciphertext = crypto.encrypt("sk-secret-key-123");
      expect(ciphertext).not.toContain("sk-secret-key-123");
      const plaintext = await Effect.runPromise(
        crypto.decrypt(ciphertext) as Effect.Effect<string, never>,
      );
      expect(plaintext).toBe("sk-secret-key-123");
    });
  });

  it("produces distinct ciphertexts for identical plaintexts (random IV)", async () => {
    await withCrypto((crypto) => {
      expect(crypto.encrypt("same")).not.toBe(crypto.encrypt("same"));
    });
  });

  it("handles unicode and long inputs", async () => {
    await withCrypto(async (crypto) => {
      const input = `émoji ⚡ ${"x".repeat(4000)}`;
      const plaintext = await Effect.runPromise(
        crypto.decrypt(crypto.encrypt(input)) as Effect.Effect<string, never>,
      );
      expect(plaintext).toBe(input);
    });
  });

  it("rejects tampered ciphertexts", async () => {
    await withCrypto(async (crypto) => {
      const ciphertext = crypto.encrypt("secret");
      const raw = Buffer.from(ciphertext, "base64");
      raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;
      const exit = await Effect.runPromiseExit(
        crypto.decrypt(raw.toString("base64")),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  it("rejects garbage input", async () => {
    await withCrypto(async (crypto) => {
      const exit = await Effect.runPromiseExit(crypto.decrypt("not-base64!!"));
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });
});
