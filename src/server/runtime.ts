import { Layer, ManagedRuntime } from "effect";
import { Db } from "~/server/db/client";
import { OpenResponsesClient } from "~/server/openresponses/client";
import { Agents } from "~/server/services/agents";
import { Conversations } from "~/server/services/conversations";
import { Crypto } from "~/server/services/crypto";
import { Files } from "~/server/services/files";
import { RateLimit } from "~/server/services/rate-limit";
import { Redis } from "~/server/services/redis";
import { S3 } from "~/server/services/s3";
import { Settings } from "~/server/services/settings";
import { Turns } from "~/server/services/turns";

const AppLayer = Layer.mergeAll(
  Db.Default,
  Redis.Default,
  S3.Default,
  Crypto.Default,
  Settings.Default,
  Agents.Default,
  Conversations.Default,
  Files.Default,
  RateLimit.Default,
  OpenResponsesClient.Default,
  Turns.Default,
);

export type AppRuntime = ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof AppLayer>,
  never
>;

function createRuntime(): AppRuntime {
  return ManagedRuntime.make(AppLayer);
}

/** Singleton across Vite HMR reloads. */
const globalKey = Symbol.for("parley.runtime");
const store = globalThis as unknown as Record<symbol, AppRuntime | undefined>;

export const serverRuntime: AppRuntime =
  store[globalKey] ?? (store[globalKey] = createRuntime());
