import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { ORItem } from "~/lib/openresponses";
import { Db, schema } from "~/server/db/client";
import { conversationId, itemId } from "~/server/ids";

export class ConversationNotFoundError extends Data.TaggedError(
  "ConversationNotFoundError",
)<{ message: string }> {}

export type ConversationRow = typeof schema.conversations.$inferSelect;
export type ConversationItemRow = typeof schema.conversationItems.$inferSelect;

export const titleFromText = (text: string): string => {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "New chat";
  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}...` : cleaned;
};

export class Conversations extends Effect.Service<Conversations>()(
  "Conversations",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* Db;

      const listForUser = (userId: string) =>
        Effect.promise(() =>
          db
            .select({
              id: schema.conversations.id,
              title: schema.conversations.title,
              agentId: schema.conversations.agentId,
              createdAt: schema.conversations.createdAt,
              updatedAt: schema.conversations.updatedAt,
            })
            .from(schema.conversations)
            .where(eq(schema.conversations.userId, userId))
            .orderBy(desc(schema.conversations.updatedAt))
            .limit(200),
        );

      const getOwned = (userId: string, id: string) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(() =>
            db
              .select()
              .from(schema.conversations)
              .where(
                and(
                  eq(schema.conversations.id, id),
                  eq(schema.conversations.userId, userId),
                ),
              ),
          );
          const row = rows[0];
          if (!row) {
            return yield* new ConversationNotFoundError({
              message: "Conversation not found.",
            });
          }
          return row;
        });

      const create = (userId: string, agentIdValue: string, title: string) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(() =>
            db
              .insert(schema.conversations)
              .values({
                id: conversationId(),
                userId,
                agentId: agentIdValue,
                title,
              })
              .returning(),
          );
          return rows[0] as ConversationRow;
        });

      const rename = (userId: string, id: string, title: string) =>
        Effect.gen(function* () {
          yield* getOwned(userId, id);
          yield* Effect.promise(() =>
            db
              .update(schema.conversations)
              .set({ title, updatedAt: new Date() })
              .where(eq(schema.conversations.id, id)),
          );
        });

      const remove = (userId: string, id: string) =>
        Effect.gen(function* () {
          yield* getOwned(userId, id);
          yield* Effect.promise(() =>
            db
              .delete(schema.conversations)
              .where(eq(schema.conversations.id, id)),
          );
        });

      const touch = (id: string) =>
        Effect.promise(() =>
          db
            .update(schema.conversations)
            .set({ updatedAt: new Date() })
            .where(eq(schema.conversations.id, id)),
        );

      const setLastResponseId = (id: string, responseId: string | null) =>
        Effect.promise(() =>
          db
            .update(schema.conversations)
            .set({ lastResponseId: responseId, updatedAt: new Date() })
            .where(eq(schema.conversations.id, id)),
        );

      const listItems = (conversationIdValue: string) =>
        Effect.promise(() =>
          db
            .select()
            .from(schema.conversationItems)
            .where(
              eq(schema.conversationItems.conversationId, conversationIdValue),
            )
            .orderBy(asc(schema.conversationItems.seq)),
        );

      const appendItems = (
        conversationIdValue: string,
        turnIdValue: string | null,
        source: "user" | "agent",
        payloads: ORItem[],
      ) =>
        Effect.gen(function* () {
          if (payloads.length === 0) return [] as ConversationItemRow[];
          const values = payloads.map((payload) => ({
            id: itemId(),
            conversationId: conversationIdValue,
            turnId: turnIdValue,
            source,
            payload: payload as unknown as Record<string, unknown>,
          }));
          const rows = yield* Effect.promise(() =>
            db.insert(schema.conversationItems).values(values).returning(),
          );
          // bigserial assigns seq in insert order within the statement
          return rows.sort((a, b) => a.seq - b.seq);
        });

      /** Deletes an item and everything after it (edit & resend). */
      const truncateFromItem = (
        conversationIdValue: string,
        itemIdValue: string,
      ) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(() =>
            db
              .select({ seq: schema.conversationItems.seq })
              .from(schema.conversationItems)
              .where(
                and(
                  eq(
                    schema.conversationItems.conversationId,
                    conversationIdValue,
                  ),
                  eq(schema.conversationItems.id, itemIdValue),
                ),
              ),
          );
          const target = rows[0];
          if (!target) {
            return yield* new ConversationNotFoundError({
              message: "Message not found in this conversation.",
            });
          }
          yield* Effect.promise(() =>
            db
              .delete(schema.conversationItems)
              .where(
                and(
                  eq(
                    schema.conversationItems.conversationId,
                    conversationIdValue,
                  ),
                  gte(schema.conversationItems.seq, target.seq),
                ),
              ),
          );
          // Response chaining is broken by the truncation.
          yield* setLastResponseId(conversationIdValue, null);
        });

      /** Deletes all items produced by the given turns (regenerate). */
      const deleteItemsOfTurns = (turnIds: string[]) =>
        turnIds.length === 0
          ? Effect.void
          : Effect.promise(() =>
              db
                .delete(schema.conversationItems)
                .where(inArray(schema.conversationItems.turnId, turnIds)),
            );

      return {
        listForUser,
        getOwned,
        create,
        rename,
        remove,
        touch,
        setLastResponseId,
        listItems,
        appendItems,
        truncateFromItem,
        deleteItemsOfTurns,
      };
    }),
    dependencies: [Db.Default],
  },
) {}
