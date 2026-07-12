import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  A2UI_DEFAULT_ENABLED_PLUGIN_KEYS,
  normalizeA2uiCatalogPluginKeys,
} from "~/lib/a2ui-catalog-plugins";
import {
  type RuntimeSettings,
  RuntimeSettingsSchema,
} from "~/lib/settings-schema";
import { Db, schema } from "~/server/db/client";
import { appEnv } from "~/server/env";

export { type RuntimeSettings, RuntimeSettingsSchema };

export const defaultSettings = (): RuntimeSettings => ({
  appName: "Parley",
  appTagline: "Talk to your agents",
  appLogoUrl: null,
  registrationEnabled: true,
  allowUserAgents: appEnv.allowUserAgents,
  defaultAgentId: null,
  customCss: null,
  chatDisclaimer: null,
  enabledA2uiCatalogPluginKeys: [...A2UI_DEFAULT_ENABLED_PLUGIN_KEYS],
});

const normalizeSettings = (settings: RuntimeSettings): RuntimeSettings => ({
  ...settings,
  enabledA2uiCatalogPluginKeys: normalizeA2uiCatalogPluginKeys(
    settings.enabledA2uiCatalogPluginKeys,
  ),
});

interface CacheEntry {
  value: RuntimeSettings;
  expiresAt: number;
}

const CACHE_TTL_MS = 10_000;
const cacheBox: { current: CacheEntry | null } = { current: null };

export class Settings extends Effect.Service<Settings>()("Settings", {
  effect: Effect.gen(function* () {
    const { db } = yield* Db;

    const load = Effect.gen(function* () {
      const rows = yield* Effect.promise(() =>
        db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.id, "default")),
      );
      const stored = (rows[0]?.data ?? {}) as Partial<RuntimeSettings>;
      const enabledA2uiCatalogPluginKeys = Object.hasOwn(
        stored,
        "enabledA2uiCatalogPluginKeys",
      )
        ? normalizeA2uiCatalogPluginKeys(stored.enabledA2uiCatalogPluginKeys)
        : [...A2UI_DEFAULT_ENABLED_PLUGIN_KEYS];
      const merged = normalizeSettings({
        ...defaultSettings(),
        ...stored,
        enabledA2uiCatalogPluginKeys,
      });
      cacheBox.current = {
        value: merged,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      return merged;
    });

    const get = Effect.suspend(() => {
      const cached = cacheBox.current;
      return cached && cached.expiresAt > Date.now()
        ? Effect.succeed(cached.value)
        : load;
    });

    const update = (patch: Partial<RuntimeSettings>) =>
      Effect.gen(function* () {
        const current = yield* load;
        const next = normalizeSettings(
          yield* Schema.decodeUnknown(RuntimeSettingsSchema)({
            ...current,
            ...patch,
          }),
        );
        yield* Effect.promise(() =>
          db
            .insert(schema.settings)
            .values({ id: "default", data: next, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: schema.settings.id,
              set: { data: next, updatedAt: new Date() },
            }),
        );
        cacheBox.current = {
          value: next,
          expiresAt: Date.now() + CACHE_TTL_MS,
        };
        return next;
      });

    return { get, update };
  }),
  dependencies: [Db.Default],
}) {}
