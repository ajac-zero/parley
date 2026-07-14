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
  /** Seed the standalone demo agent on first boot. */
  demoAgent: Config.boolean("DEMO_AGENT").pipe(Config.withDefault(true)),
  /** Open Responses base URL of the independently running demo agent. */
  demoAgentUrl: Config.string("DEMO_AGENT_URL").pipe(
    Config.withDefault("http://localhost:8080/v1"),
  ),
  /** Max upload size for attachments, in megabytes. */
  fileMaxMb: Config.number("FILE_MAX_MB").pipe(Config.withDefault(10)),
  /** S3-compatible endpoint used to store uploaded attachments. */
  s3Endpoint: Config.string("S3_ENDPOINT").pipe(
    Config.withDefault("http://localhost:9000"),
  ),
  s3Region: Config.string("S3_REGION").pipe(Config.withDefault("us-east-1")),
  s3Bucket: Config.string("S3_BUCKET").pipe(Config.withDefault("parley")),
  s3AccessKeyId: Config.string("S3_ACCESS_KEY_ID").pipe(
    Config.withDefault("parley"),
  ),
  s3SecretAccessKey: Config.redacted("S3_SECRET_ACCESS_KEY").pipe(
    Config.withDefault(Redacted.make("parleyparley")),
  ),
  /** Required for MinIO and most non-AWS S3-compatible endpoints. */
  s3ForcePathStyle: Config.boolean("S3_FORCE_PATH_STYLE").pipe(
    Config.withDefault(true),
  ),
  /** Public S3 origin used for direct image URLs when configured. */
  s3PublicUrl: Config.string("S3_PUBLIC_URL").pipe(
    Config.withDefault(""),
    Config.map((v) => (v.trim().length > 0 ? v.trim() : null)),
  ),
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
  /** Lifetime of file_url capabilities handed to agents. */
  attachmentCapabilityTtlSec: Config.number(
    "ATTACHMENT_CAPABILITY_TTL_SEC",
  ).pipe(Config.withDefault(900)),
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
  if (isProd && Redacted.value(env.s3SecretAccessKey) === "parleyparley") {
    throw new Error(
      "S3_SECRET_ACCESS_KEY must be set in production for attachment storage.",
    );
  }
  if (
    !Number.isSafeInteger(env.attachmentCapabilityTtlSec) ||
    env.attachmentCapabilityTtlSec < env.turnMaxDurationSec + 60
  ) {
    throw new Error(
      "ATTACHMENT_CAPABILITY_TTL_SEC must be an integer at least 60 seconds longer than TURN_MAX_DURATION_SEC.",
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
