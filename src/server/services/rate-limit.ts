import { Data, Effect } from "effect";
import { appEnv } from "~/server/env";
import { Redis } from "~/server/services/redis";

export class RateLimitedError extends Data.TaggedError("RateLimitedError")<{
  message: string;
  retryAfterSec: number;
}> {}

export class RateLimit extends Effect.Service<RateLimit>()("RateLimit", {
  effect: Effect.gen(function* () {
    const { client } = yield* Redis;

    /** Fixed-window limiter: `limit` ops per minute per key. */
    const check = (bucket: string, key: string, limit: number) =>
      Effect.gen(function* () {
        if (limit <= 0) return;
        const minute = Math.floor(Date.now() / 60_000);
        const redisKey = `parley:rl:${bucket}:${key}:${minute}`;
        const count = yield* Effect.promise(async () => {
          const value = await client.incr(redisKey);
          if (value === 1) await client.expire(redisKey, 120);
          return value;
        });
        if (count > limit) {
          const retryAfterSec = 60 - (Math.floor(Date.now() / 1000) % 60);
          return yield* new RateLimitedError({
            message: "Rate limit exceeded. Please slow down.",
            retryAfterSec,
          });
        }
      });

    const chat = (userId: string) =>
      check("chat", userId, appEnv.chatRateLimit);

    return { check, chat };
  }),
  dependencies: [Redis.Default],
}) {}
