import { Schema } from "effect";

/**
 * Input schema for creating/updating agents.
 *
 * Lives in `src/lib` (client-safe, no server imports) because server-function
 * validators are bundled isomorphically — importing this from the Agents
 * service would drag the database/crypto graph into the browser bundle.
 */
export const AgentInputSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.NullOr(Schema.String.pipe(Schema.maxLength(500))),
  avatar: Schema.NullOr(Schema.String.pipe(Schema.maxLength(16))),
  baseUrl: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  /** A2A well-known agent card URL this agent was imported from, if any. */
  cardUrl: Schema.optionalWith(
    Schema.NullOr(Schema.String.pipe(Schema.maxLength(2000))),
    { default: () => null },
  ),
  /** Plaintext API key; null keeps the existing key, "" clears it. */
  apiKey: Schema.optional(
    Schema.NullOr(Schema.String.pipe(Schema.maxLength(4000))),
  ),
  model: Schema.NullOr(Schema.String.pipe(Schema.maxLength(200))),
  instructions: Schema.NullOr(Schema.String.pipe(Schema.maxLength(32_000))),
  continuation: Schema.Literal("replay", "previous_response_id"),
  supportsImages: Schema.Boolean,
  supportsFiles: Schema.Boolean,
  params: Schema.NullOr(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  isEnabled: Schema.Boolean,
  /** Admins only: create/edit a global agent (ownerId = null). */
  global: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export type AgentInput = typeof AgentInputSchema.Type;
