import { and, desc, eq, inArray } from "drizzle-orm";
import {
  Data,
  Deferred,
  Duration,
  Effect,
  Option,
  Queue,
  Ref,
  Stream,
} from "effect";
import { A2UI_MIME_TYPE } from "~/lib/a2ui";
import {
  type ContentPart,
  finalizePartialItems,
  initialTurnStreamState,
  type MessageItem,
  type ORItem,
  type ORStreamEvent,
  portableInputItem,
  reduceORevent,
  type TurnStatus,
  type TurnStreamState,
} from "~/lib/openresponses";
import type { SseMessage } from "~/lib/sse";
import { Db, schema } from "~/server/db/client";
import { appEnv } from "~/server/env";
import { turnId as newTurnId } from "~/server/ids";
import {
  AgentRequestError,
  OpenResponsesClient,
} from "~/server/openresponses/client";
import { type Actor, Agents } from "~/server/services/agents";
import { Conversations, titleFromText } from "~/server/services/conversations";
import { Files, isImageMime } from "~/server/services/files";
import { RateLimit } from "~/server/services/rate-limit";
import { Redis } from "~/server/services/redis";

export class TurnError extends Data.TaggedError("TurnError")<{
  message: string;
  status?: number;
}> {}

export interface StartTurnParams {
  conversationId?: string | null;
  /** Required when starting a new conversation. */
  agentId?: string | null;
  message?: {
    text: string;
    fileIds: string[];
    /** A2UI client -> server messages (user actions from surfaces). */
    a2ui?: unknown[];
  } | null;
  /** Re-run the last turn (drops its previous output). */
  regenerate?: boolean;
  /** Truncate the transcript from this item before sending (edit & resend). */
  editFromItemId?: string | null;
}

export interface StartTurnResult {
  turnId: string;
  conversationId: string;
}

export const isMissingEstablishedContinuation = (
  continuation: string,
  lastResponseId: string | null,
  hasCompletedResponse: boolean,
): boolean =>
  continuation === "previous_response_id" &&
  lastResponseId === null &&
  hasCompletedResponse;

const FILE_REF_PREFIX = "parley-file:";
const TTL_SECONDS = 3600;

const keys = (turnId: string) => ({
  events: `parley:turn:${turnId}:events`,
  done: `parley:turn:${turnId}:done`,
  cancel: `parley:turn:${turnId}:cancel`,
  eventsChannel: `parley:turn:${turnId}:events`,
  controlChannel: `parley:turn:${turnId}:control`,
});

interface Frame {
  event?: string;
  data: string;
}

const frameOf = (event: { type: string }): Frame => ({
  event: event.type,
  data: JSON.stringify(event),
});

const DONE_FRAME: Frame = { data: "[DONE]" };

