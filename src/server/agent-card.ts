import { Data, Effect, Schema } from "effect";
import {
  type AgentCard,
  AgentCardSchema,
  wellKnownAgentCardUrl,
} from "~/lib/agent-card";
import { validateAgentUrl } from "~/server/openresponses/client";

export class AgentCardError extends Data.TaggedError("AgentCardError")<{
  message: string;
}> {}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CARD_BYTES = 256 * 1024; // agent cards are small JSON documents

/**
 * Resolves the well-known agent card for a user-supplied URL.
 * Reuses the agent-endpoint SSRF guard (BLOCK_PRIVATE_AGENT_ADDRESSES) since
 * this is a server-side fetch of an arbitrary user-provided host.
 */
export const fetchAgentCard = (
  input: string,
): Effect.Effect<{ cardUrl: string; card: AgentCard }, AgentCardError> =>
  Effect.gen(function* () {
    const cardUrl = yield* Effect.try({
      try: () => wellKnownAgentCardUrl(input),
      catch: () => new AgentCardError({ message: `Invalid URL: ${input}` }),
    });

    yield* validateAgentUrl(cardUrl).pipe(
      Effect.mapError(
        (error) => new AgentCardError({ message: error.message }),
      ),
    );

    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(cardUrl, {
          headers: { accept: "application/json" },
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      catch: (error) => {
        const detail =
          error instanceof Error && error.name === "TimeoutError"
            ? "timed out"
            : error instanceof Error
              ? error.message
              : String(error);
        return new AgentCardError({
          message: `Could not reach ${cardUrl} (${detail}).`,
        });
      },
    });

    if (!res.ok) {
      return yield* new AgentCardError({
        message:
          res.status === 404
            ? `No agent card found at ${cardUrl}. The agent must publish one at /.well-known/agent-card.json.`
            : `Agent card request failed: HTTP ${res.status} from ${cardUrl}.`,
      });
    }

    const text = yield* Effect.tryPromise({
      try: () => res.text(),
      catch: () =>
        new AgentCardError({ message: "Failed to read the agent card body." }),
    });
    if (text.length > MAX_CARD_BYTES) {
      return yield* new AgentCardError({
        message: "Agent card is too large (max 256 KiB).",
      });
    }

    const json = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () =>
        new AgentCardError({ message: "Agent card is not valid JSON." }),
    });

    const card = yield* Schema.decodeUnknown(AgentCardSchema, {
      onExcessProperty: "ignore",
    })(json).pipe(
      Effect.mapError(
        () =>
          new AgentCardError({
            message:
              "The document at /.well-known/agent-card.json is not a valid A2A agent card (missing name or supportedInterfaces).",
          }),
      ),
    );

    return { cardUrl, card };
  });
