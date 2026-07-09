import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import {
  actorOf,
  requireUser,
  runApp,
  runAppOrThrow,
} from "~/functions/context";
import { prefillFromAgentCard } from "~/lib/agent-card";
import { AgentInputSchema } from "~/lib/agent-schema";
import { fetchAgentCard } from "~/server/agent-card";
import { Agents, toPublicAgent } from "~/server/services/agents";

// `strict: false` relaxes type-level serialization checks: agent `params` are
// arbitrary JSON by design (they are forwarded to the agent verbatim).
export const listAgents = createServerFn({
  method: "GET",
  strict: false,
}).handler(async () => {
  const session = await requireUser();
  const rows = await runApp(
    Effect.flatMap(Agents, (a) => a.listVisible(actorOf(session))),
  );
  return rows.map(toPublicAgent);
});

export const createAgent = createServerFn({ method: "POST", strict: false })
  .validator(Schema.standardSchemaV1(AgentInputSchema))
  .handler(async ({ data }) => {
    const session = await requireUser();
    const row = await runAppOrThrow(
      Effect.flatMap(Agents, (a) =>
        a.create(actorOf(session), { ...data, params: data.params ?? null }),
      ),
    );
    return toPublicAgent(row);
  });

export const updateAgent = createServerFn({ method: "POST", strict: false })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({ id: Schema.String, agent: AgentInputSchema }),
    ),
  )
  .handler(async ({ data }) => {
    const session = await requireUser();
    const row = await runAppOrThrow(
      Effect.flatMap(Agents, (a) =>
        a.update(actorOf(session), data.id, {
          ...data.agent,
          params: data.agent.params ?? null,
        }),
      ),
    );
    return toPublicAgent(row);
  });

/**
 * Resolves an A2A well-known agent card (/.well-known/agent-card.json) for a
 * user-supplied URL and maps it onto agent form fields. `baseUrl` is only
 * present when the card declares an Open Responses interface (strict
 * `protocolBinding` match — see OPEN_RESPONSES_PROTOCOL_BINDING).
 */
export const importAgentCard = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        url: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
      }),
    ),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const { cardUrl, card } = await runAppOrThrow(fetchAgentCard(data.url));
    return { cardUrl, prefill: prefillFromAgentCard(card) };
  });

export const deleteAgent = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ id: Schema.String })))
  .handler(async ({ data }) => {
    const session = await requireUser();
    await runAppOrThrow(
      Effect.flatMap(Agents, (a) => a.remove(actorOf(session), data.id)),
    );
    return { ok: true };
  });
