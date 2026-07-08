import { Config, Effect, LogLevel, Redacted } from "effect";

/**
 * Static (process-level) configuration, read once from the environment.
 * Runtime-tunable settings (branding, registration, ...) live in the
 * `settings` table and are managed from the admin panel instead.
 */
const envConfig = Config.all({
  databaseUrl: Config.string("DATABASE_URL").pipe(
    Config.withDefault("postgres://parley:parley@localhost:5433/parley"),
  ),
  redisUrl: Config.string("REDIS_URL").pipe(
    Config.withDefault("redis://localhost:6380"),
  ),
  /** Secret used for auth tokens and agent API key encryption at rest. */
  appSecret: Config.redacted("APP_SECRET").pipe(
    Config.withDefault(Redacted.make("parley-insecure-dev-secret")),
  ),
  /** Public origin of this deployment, e.g. https://parley.example.com */
  appUrl: Config.string("APP_URL").pipe(
    Config.withDefault("http://localhost:3000"),
  ),
  /** Expose the built-in demo agent and seed it on first boot. */
  demoAgent: Config.boolean("DEMO_AGENT").pipe(Config.withDefault(true)),
  /** Max upload size for attachments, in megabytes. */
  fileMaxMb: Config.number("FILE_MAX_MB").pipe(Config.withDefault(10)),
  /** Chat messages per user per minute. 0 disables rate limiting. */
  chatRateLimit: Config.number("CHAT_RATE_LIMIT").pipe(Config.withDefault(30)),
  /** Abort a turn if the agent sends no events for this many seconds. */
  turnIdleTimeoutSec: Config.number("TURN_IDLE_TIMEOUT_SEC").pipe(
    Config.withDefault(120),
  ),
  /** Hard cap on total turn duration, in seconds. */
  turnMaxDurationSec: Config.number("TURN_MAX_DURATION_SEC").pipe(
    Config.withDefault(600),
  ),
  /** Refuse to call agent endpoints resolving to private/loopback addresses. */
  blockPrivateAgentAddresses: Config.boolean(
    "BLOCK_PRIVATE_AGENT_ADDRESSES",
  ).pipe(Config.withDefault(false)),
  /** Allow non-admin users to register their own personal agents. */
  allowUserAgents: Config.boolean("ALLOW_USER_AGENTS").pipe(
    Config.withDefault(true),
  ),
  logLevel: Config.logLevel("LOG_LEVEL").pipe(
    Config.withDefault(LogLevel.Info),
  ),
});

export type AppEnv = Effect.Effect.Success<typeof envConfig>;

function loadEnv(): AppEnv {
  const env = Effect.runSync(envConfig);
  const isProd = process.env.NODE_ENV === "production";
  if (
    isProd &&
    Redacted.value(env.appSecret) === "parley-insecure-dev-secret"
  ) {
    throw new Error(
      "APP_SECRET must be set in production. Generate one with: openssl rand -base64 32",
    );
  }
  return env;
}

/** Cached across Vite HMR reloads. */
const globalKey = Symbol.for("parley.env");
const store = globalThis as unknown as Record<symbol, AppEnv | undefined>;

export const appEnv: AppEnv =
  store[globalKey] ?? (store[globalKey] = loadEnv());

export const appSecretValue = () => Redacted.value(appEnv.appSecret);
