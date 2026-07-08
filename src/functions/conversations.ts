import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import {
  actorOf,
  requireUser,
  runApp,
  runAppOrThrow,
} from "~/functions/context";
import type { ORItem } from "~/lib/openresponses";
import { Db, schema } from "~/server/db/client";
import { Agents, toPublicAgent } from "~/server/services/agents";
import { Conversations } from "~/server/services/conversations";
import { Turns } from "~/server/services/turns";

export const listConversations = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = await requireUser();
    const rows = await runApp(
      Effect.flatMap(Conversations, (c) => c.listForUser(session.user.id)),
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      agentId: row.agentId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },
);

export type ConversationSummary = Awaited<
  ReturnType<typeof listConversations>
>[number];

const GetConversationInput = Schema.standardSchemaV1(
  Schema.Struct({ conversationId: Schema.String }),
);

// `strict: false`: transcript payloads are arbitrary Open Responses JSON.
export const getConversation = createServerFn({ method: "GET", strict: false })
  .validator(GetConversationInput)
  .handler(async ({ data }) => {
    const session = await requireUser();
    const actor = actorOf(session);

    const result = await runApp(
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const agents = yield* Agents;
        const turns = yield* Turns;
        const { db } = yield* Db;

        const conversation = yield* conversations
          .getOwned(session.user.id, data.conversationId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (!conversation) return null;

        const items = yield* conversations.listItems(conversation.id);
        const turnRows = yield* Effect.promise(() =>
          db
            .select({
              id: schema.turns.id,
              status: schema.turns.status,
              error: schema.turns.error,
              usage: schema.turns.usage,
              createdAt: schema.turns.createdAt,
            })
            .from(schema.turns)
            .where(eq(schema.turns.conversationId, conversation.id))
            .orderBy(asc(schema.turns.createdAt)),
        );
        const active = yield* turns.activeTurnFor(conversation.id);

        const agent = conversation.agentId
          ? yield* agents
              .getVisible(actor, conversation.agentId)
              .pipe(Effect.catchAll(() => Effect.succeed(null)))
          : null;

        return {
          conversation: {
            id: conversation.id,
            title: conversation.title,
            agentId: conversation.agentId,
            createdAt: conversation.createdAt.toISOString(),
            updatedAt: conversation.updatedAt.toISOString(),
          },
          agent: agent ? toPublicAgent(agent) : null,
          items: items.map((item) => ({
            id: item.id,
            turnId: item.turnId,
            source: item.source,
            payload: item.payload as unknown as ORItem,
            createdAt: item.createdAt.toISOString(),
          })),
          turns: turnRows.map((turn) => ({
            id: turn.id,
            status: turn.status,
            error: turn.error,
            usage: turn.usage,
            createdAt: turn.createdAt.toISOString(),
          })),
          activeTurnId: Option.isSome(active) ? active.value.id : null,
        };
      }),
    );

    return result;
  });

export type ConversationDetail = NonNullable<
  Awaited<ReturnType<typeof getConversation>>
>;

const RenameInput = Schema.standardSchemaV1(
  Schema.Struct({
    conversationId: Schema.String,
    title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  }),
);

export const renameConversation = createServerFn({ method: "POST" })
  .validator(RenameInput)
  .handler(async ({ data }) => {
    const session = await requireUser();
    await runAppOrThrow(
      Effect.flatMap(Conversations, (c) =>
        c.rename(session.user.id, data.conversationId, data.title),
      ),
    );
    return { ok: true };
  });

const DeleteInput = Schema.standardSchemaV1(
  Schema.Struct({ conversationId: Schema.String }),
);

export const deleteConversation = createServerFn({ method: "POST" })
  .validator(DeleteInput)
  .handler(async ({ data }) => {
    const session = await requireUser();
    await runAppOrThrow(
      Effect.flatMap(Conversations, (c) =>
        c.remove(session.user.id, data.conversationId),
      ),
    );
    return { ok: true };
  });
