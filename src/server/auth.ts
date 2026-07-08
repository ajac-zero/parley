import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { count } from "drizzle-orm";
import { Effect } from "effect";
import { db, schema } from "~/server/db/client";
import { appEnv, appSecretValue } from "~/server/env";
import { serverRuntime } from "~/server/runtime";
import { redis } from "~/server/services/redis";
import { Settings } from "~/server/services/settings";

function createAuth() {
  return betterAuth({
    appName: "Parley",
    baseURL: appEnv.appUrl,
    secret: appSecretValue(),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    secondaryStorage: {
      get: async (key) => (await redis.get(`parley:auth:${key}`)) ?? null,
      set: async (key, value, ttl) => {
        if (ttl) await redis.set(`parley:auth:${key}`, value, "EX", ttl);
        else await redis.set(`parley:auth:${key}`, value);
      },
      delete: async (key) => {
        await redis.del(`parley:auth:${key}`);
      },
    },
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 60,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const [row] = await db.select({ value: count() }).from(schema.user);
            const isFirstUser = (row?.value ?? 0) === 0;
            if (isFirstUser) {
              // The first account on a fresh install becomes the admin.
              return { data: { ...user, role: "admin" } };
            }
            const settings = await serverRuntime.runPromise(
              Effect.flatMap(Settings, (s) => s.get),
            );
            if (!settings.registrationEnabled) {
              throw new APIError("FORBIDDEN", {
                message: "Registration is disabled on this deployment.",
              });
            }
            return { data: { ...user, role: "user" } };
          },
        },
      },
    },
    plugins: [admin(), tanstackStartCookies()],
    // Production: only the configured public origin (CSRF protection).
    // Development: also trust whatever origin the request came from, so the
    // dev server works when accessed remotely (LAN IPs, tunnels, ...).
    trustedOrigins:
      process.env.NODE_ENV === "production"
        ? [appEnv.appUrl]
        : (request) => {
            const origin = request?.headers.get("origin");
            return origin ? [appEnv.appUrl, origin] : [appEnv.appUrl];
          },
  });
}

/** Singleton across Vite HMR reloads. */
const globalKey = Symbol.for("parley.auth");
type Auth = ReturnType<typeof createAuth>;
const store = globalThis as unknown as Record<symbol, Auth | undefined>;

export const auth: Auth = store[globalKey] ?? (store[globalKey] = createAuth());

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: string;
};

export interface SessionInfo {
  user: SessionUser;
  isAdmin: boolean;
}

/** Reads and normalizes the session from request headers. */
export async function sessionFromHeaders(
  headers: Headers,
): Promise<SessionInfo | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const user = session.user as unknown as SessionUser & {
    role?: string | null;
  };
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      role: user.role ?? "user",
    },
    isAdmin: user.role === "admin",
  };
}
