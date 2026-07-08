import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore, NEW_CHAT_KEY } from "./chat-store";
import { formatSseFrame, SSE_DONE } from "./sse";

/**
 * Builds a Response whose body streams the given SSE events one at a time,
 * waiting for each event's `after` gate (if provided) before enqueuing it.
 * This lets tests observe store state *between* events, the way real
 * network/streaming latency would.
 */
function sseResponse(
  events: Array<{ id?: number; data: unknown; after?: Promise<void> }>,
  headers: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        if (event.after) await event.after;
        controller.enqueue(
          encoder.encode(
            formatSseFrame({
              id: event.id !== undefined ? String(event.id) : undefined,
              data: JSON.stringify(event.data),
            }),
          ),
        );
      }
      controller.enqueue(encoder.encode(`data: ${SSE_DONE}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

describe("chatStore new-chat -> conversation migration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Clean up any leftover entries between tests.
    chatStore.remove(NEW_CHAT_KEY);
  });

  it("keeps NEW_CHAT_KEY resolving to the live entry through migration (no flicker gap)", async () => {
    const conversationId = "conv_123";
    let releaseFinished: (() => void) | undefined;
    const holdFinished = new Promise<void>((resolve) => {
      releaseFinished = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            {
              id: 1,
              data: {
                type: "parley.turn.started",
                conversation_id: conversationId,
                turn_id: "turn_1",
                user_items: [],
              },
            },
            {
              id: 2,
              data: { type: "parley.turn.finished", status: "completed" },
              // Held back so the test can inspect the store in the window
              // right after migration but before the turn (and entry) is
              // torn down - this is exactly the window where a still-
              // mounted /chat page would previously see the entry vanish.
              after: holdFinished,
            },
          ],
          {
            "x-parley-turn-id": "turn_1",
            "x-parley-conversation-id": conversationId,
          },
        ),
      ),
    );

    let createdId: string | null = null;
    chatStore.send({
      agentId: "agent_1",
      text: "hello",
      onConversationCreated: (id) => {
        createdId = id;
      },
    });

    // Immediately after send(): optimistic entry visible under NEW_CHAT_KEY.
    expect(chatStore.get(NEW_CHAT_KEY)).toBeDefined();
    expect(chatStore.get(NEW_CHAT_KEY)?.optimisticUserItem).not.toBeNull();

    // Wait for the header-based migration (NEW_CHAT_KEY -> conversationId)
    // to happen. `turn.finished` is still held back at this point.
    await vi.waitFor(() => {
      expect(createdId).toBe(conversationId);
    });

    // The critical regression check: NEW_CHAT_KEY must NOT have gone missing
    // during/after migration. A page still subscribed to NEW_CHAT_KEY (i.e.
    // still mid-route-transition) must keep seeing a live entry.
    expect(chatStore.get(NEW_CHAT_KEY)).toBeDefined();

    // And it must be the *same* live entry as the canonical conversation key
    // (same data, not a stale snapshot), so subsequent stream updates are
    // visible from either key.
    expect(chatStore.get(NEW_CHAT_KEY)).toEqual(chatStore.get(conversationId));
    expect(chatStore.get(NEW_CHAT_KEY)?.phase).toBe("streaming");

    // Let the turn finish; once removed, both keys should clear together.
    releaseFinished?.();
    await vi.waitFor(() => {
      expect(chatStore.get(conversationId)).toBeUndefined();
    });
    expect(chatStore.get(NEW_CHAT_KEY)).toBeUndefined();
  });

  it("clears a stale NEW_CHAT_KEY alias once a fresh draft is sent", async () => {
    const firstConversationId = "conv_first";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(
          [
            {
              id: 1,
              data: {
                type: "parley.turn.started",
                conversation_id: firstConversationId,
                turn_id: "turn_1",
                user_items: [],
              },
            },
            {
              id: 2,
              data: { type: "parley.turn.finished", status: "completed" },
            },
          ],
          {
            "x-parley-turn-id": "turn_1",
            "x-parley-conversation-id": firstConversationId,
          },
        ),
      ),
    );

    chatStore.send({ agentId: "agent_1", text: "first chat" });
    // Wait for the turn to finish and its entry to be cleaned up (mirrors
    // what happens once ConversationPage's onTurnFinished handler settles).
    await vi.waitFor(() => {
      expect(chatStore.get(NEW_CHAT_KEY)).toBeUndefined();
    });

    // Starting a brand-new draft under NEW_CHAT_KEY must not resurrect the
    // previous (now-finished, migrated) conversation's entry.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // never resolves; we only check sync state
    );
    chatStore.send({ agentId: "agent_1", text: "second chat" });

    const entry = chatStore.get(NEW_CHAT_KEY);
    expect(entry).toBeDefined();
    expect(entry?.conversationId).toBeNull();
    expect(entry?.phase).toBe("connecting");
    expect(entry?.optimisticUserItem).not.toBeNull();

    chatStore.remove(firstConversationId);
    chatStore.remove(NEW_CHAT_KEY);
  });
});
