import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { db, schema } from "~/server/db/client";
import { appEnv } from "~/server/env";

const DEMO_AGENT_ID = "agent_demo";

/** Arbitrary constant identifying Parley's migration lock cluster-wide. */
const MIGRATION_LOCK_KEY = 810_243_991;

async function runMigrations(): Promise<void> {
  const migrationClient = postgres(appEnv.databaseUrl, {
    max: 1,
    onnotice: () => {},
  });
  try {
    // Serialize migrations across replicas booting concurrently. The lock is
    // session-scoped; with max=1 every query below shares that session.
    await migrationClient`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await migrate(drizzle(migrationClient), {
        migrationsFolder: "./drizzle",
      });
    } finally {
      await migrationClient`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await migrationClient.end();
  }
}

/** Seed the standalone demo agent so fresh installs work out of the box. */
async function seedDemoAgent(): Promise<void> {
  if (!appEnv.demoAgent) return;
  const existing = await db
    .select({ id: schema.agents.id, baseUrl: schema.agents.baseUrl })
    .from(schema.agents)
    .where(eq(schema.agents.id, DEMO_AGENT_ID));
  if (existing.length > 0) {
    // Keep the managed demo row aligned with the separately deployed server.
    if (existing[0]?.baseUrl !== appEnv.demoAgentUrl) {
      await db
        .update(schema.agents)
        .set({ baseUrl: appEnv.demoAgentUrl })
        .where(eq(schema.agents.id, DEMO_AGENT_ID));
    }
    return;
  }

  const [agentCount] = await db.select({ value: count() }).from(schema.agents);
  const isFirstAgent = (agentCount?.value ?? 0) === 0;

  await db.insert(schema.agents).values({
    id: DEMO_AGENT_ID,
    ownerId: null,
    name: "Demo Agent",
    description:
      "A reference agent that showcases streaming, reasoning, tool calls, attachments, and generative UI.",
    avatar: "🤖",
    baseUrl: appEnv.demoAgentUrl,
    continuation: "replay",
    supportsImages: true,
    supportsFiles: true,
    isEnabled: true,
  });

  if (isFirstAgent) {
    console.log("[parley] Seeded the standalone demo agent.");
  }
}

async function bootOnce(): Promise<void> {
  await runMigrations();
  await seedDemoAgent();
  console.log("[parley] Boot complete: migrations applied.");
}

/** Runs migrations + seeding exactly once per process (cached across HMR). */
const globalKey = Symbol.for("parley.boot");
const store = globalThis as unknown as Record<
  symbol,
  Promise<void> | undefined
>;

export function ensureBoot(): Promise<void> {
  const cached = store[globalKey];
  if (cached) return cached;
  const promise = bootOnce().catch((error) => {
    store[globalKey] = undefined; // allow retry on next request
    throw error;
  });
  store[globalKey] = promise;
  return promise;
}