export class Turns extends Effect.Service<Turns>()("Turns", {
  effect: Effect.gen(function* () {
    const { db } = yield* Db;
    const { client: redis, subscriber } = yield* Redis;
    const agents = yield* Agents;
    const conversations = yield* Conversations;
    const files = yield* Files;
    const rateLimit = yield* RateLimit;
    const orClient = yield* OpenResponsesClient;

    /* ------------------------------ helpers ------------------------------ */

    const publishFrame = (turnId: string, frame: Frame) =>
      Effect.promise(async () => {
        const k = keys(turnId);
        const length = await redis
          .multi()
          .rpush(k.events, JSON.stringify(frame))
          .expire(k.events, TTL_SECONDS)
          .exec()
          .then((results) => (results?.[0]?.[1] as number) ?? 0);
        await redis.publish(k.eventsChannel, String(length));
        return length;
      });

    const emitEvent = (
      turnId: string,
      event: Record<string, unknown> & { type: string },
    ) => publishFrame(turnId, frameOf(event));

    const finishStream = (turnId: string) =>
      Effect.promise(async () => {
        const k = keys(turnId);
        await redis
          .multi()
          .rpush(k.events, JSON.stringify(DONE_FRAME))
          .expire(k.events, TTL_SECONDS)
          .set(k.done, "1", "EX", TTL_SECONDS)
          .exec();
        await redis.publish(k.eventsChannel, "done");
      });

    /** Builds the outbound content parts for a user message. */
    const buildUserMessage = (
      actor: Actor,
      text: string,
      fileIds: string[],
      a2ui: unknown[] = [],
    ) =>
      Effect.gen(function* () {
        const parts: ContentPart[] = [];
        const trimmed = text.trim();
        if (trimmed.length > 0) {
          parts.push({ type: "input_text", text: trimmed });
        }
        if (a2ui.length > 0) {
          /* A2UI actions ride along as a typed part (the Open Responses
           * analog of A2A's DataPart binding); the text above is the
           * fallback for agents that only read text. */
          parts.push({
            type: "a2ui",
            mime_type: A2UI_MIME_TYPE,
            data: a2ui,
          } as unknown as ContentPart);
        }
        for (const id of fileIds.slice(0, 10)) {
          const file = yield* files.getOwned(actor.userId, id).pipe(
            Effect.mapError(
              () =>
                new TurnError({
                  message: "Attachment not found.",
                  status: 400,
                }),
            ),
          );
          if (isImageMime(file.mimeType)) {
            parts.push({
              type: "input_image",
              image_url: `${FILE_REF_PREFIX}${file.id}`,
              detail: "auto",
            });
          } else {
            parts.push({
              type: "input_file",
              filename: file.name,
              file_url: `${FILE_REF_PREFIX}${file.id}`,
            });
          }
        }
        if (parts.length === 0) {
          return yield* new TurnError({
            message: "Message cannot be empty.",
            status: 400,
          });
        }
        const item: MessageItem = {
          type: "message",
          role: "user",
          content: parts,
        };
        return item;
      });

    /**
     * Replaces parley-file references with either a presigned URL (cheap,
     * used when a publicly-reachable S3 endpoint is configured via
     * S3_PUBLIC_URL) or an inline base64 payload (safe default — works even
     * when the agent can't reach the object store's network, e.g. the
     * default bundled MinIO).
     */
    const hydrateItem = (userId: string, item: ORItem) =>
      Effect.gen(function* () {
        const record = item as unknown as Record<string, unknown>;
        if (record.type !== "message" || !Array.isArray(record.content)) {
          return item;
        }
        const content: ContentPart[] = [];
        for (const part of record.content as ContentPart[]) {
          const partRecord = part as Record<string, unknown>;
          if (
            partRecord.type === "input_image" &&
            typeof partRecord.image_url === "string" &&
            partRecord.image_url.startsWith(FILE_REF_PREFIX)
          ) {
            const id = partRecord.image_url.slice(FILE_REF_PREFIX.length);
            const { file, url } = yield* files
              .getUrl(userId, id)
              .pipe(Effect.orElseSucceed(() => ({ file: null, url: null })));
            if (file && url) {
              content.push({
                ...partRecord,
                image_url: url,
              } as ContentPart);
              continue;
            }
            if (file) {
              const { data } = yield* files
                .getBytes(userId, id)
                .pipe(Effect.orElseSucceed(() => ({ data: null })));
              if (data) {
                content.push({
                  ...partRecord,
                  image_url: `data:${file.mimeType};base64,${Buffer.from(data).toString("base64")}`,
                } as ContentPart);
                continue;
              }
            }
            content.push({
              type: "input_text",
              text: "[attachment unavailable]",
            });
            continue;
          }
          if (
            partRecord.type === "input_file" &&
            typeof partRecord.file_url === "string" &&
            partRecord.file_url.startsWith(FILE_REF_PREFIX)
          ) {
            const id = partRecord.file_url.slice(FILE_REF_PREFIX.length);
            const { file, url } = yield* files
              .getUrl(userId, id)
              .pipe(Effect.orElseSucceed(() => ({ file: null, url: null })));
            if (file && url) {
              content.push({
                ...partRecord,
                filename: file.name,
                file_url: url,
              } as ContentPart);
              continue;
            }
            if (file) {
              const { data } = yield* files
                .getBytes(userId, id)
                .pipe(Effect.orElseSucceed(() => ({ data: null })));
              if (data) {
                const { file_url: _drop, ...rest } = partRecord;
                content.push({
                  ...rest,
                  filename: file.name,
                  file_data: Buffer.from(data).toString("base64"),
                } as ContentPart);
                continue;
              }
            }
            content.push({
              type: "input_text",
              text: "[attachment unavailable]",
            });
            continue;
          }
          content.push(part);
        }
        return { ...record, content } as unknown as ORItem;
      });

    /** Strips platform ids so replayed items are portable across agents. */
    const stripId = (item: ORItem): ORItem => {
      const { id: _dropped, ...rest } = item as unknown as Record<
        string,
        unknown
      >;
      return rest as unknown as ORItem;
    };

    const activeTurnFor = (conversationId: string) =>
      Effect.promise(() =>
        db
          .select({
            id: schema.turns.id,
            status: schema.turns.status,
            createdAt: schema.turns.createdAt,
          })
          .from(schema.turns)
          .where(
            and(
              eq(schema.turns.conversationId, conversationId),
              inArray(schema.turns.status, ["pending", "streaming"]),
            ),
          )
          .orderBy(desc(schema.turns.createdAt))
          .limit(1),
      ).pipe(Effect.map((rows) => Option.fromNullable(rows[0])));

    /* --------------------------- the turn engine -------------------------- */

    interface EngineContext {
      turnId: string;
      actor: Actor;
      conversation: typeof schema.conversations.$inferSelect;
      agent: typeof schema.agents.$inferSelect;
      newUserItems: Array<{ id: string; payload: ORItem }>;
      announceTitle: string | null;
    }

    const persistOutcome = (
      ctx: EngineContext,
      status: TurnStatus,
      state: TurnStreamState,
    ) =>
      Effect.gen(function* () {
        const items = finalizePartialItems(state.items);
        if (items.length > 0) {
          yield* conversations.appendItems(
            ctx.conversation.id,
            ctx.turnId,
            "agent",
            items,
          );
        }
        yield* Effect.promise(() =>
          db
            .update(schema.turns)
            .set({
              status,
              responseId: state.responseId,
              usage: state.usage ?? undefined,
              error: state.error ?? undefined,
              completedAt: new Date(),
            })
            .where(eq(schema.turns.id, ctx.turnId)),
        );
        if (status === "completed" && state.responseId) {
          yield* conversations.setLastResponseId(
            ctx.conversation.id,
            state.responseId,
          );
        } else {
          yield* conversations.touch(ctx.conversation.id);
        }
        yield* emitEvent(ctx.turnId, {
          type: "parley.turn.finished",
          turn_id: ctx.turnId,
          status,
          usage: state.usage,
          error: state.error,
        });
        yield* finishStream(ctx.turnId);
      });

    const runEngine = (ctx: EngineContext) =>
      Effect.gen(function* () {
        const k = keys(ctx.turnId);
        yield* Effect.promise(() =>
          db
            .update(schema.turns)
            .set({ status: "streaming" })
            .where(eq(schema.turns.id, ctx.turnId)),
        );

        yield* emitEvent(ctx.turnId, {
          type: "parley.turn.started",
          turn_id: ctx.turnId,
          conversation_id: ctx.conversation.id,
          user_items: ctx.newUserItems,
        });
        if (ctx.announceTitle) {
          yield* emitEvent(ctx.turnId, {
            type: "parley.conversation.updated",
            conversation_id: ctx.conversation.id,
            title: ctx.announceTitle,
          });
        }

        // Build the request input.
        const endpoint = yield* agents
          .endpointFor(ctx.agent)
          .pipe(
            Effect.mapError(
              (error) => new AgentRequestError({ message: error.message }),
            ),
          );

        const allItems = yield* conversations.listItems(ctx.conversation.id);
        const stateful = ctx.agent.continuation === "previous_response_id";
        const completedTurns = yield* Effect.promise(() =>
          db
            .select({ id: schema.turns.id })
            .from(schema.turns)
            .where(
              and(
                eq(schema.turns.conversationId, ctx.conversation.id),
                eq(schema.turns.status, "completed"),
              ),
            )
            .limit(1),
        );
        if (
          isMissingEstablishedContinuation(
            ctx.agent.continuation,
            ctx.conversation.lastResponseId,
            completedTurns.length > 0,
          )
        ) {
          return yield* new AgentRequestError({
            code: "previous_response_not_found",
            message:
              "Stateful continuation is unavailable. Start a new conversation or explicitly use replay mode.",
          });
        }
        const usePrid = stateful && ctx.conversation.lastResponseId !== null;

        const replaySource = usePrid
          ? allItems.filter((row) =>
              ctx.newUserItems.some((item) => item.id === row.id),
            )
          : allItems;

        const input: unknown[] = [];
        for (const row of replaySource) {
          const hydrated = yield* hydrateItem(
            ctx.actor.userId,
            row.payload as unknown as ORItem,
          );
          const portable = portableInputItem(stripId(hydrated));
          if (portable) input.push(portable);
        }

        const stateRef = yield* Ref.make(initialTurnStreamState);

        // Cancellation: honor both a pre-set flag and live control messages.
        const cancelled = yield* Deferred.make<void>();
        const alreadyCancelled = yield* Effect.promise(() =>
          redis.get(k.cancel),
        );
        if (alreadyCancelled) {
          yield* Deferred.succeed(cancelled, void 0);
        }

        const controlSub = yield* subscriber;
        yield* Effect.promise(() => controlSub.subscribe(k.controlChannel));
        controlSub.on("message", (channel, message) => {
          if (channel === k.controlChannel && message === "cancel") {
            Deferred.unsafeDone(cancelled, Effect.void);
          }
        });

        const consume = orClient
          .stream(
            { baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey },
            {
              model: ctx.agent.model,
              instructions: ctx.agent.instructions,
              input,
              previousResponseId: usePrid
                ? ctx.conversation.lastResponseId
                : null,
              store: ctx.agent.continuation === "previous_response_id",
              params: ctx.agent.params ?? null,
            },
          )
          .pipe(
            Stream.timeoutFail(
              () =>
                new AgentRequestError({
                  message: `Agent sent no data for ${appEnv.turnIdleTimeoutSec}s and was disconnected.`,
                }),
              Duration.seconds(appEnv.turnIdleTimeoutSec),
            ),
            Stream.runForEach((event: ORStreamEvent) =>
              Effect.gen(function* () {
                yield* Ref.update(stateRef, (state) =>
                  reduceORevent(state, event),
                );
                yield* publishFrame(ctx.turnId, frameOf(event));
              }),
            ),
            Effect.timeoutFail({
              duration: Duration.seconds(appEnv.turnMaxDurationSec),
              onTimeout: () =>
                new AgentRequestError({
                  message: `Turn exceeded the ${appEnv.turnMaxDurationSec}s limit and was stopped.`,
                }),
            }),
          );

        const outcome = yield* Effect.raceFirst(
          consume.pipe(Effect.as("finished" as const)),
          Deferred.await(cancelled).pipe(Effect.as("cancelled" as const)),
        ).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const message =
                error instanceof AgentRequestError
                  ? error.message
                  : "Unexpected error while contacting the agent.";
              const code =
                error instanceof AgentRequestError ? error.code : undefined;
              yield* Ref.update(stateRef, (state) => ({
                ...state,
                status: "failed" as const,
                error: state.error ?? { code, message },
              }));
              return "failed" as const;
            }),
          ),
        );

        const state = yield* Ref.get(stateRef);
        const status: TurnStatus =
          outcome === "cancelled"
            ? "cancelled"
            : outcome === "failed" || state.status === "failed"
              ? "failed"
              : state.status === "incomplete"
                ? "incomplete"
                : state.status === "completed"
                  ? "completed"
                  : "failed";

        // A finished stream that never reached a terminal response state means
        // the agent ended the stream early.
        if (outcome === "finished" && state.status === "in_progress") {
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            error: s.error ?? {
              message:
                "The agent ended the stream without completing the response.",
            },
          }));
        }

        const finalState = yield* Ref.get(stateRef);
        yield* persistOutcome(ctx, status, finalState);
      }).pipe(
        Effect.catchTag("AgentRequestError", (error) =>
          persistOutcome(ctx, "failed", {
            ...initialTurnStreamState,
            status: "failed",
            error: { code: error.code, message: error.message },
          }),
        ),
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            // Last-resort safety net: never leave a turn dangling.
            yield* Effect.logError("Turn engine crashed", cause);
            yield* Effect.promise(() =>
              db
                .update(schema.turns)
                .set({
                  status: "failed",
                  error: { message: "Internal error while running the turn." },
                  completedAt: new Date(),
                })
                .where(eq(schema.turns.id, ctx.turnId)),
            );
            yield* emitEvent(ctx.turnId, {
              type: "parley.turn.finished",
              turn_id: ctx.turnId,
              status: "failed",
              error: { message: "Internal error while running the turn." },
            });
            yield* finishStream(ctx.turnId);
          }).pipe(Effect.ignore),
        ),
        Effect.scoped,
      );

    /* ------------------------------- start -------------------------------- */

    const start = (actor: Actor, params: StartTurnParams) =>
      Effect.gen(function* () {
        yield* rateLimit
          .chat(actor.userId)
          .pipe(
            Effect.mapError(
              (error) => new TurnError({ message: error.message, status: 429 }),
            ),
          );

        /* Resolve conversation + agent */
        let conversation: typeof schema.conversations.$inferSelect;
        let announceTitle: string | null = null;

        if (params.conversationId) {
          conversation = yield* conversations
            .getOwned(actor.userId, params.conversationId)
            .pipe(
              Effect.mapError(
                (error) =>
                  new TurnError({ message: error.message, status: 404 }),
              ),
            );
        } else {
          if (!params.agentId) {
            return yield* new TurnError({
              message: "agentId is required to start a conversation.",
              status: 400,
            });
          }
          if (
            !params.message ||
            (params.message.text.trim().length === 0 &&
              params.message.fileIds.length === 0 &&
              (params.message.a2ui?.length ?? 0) === 0)
          ) {
            return yield* new TurnError({
              message: "A message is required to start a conversation.",
              status: 400,
            });
          }
          const firstFile = params.message.fileIds[0]
            ? yield* files
                .getOwned(actor.userId, params.message.fileIds[0])
                .pipe(
                  Effect.mapError(
                    () =>
                      new TurnError({
                        message: "Attachment not found.",
                        status: 400,
                      }),
                  ),
                )
            : null;
          const title = titleFromText(
            params.message.text || firstFile?.name || "",
          );
          conversation = yield* conversations.create(
            actor.userId,
            params.agentId,
            title,
          );
          announceTitle = title;
        }

        if (!conversation.agentId) {
          return yield* new TurnError({
            message:
              "This conversation's agent was deleted. Start a new conversation.",
            status: 409,
          });
        }

        const agent = yield* agents
          .getVisible(actor, conversation.agentId)
          .pipe(
            Effect.mapError(
              () =>
                new TurnError({
                  message: "The agent for this conversation is unavailable.",
                  status: 404,
                }),
            ),
          );
        if (!agent.isEnabled) {
          return yield* new TurnError({
            message: "This agent is currently disabled.",
            status: 409,
          });
        }

        /* Reject concurrent turns on one conversation */
        const active = yield* activeTurnFor(conversation.id);
        if (Option.isSome(active)) {
          return yield* new TurnError({
            message: "A response is already streaming in this conversation.",
            status: 409,
          });
        }

        /* Edit & resend: truncate transcript from the edited item */
        if (params.editFromItemId) {
          yield* conversations
            .truncateFromItem(conversation.id, params.editFromItemId)
            .pipe(
              Effect.mapError(
                (error) =>
                  new TurnError({ message: error.message, status: 404 }),
              ),
            );
          conversation = { ...conversation, lastResponseId: null };
        }

        /* Regenerate: drop the last turn's agent output */
        if (params.regenerate) {
          const lastTurnRows = yield* Effect.promise(() =>
            db
              .select({ id: schema.turns.id })
              .from(schema.turns)
              .where(eq(schema.turns.conversationId, conversation.id))
              .orderBy(desc(schema.turns.createdAt))
              .limit(1),
          );
          const lastTurn = lastTurnRows[0];
          if (lastTurn) {
            yield* Effect.promise(() =>
              db
                .delete(schema.conversationItems)
                .where(
                  and(
                    eq(schema.conversationItems.turnId, lastTurn.id),
                    eq(schema.conversationItems.source, "agent"),
                  ),
                ),
            );
          }
          // The old chain includes the dropped output; reset it.
          yield* conversations.setLastResponseId(conversation.id, null);
          conversation = { ...conversation, lastResponseId: null };
        }

        /* Persist new user input items */
        const turnIdValue = newTurnId();
        let newUserItems: Array<{ id: string; payload: ORItem }> = [];

        yield* Effect.promise(() =>
          db.insert(schema.turns).values({
            id: turnIdValue,
            conversationId: conversation.id,
            status: "pending",
          }),
        );

        if (
          params.message &&
            params.message.fileIds.length > 0 ||
          (params.message.text.trim().length > 0 ||
            (params.message.a2ui?.length ?? 0) > 0)
        ) {
          if (params.message.text.length > 64_000) {
            return yield* new TurnError({
              message: "Message is too long (max 64k characters).",
              status: 400,
            });
          }
          const userItem = yield* buildUserMessage(
            actor,
            params.message.text,
            params.message.fileIds ?? [],
            params.message.a2ui ?? [],
          );
          const rows = yield* conversations.appendItems(
            conversation.id,
            turnIdValue,
            "user",
            [userItem],
          );
          newUserItems = rows.map((row) => ({
            id: row.id,
            payload: row.payload as unknown as ORItem,
          }));
        } else if (!params.regenerate) {
          return yield* new TurnError({
            message: "Message cannot be empty.",
            status: 400,
          });
        }

        /* Launch the engine as a daemon fiber (survives request disconnects) */
        yield* runEngine({
          turnId: turnIdValue,
          actor,
          conversation,
          agent,
          newUserItems,
          announceTitle,
        }).pipe(Effect.forkDaemon);

        return {
          turnId: turnIdValue,
          conversationId: conversation.id,
        } satisfies StartTurnResult;
      });

    /* ------------------------------ streaming ----------------------------- */

    /**
     * Reads a turn's event frames from Redis starting after `afterIndex`
     * (0-based; -1 = from the beginning), following live updates until the
     * `[DONE]` sentinel.
     */
    const streamFrames = (
      turnId: string,
      afterIndex: number,
    ): Stream.Stream<SseMessage, never, never> => {
      const k = keys(turnId);
      const pull = (from: number) =>
        Effect.promise(() => redis.lrange(k.events, from, -1));

      return Stream.unwrapScoped(
        Effect.gen(function* () {
          const wake = yield* Queue.sliding<string>(8);
          const sub = yield* subscriber;
          yield* Effect.promise(() => sub.subscribe(k.eventsChannel));
          sub.on("message", (channel, message) => {
            if (channel === k.eventsChannel) {
              Queue.unsafeOffer(wake, message);
            }
          });

          let cursor = afterIndex + 1;
          let sawTurn = false;

          const nextBatch: Effect.Effect<
            readonly SseMessage[] | null,
            never,
            never
          > = Effect.gen(function* () {
            const raw = yield* pull(cursor);
            if (raw.length > 0) {
              sawTurn = true;
              const messages: SseMessage[] = [];
              let finished = false;
              for (const [offset, json] of raw.entries()) {
                const index = cursor + offset;
                let frame: Frame;
                try {
                  frame = JSON.parse(json) as Frame;
                } catch {
                  continue;
                }
                if (frame.data === "[DONE]") {
                  messages.push({ data: "[DONE]", id: String(index) });
                  finished = true;
                  break;
                }
                messages.push({
                  data: frame.data,
                  ...(frame.event ? { event: frame.event } : {}),
                  id: String(index),
                });
              }
              cursor += raw.length;
              if (finished) {
                return messages.length > 0 ? messages : null;
              }
              return messages;
            }

            // Nothing new. If the turn is unknown/expired, end politely.
            if (!sawTurn) {
              const [exists, done] = yield* Effect.promise(async () => {
                const len = await redis.exists(k.events);
                const doneFlag = await redis.get(k.done);
                return [len > 0, doneFlag === "1"] as const;
              });
              if (!exists && done) return null;
              if (!exists) {
                // Turn may not have written yet; wait for a wake-up below.
              }
            }

            const doneFlag = yield* Effect.promise(() => redis.get(k.done));
            if (doneFlag === "1") {
              // Re-check the list once more to avoid a publish/read race.
              const rest = yield* pull(cursor);
              if (rest.length === 0) return null;
              return yield* nextBatch;
            }

            // Wait for a publish (or poll every second as a fallback).
            yield* Queue.take(wake).pipe(
              Effect.timeout(Duration.seconds(1)),
              Effect.ignore,
            );
            return yield* nextBatch;
          });

          const terminated = { done: false };
          return Stream.repeatEffectOption(
            Effect.suspend(() => {
              if (terminated.done) {
                return Effect.fail(Option.none<never>());
              }
              return nextBatch.pipe(
                Effect.flatMap((batch) => {
                  if (batch === null) return Effect.fail(Option.none<never>());
                  const hasDone = batch.some((m) => m.data === "[DONE]");
                  if (hasDone) terminated.done = true;
                  return Effect.succeed(batch);
                }),
              );
            }),
          ).pipe(Stream.flatMap((batch) => Stream.fromIterable(batch)));
        }),
      );
    };

    /* --------------------------- access + cancel -------------------------- */

    /** Loads a turn, asserting the actor owns its conversation. */
    const getOwned = (actor: Actor, turnIdValue: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select({
              turn: schema.turns,
              conversation: schema.conversations,
            })
            .from(schema.turns)
            .innerJoin(
              schema.conversations,
              eq(schema.turns.conversationId, schema.conversations.id),
            )
            .where(eq(schema.turns.id, turnIdValue)),
        );
        const row = rows[0];
        if (!row || row.conversation.userId !== actor.userId) {
          return yield* new TurnError({
            message: "Turn not found.",
            status: 404,
          });
        }
        return row;
      });

    const cancel = (actor: Actor, turnIdValue: string) =>
      Effect.gen(function* () {
        yield* getOwned(actor, turnIdValue);
        const k = keys(turnIdValue);
        yield* Effect.promise(async () => {
          await redis.set(k.cancel, "1", "EX", TTL_SECONDS);
          await redis.publish(k.controlChannel, "cancel");
        });
      });

    return { start, streamFrames, cancel, activeTurnFor, getOwned };
  }),
  dependencies: [
    Db.Default,
    Redis.Default,
    Agents.Default,
    Conversations.Default,
    Files.Default,
    RateLimit.Default,
    OpenResponsesClient.Default,
  ],
}) {}
