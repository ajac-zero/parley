import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { requireAdmin, runApp } from "~/functions/context";
import { RuntimeSettingsSchema } from "~/lib/settings-schema";
import { auth } from "~/server/auth";
import { Settings } from "~/server/services/settings";

/* --------------------------------- users --------------------------------- */

export const listUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const request = getRequest();
  const result = await auth.api.listUsers({
    headers: request.headers,
    query: { limit: 500, sortBy: "createdAt", sortDirection: "asc" },
  });
  return result.users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: (user as { role?: string | null }).role ?? "user",
    banned: (user as { banned?: boolean | null }).banned ?? false,
    createdAt:
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : String(user.createdAt),
  }));
});

export type AdminUser = Awaited<ReturnType<typeof listUsers>>[number];

export const setUserRole = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        userId: Schema.String,
        role: Schema.Literal("admin", "user"),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    if (data.userId === session.user.id && data.role !== "admin") {
      throw new Error("You cannot demote yourself.");
    }
    const request = getRequest();
    await auth.api.setRole({
      headers: request.headers,
      body: { userId: data.userId, role: data.role },
    });
    return { ok: true };
  });

export const setUserBanned = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({ userId: Schema.String, banned: Schema.Boolean }),
    ),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    if (data.userId === session.user.id) {
      throw new Error("You cannot ban yourself.");
    }
    const request = getRequest();
    if (data.banned) {
      await auth.api.banUser({
        headers: request.headers,
        body: { userId: data.userId },
      });
    } else {
      await auth.api.unbanUser({
        headers: request.headers,
        body: { userId: data.userId },
      });
    }
    return { ok: true };
  });

export const removeUser = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ userId: Schema.String })))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    if (data.userId === session.user.id) {
      throw new Error("You cannot delete your own account here.");
    }
    const request = getRequest();
    await auth.api.removeUser({
      headers: request.headers,
      body: { userId: data.userId },
    });
    return { ok: true };
  });

/* -------------------------------- settings ------------------------------- */

export const getAdminSettings = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireAdmin();
    return runApp(Effect.flatMap(Settings, (s) => s.get));
  },
);

const SettingsPatchSchema = Schema.partial(RuntimeSettingsSchema);

export const updateSettings = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(SettingsPatchSchema))
  .handler(async ({ data }) => {
    await requireAdmin();
    return runApp(
      Effect.flatMap(Settings, (s) => s.update(data)).pipe(
        Effect.catchTag("ParseError", () =>
          Effect.die(new Error("Invalid settings.")),
        ),
      ),
    );
  });
