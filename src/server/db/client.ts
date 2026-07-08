import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Effect } from "effect";
import postgres from "postgres";
import { appEnv } from "~/server/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

interface DbHandle {
  sql: postgres.Sql;
  db: Database;
}

function createDb(): DbHandle {
  const sql = postgres(appEnv.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return { sql, db: drizzle(sql, { schema, casing: "snake_case" }) };
}

/** Singleton across Vite HMR reloads so we don't leak connection pools. */
const globalKey = Symbol.for("parley.db");
const store = globalThis as unknown as Record<symbol, DbHandle | undefined>;
const handle: DbHandle = store[globalKey] ?? (store[globalKey] = createDb());

export const db = handle.db;
export const sql = handle.sql;

/** Effect service wrapper around the Drizzle client. */
export class Db extends Effect.Service<Db>()("Db", {
  succeed: { db, sql },
}) {}

export { schema };
