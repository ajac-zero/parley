import { Schema } from "effect";

/**
 * Runtime-editable deployment settings (branding + access control).
 *
 * Lives in `src/lib` (client-safe, no server imports) because it is used both
 * by the Settings service and by server-function validators, which are
 * bundled isomorphically — a server-side import here would drag the whole
 * database graph into the browser bundle.
 */
export const RuntimeSettingsSchema = Schema.Struct({
  appName: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(60)),
  appTagline: Schema.NullOr(Schema.String.pipe(Schema.maxLength(200))),
  appLogoUrl: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2000))),
  registrationEnabled: Schema.Boolean,
  allowUserAgents: Schema.Boolean,
  defaultAgentId: Schema.NullOr(Schema.String),
  /** Extra CSS injected globally — paste a tweakcn/shadcn theme here. */
  customCss: Schema.NullOr(Schema.String.pipe(Schema.maxLength(100_000))),
  chatDisclaimer: Schema.NullOr(Schema.String.pipe(Schema.maxLength(500))),
  /** Trusted catalog plugins enabled for this deployment. */
  enabledA2uiCatalogPluginKeys: Schema.Array(Schema.String),
});

export type RuntimeSettings = typeof RuntimeSettingsSchema.Type;
