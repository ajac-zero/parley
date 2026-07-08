import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import {
  actorOf,
  requireUser,
  runApp,
  runAppOrThrow,
} from "~/functions/context";
import { AgentInputSchema } from "~/lib/agent-schema";
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

export const deleteAgent = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ id: Schema.String })))
  .handler(async ({ data }) => {
    const session = await requireUser();
    await runAppOrThrow(
      Effect.flatMap(Agents, (a) => a.remove(actorOf(session), data.id)),
    );
    return { ok: true };
  });
