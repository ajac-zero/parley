import { Effect, Exit, Fiber, Layer, Supervisor } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Db } from "~/server/db/client";
import {
  AgentRequestError,
  OpenResponsesClient,
} from "~/server/openresponses/client";
import { Agents } from "~/server/services/agents";
import { Conversations } from "~/server/services/conversations";
import { Files } from "~/server/services/files";
import { RateLimit } from "~/server/services/rate-limit";
import { Redis } from "~/server/services/redis";
import { isMissingEstablishedContinuation, Turns } from "./turns";

const withTimeout = async <A>(promise: Promise<A>, message: string) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const turnsLayer = (services: {
  agents?: object;
  conversations?: object;
  db?: object;
  files?: object;
  rateLimit?: object;
  redis?: object;
}) =>
  Turns.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Db, { db: services.db ?? {} } as never),
        Layer.succeed(Redis, {
          client: services.redis ?? {},
          subscriber: Effect.never,
        } as never),
        Layer.succeed(Agents, (services.agents ?? {}) as never),
        Layer.succeed(Conversations, (services.conversations ?? {}) as never),
        Layer.succeed(Files, (services.files ?? {}) as never),
        Layer.succeed(RateLimit, (services.rateLimit ?? {}) as never),
        Layer.succeed(OpenResponsesClient, {} as never),
      ),
    ),
  );

describe("turn attachment limits", () => {
  it("processes all 10 attachment IDs in Turns.start", async () => {
    const fileIds = Array.from({ length: 10 }, (_, index) => `file-${index}`);
    const updates: Array<Record<string, unknown>> = [];
    const query = Object.assign(Promise.resolve([]), {
      select: () => query,
      from: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => Promise.resolve([]),
      insert: () => query,
      update: () => query,
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return query;
      },
      values: () => Promise.resolve([]),
    });
    const redisCommand = {
      rpush: () => redisCommand,
      expire: () => redisCommand,
      set: () => redisCommand,
      exec: () => Promise.resolve([[null, 1]]),
    };
    let finishStream: () => void = () => {};
    const streamFinished = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    let reachEndpoint: () => void = () => {};
    const endpointReached = new Promise<void>((resolve) => {
      reachEndpoint = resolve;
    });
    let releaseEndpoint: () => void = () => {};
    const endpointReleased = new Promise<void>((resolve) => {
      releaseEndpoint = resolve;
    });
    const getOwnedFile = vi.fn((_userId: string, id: string) =>
      Effect.succeed({
        id,
        name: `${id}.txt`,
        mimeType: "text/plain",
      }),
    );
    const appendItems = vi.fn((_conversationId, _turnId, _source, payloads) =>
      Effect.succeed([{ id: "item-1", payload: payloads[0] }]),
    );
    const layer = turnsLayer({
      agents: {
        getVisible: () => Effect.succeed({ id: "agent-1", isEnabled: true }),
        endpointFor: () =>
          Effect.tryPromise({
            try: async () => {
              reachEndpoint();
              await endpointReleased;
              throw new Error("End test turn.");
            },
            catch: () => new AgentRequestError({ message: "End test turn." }),
          }),
      },
      conversations: {
        getOwned: () =>
          Effect.succeed({
            id: "conversation-1",
            agentId: "agent-1",
            lastResponseId: null,
          }),
        appendItems,
        touch: () => Effect.void,
      },
      db: query,
      files: { getOwned: getOwnedFile },
      rateLimit: { chat: () => Effect.void },
      redis: {
        multi: () => redisCommand,
        publish: (_channel: string, message: string) => {
          if (message === "done") finishStream();
          return Promise.resolve(1);
        },
      },
    });

    const supervisor = await Effect.runPromise(Supervisor.track);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const turns = yield* Turns;
        return yield* turns.start(
          { userId: "user-1", isAdmin: false },
          {
            conversationId: "conversation-1",
            message: { text: "hello", fileIds },
          },
        );
      }).pipe(Effect.provide(layer), Effect.supervised(supervisor)),
    );
    try {
      await withTimeout(endpointReached, "Turn engine did not reach endpoint.");
      const daemonFibers = await Effect.runPromise(supervisor.value);
      expect(daemonFibers).toHaveLength(1);
      releaseEndpoint();
      await withTimeout(streamFinished, "Turn stream did not finish.");
      const daemonExits = await Effect.runPromise(
        Effect.forEach(daemonFibers, Fiber.await),
      );

      expect(result.conversationId).toBe("conversation-1");
      expect(daemonExits.every(Exit.isSuccess)).toBe(true);
      expect(updates).toContainEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.objectContaining({ message: "End test turn." }),
        }),
      );
      expect(getOwnedFile).toHaveBeenCalledTimes(20);
      expect(getOwnedFile.mock.calls.map(([, id]) => id)).toEqual([
        ...fileIds,
        ...fileIds,
      ]);
      const userMessage = appendItems.mock.calls[0]?.[3][0];
      expect(userMessage.content.slice(1)).toEqual(
        fileIds.map((id) => ({
          type: "input_file",
          filename: `${id}.txt`,
          file_url: `parley-file:${id}`,
        })),
      );
    } finally {
      releaseEndpoint();
      const remainingFibers = await Effect.runPromise(supervisor.value);
      await Effect.runPromise(Effect.forEach(remainingFibers, Fiber.interrupt));
    }
  });

  it("rejects 11 attachment IDs in Turns.start before dependency work", async () => {
    const fileIds = Array.from({ length: 11 }, (_, index) => `file-${index}`);
    const chat = vi.fn(() => Effect.void);
    const layer = turnsLayer({ rateLimit: { chat } });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const turns = yield* Turns;
        return yield* turns.start(
          { userId: "user-1", isAdmin: false },
          {
            agentId: "agent-1",
            message: { text: "hello", fileIds },
          },
        );
      }).pipe(Effect.flip, Effect.provide(layer)),
    );

    expect(error).toMatchObject({
      message: "Too many attachments (max 10).",
      status: 400,
    });
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("stateful continuation", () => {
  it("allows full replay when no response has completed", () => {
    expect(
      isMissingEstablishedContinuation("previous_response_id", null, false),
    ).toBe(false);
  });

  it("fails closed when established continuation state is missing", () => {
    expect(
      isMissingEstablishedContinuation("previous_response_id", null, true),
    ).toBe(true);
  });

  it("continues normally when the response id is available", () => {
    expect(
      isMissingEstablishedContinuation(
        "previous_response_id",
        "resp_123",
        true,
      ),
    ).toBe(false);
  });

  it("does not apply to replay-mode agents", () => {
    expect(isMissingEstablishedContinuation("replay", null, true)).toBe(false);
  });
});
