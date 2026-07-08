import { Effect } from "effect";
import { Redis as IORedis } from "ioredis";
import { appEnv } from "~/server/env";

function createRedis(): IORedis {
  return new IORedis(appEnv.redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
}

/** Shared command connection, cached across Vite HMR reloads. */
const globalKey = Symbol.for("parley.redis");
const store = globalThis as unknown as Record<symbol, IORedis | undefined>;
export const redis: IORedis =
  store[globalKey] ?? (store[globalKey] = createRedis());

/**
 * Effect service exposing the shared command client plus a scoped factory for
 * dedicated subscriber connections (Redis pub/sub requires exclusive
 * connections while subscribed).
 */
export class Redis extends Effect.Service<Redis>()("Redis", {
  succeed: {
    client: redis,
    /** Acquire a dedicated connection, released with the scope. */
    subscriber: Effect.acquireRelease(
      Effect.sync(() => redis.duplicate()),
      (conn) =>
        Effect.promise(async () => {
          try {
            await conn.quit();
          } catch {
            conn.disconnect();
          }
        }),
    ),
  },
}) {}
