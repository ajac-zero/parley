import { and, asc, eq, isNull, or } from "drizzle-orm";
import { Data, Effect } from "effect";
import { type AgentInput, AgentInputSchema } from "~/lib/agent-schema";
import { Db, schema } from "~/server/db/client";
import { agentId } from "~/server/ids";
import { validateAgentUrl } from "~/server/openresponses/client";
import { Crypto } from "~/server/services/crypto";
import { Settings } from "~/server/services/settings";

export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  message: string;
}> {}

export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{
  message: string;
}> {}

export { type AgentInput, AgentInputSchema };

export interface Actor {
  userId: string;
  isAdmin: boolean;
}

export type AgentRow = typeof schema.agents.$inferSelect;

/** Redacts secrets before returning an agent to the client. */
export const toPublicAgent = (row: AgentRow) => ({
  id: row.id,
  ownerId: row.ownerId,
  isGlobal: row.ownerId === null,
  name: row.name,
  description: row.description,
  avatar: row.avatar,
  baseUrl: row.baseUrl,
  hasApiKey: row.apiKeyCiphertext !== null,
  model: row.model,
  instructions: row.instructions,
  continuation: row.continuation,
  supportsImages: row.supportsImages,
  supportsFiles: row.supportsFiles,
  params: row.params,
  isEnabled: row.isEnabled,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export type PublicAgent = ReturnType<typeof toPublicAgent>;

export class Agents extends Effect.Service<Agents>()("Agents", {
  effect: Effect.gen(function* () {
    const { db } = yield* Db;
    const crypto = yield* Crypto;
    const settings = yield* Settings;

    /** Agents visible to a user: global ones + their own. */
    const listVisible = (actor: Actor) =>
      Effect.promise(() =>
        db
          .select()
          .from(schema.agents)
          .where(
            or(
              isNull(schema.agents.ownerId),
              eq(schema.agents.ownerId, actor.userId),
            ),
          )
          .orderBy(asc(schema.agents.createdAt)),
      );

    const getVisible = (actor: Actor, id: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(schema.agents)
            .where(
              and(
                eq(schema.agents.id, id),
                or(
                  isNull(schema.agents.ownerId),
                  eq(schema.agents.ownerId, actor.userId),
                ),
              ),
            ),
        );
        const row = rows[0];
        if (!row) {
          return yield* new AgentNotFoundError({ message: "Agent not found." });
        }
        return row;
      });

    /** Owned = personal agent of the actor, or any global agent for admins. */
    const getEditable = (actor: Actor, id: string) =>
      Effect.gen(function* () {
        const row = yield* getVisible(actor, id);
        const canEdit =
          row.ownerId === actor.userId ||
          (row.ownerId === null && actor.isAdmin);
        if (!canEdit) {
          return yield* new ForbiddenError({
            message: "You cannot modify this agent.",
          });
        }
        return row;
      });

    const ensureCanCreate = (actor: Actor, global: boolean) =>
      Effect.gen(function* () {
        if (global) {
          if (!actor.isAdmin) {
            return yield* new ForbiddenError({
              message: "Only admins can create global agents.",
            });
          }
          return;
        }
        const current = yield* settings.get;
        if (!current.allowUserAgents && !actor.isAdmin) {
          return yield* new ForbiddenError({
            message: "Personal agents are disabled on this deployment.",
          });
        }
      });

    const create = (actor: Actor, input: AgentInput) =>
      Effect.gen(function* () {
        yield* ensureCanCreate(actor, input.global);
        yield* validateAgentUrl(input.baseUrl);
        const id = agentId();
        const apiKeyCiphertext =
          input.apiKey && input.apiKey.length > 0
            ? crypto.encrypt(input.apiKey)
            : null;
        const rows = yield* Effect.promise(() =>
          db
            .insert(schema.agents)
            .values({
              id,
              ownerId: input.global ? null : actor.userId,
              name: input.name,
              description: input.description,
              avatar: input.avatar,
              baseUrl: input.baseUrl,
              apiKeyCiphertext,
              model: input.model,
              instructions: input.instructions,
              continuation: input.continuation,
              supportsImages: input.supportsImages,
              supportsFiles: input.supportsFiles,
              params: input.params,
              isEnabled: input.isEnabled,
            })
            .returning(),
        );
        return rows[0] as AgentRow;
      });

    const update = (actor: Actor, id: string, input: AgentInput) =>
      Effect.gen(function* () {
        const existing = yield* getEditable(actor, id);
        yield* validateAgentUrl(input.baseUrl);
        const apiKeyCiphertext =
          input.apiKey === undefined || input.apiKey === null
            ? existing.apiKeyCiphertext // unchanged
            : input.apiKey.length === 0
              ? null // cleared
              : crypto.encrypt(input.apiKey);
        const rows = yield* Effect.promise(() =>
          db
            .update(schema.agents)
            .set({
              name: input.name,
              description: input.description,
              avatar: input.avatar,
              baseUrl: input.baseUrl,
              apiKeyCiphertext,
              model: input.model,
              instructions: input.instructions,
              continuation: input.continuation,
              supportsImages: input.supportsImages,
              supportsFiles: input.supportsFiles,
              params: input.params,
              isEnabled: input.isEnabled,
              updatedAt: new Date(),
            })
            .where(eq(schema.agents.id, id))
            .returning(),
        );
        return rows[0] as AgentRow;
      });

    const remove = (actor: Actor, id: string) =>
      Effect.gen(function* () {
        yield* getEditable(actor, id);
        yield* Effect.promise(() =>
          db.delete(schema.agents).where(eq(schema.agents.id, id)),
        );
      });

    /** Decrypted endpoint credentials — server-side use only. */
    const endpointFor = (row: AgentRow) =>
      Effect.gen(function* () {
        const apiKey = row.apiKeyCiphertext
          ? yield* crypto.decrypt(row.apiKeyCiphertext)
          : null;
        return { baseUrl: row.baseUrl, apiKey };
      });

    return {
      listVisible,
      getVisible,
      getEditable,
      create,
      update,
      remove,
      endpointFor,
    };
  }),
  dependencies: [Db.Default, Crypto.Default, Settings.Default],
}) {}
