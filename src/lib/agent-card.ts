import { Schema } from "effect";

/**
 * A2A Agent Card support (A2A spec v1.0, section 4.4 / 8).
 *
 * Agents publish a self-describing manifest at
 * `https://{domain}/.well-known/agent-card.json`. We use it to register an
 * agent from a single URL: metadata (name, description, capabilities) comes
 * from the card, and the Open Responses base URL is discovered from the
 * card's `supportedInterfaces`.
 *
 * A2A has no official Open Responses protocol binding, so we follow the
 * spec's custom-binding rule (section 5.8: identify custom bindings by URI)
 * and require the exact identifier in {@link OPEN_RESPONSES_PROTOCOL_BINDING}.
 *
 * Lives in `src/lib` (client-safe, no server imports) — the schema doubles
 * as the server-side response validator and the client-side type source.
 */

/** RFC 8615 well-known path registered by the A2A spec (section 14.3). */
export const WELL_KNOWN_AGENT_CARD_PATH = "/.well-known/agent-card.json";

/**
 * The exact `protocolBinding` value an agent card must declare on a
 * `supportedInterfaces` entry for us to treat its `url` as an Open Responses
 * base URL. Custom bindings are identified by URI per A2A spec section 5.8.
 */
export const OPEN_RESPONSES_PROTOCOL_BINDING = "https://openresponses.org/v1";

/**
 * Normalizes user input ("example.com", "https://example.com/anything",
 * or the well-known URL itself) into the canonical well-known card URL.
 * The card always lives at the domain root per the A2A spec.
 */
export function wellKnownAgentCardUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme); // throws on garbage — callers handle it
  return `${url.origin}${WELL_KNOWN_AGENT_CARD_PATH}`;
}

/** One entry of `supportedInterfaces` (A2A spec section 4.4.6). */
export const AgentInterfaceSchema = Schema.Struct({
  url: Schema.String,
  protocolBinding: Schema.String,
  protocolVersion: Schema.optional(Schema.String),
  tenant: Schema.optional(Schema.String),
});

/**
 * The subset of the A2A AgentCard (section 4.4.1) that Parley consumes.
 * Deliberately lenient: unknown fields are ignored and most fields are
 * optional so cards from older/newer spec revisions still import.
 */
export const AgentCardSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  iconUrl: Schema.optional(Schema.String),
  documentationUrl: Schema.optional(Schema.String),
  supportedInterfaces: Schema.Array(AgentInterfaceSchema),
  capabilities: Schema.optional(
    Schema.Struct({
      streaming: Schema.optional(Schema.Boolean),
      pushNotifications: Schema.optional(Schema.Boolean),
    }),
  ),
  defaultInputModes: Schema.optional(Schema.Array(Schema.String)),
  defaultOutputModes: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
      }),
    ),
  ),
});

export type AgentCard = typeof AgentCardSchema.Type;

/**
 * Finds the Open Responses endpoint declared by the card, if any.
 * Strict match on {@link OPEN_RESPONSES_PROTOCOL_BINDING}; interface order
 * expresses preference per the spec, so the first match wins.
 */
export function openResponsesInterfaceOf(card: AgentCard) {
  return (
    card.supportedInterfaces.find(
      (iface) => iface.protocolBinding === OPEN_RESPONSES_PROTOCOL_BINDING,
    ) ?? null
  );
}

const isImageMode = (mode: string) => mode.toLowerCase().startsWith("image/");
const isFileMode = (mode: string) => {
  const lower = mode.toLowerCase();
  // Anything beyond plain text / JSON / images suggests file input support.
  return (
    !lower.startsWith("text/") &&
    !isImageMode(lower) &&
    lower !== "application/json"
  );
};

/** Field values derived from an agent card, ready to prefill the agent form. */
export interface AgentCardPrefill {
  name: string;
  description: string | null;
  baseUrl: string | null;
  supportsImages: boolean;
  supportsFiles: boolean;
}

/** Maps a validated card onto Parley's agent fields (clamped to our limits). */
export function prefillFromAgentCard(card: AgentCard): AgentCardPrefill {
  const inputModes = card.defaultInputModes ?? [];
  return {
    name: card.name.slice(0, 80),
    description: card.description?.slice(0, 500) ?? null,
    baseUrl: openResponsesInterfaceOf(card)?.url ?? null,
    supportsImages: inputModes.some(isImageMode),
    supportsFiles: inputModes.some(isFileMode),
  };
}
