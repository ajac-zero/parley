import { describe, expect, it } from "vitest";
import type { ConversationDetail } from "~/functions/conversations";
import type { ActiveTurn } from "~/lib/chat-store";
import {
  type FunctionCallItem,
  type FunctionCallOutputItem,
  initialTurnStreamState,
  type ORItem,
} from "~/lib/openresponses";
import {
  AMBIGUOUS_CALL_OUTPUT,
  buildThread,
  pairOutputsByCall,
} from "./thread";

const functionCallOutput = (callId: string): FunctionCallOutputItem => ({
  type: "function_call_output",
  call_id: callId,
  output: JSON.stringify({ ok: true, forCall: callId }),
});

const functionCall = (callId: string): FunctionCallItem => ({
  type: "function_call",
  call_id: callId,
  name: "tool",
  arguments: "{}",
});

const entry = (item: ORItem, turnKey: string) => ({ item, turnKey });

const activeTurn = (overrides: Partial<ActiveTurn> = {}): ActiveTurn => ({
  key: "conv_1",
  turnId: "turn_live",
  conversationId: "conv_1",
  phase: "streaming",
  state: initialTurnStreamState,
  userItems: [],
  optimisticUserItem: null,
  finishedStatus: null,
  error: null,
  suppressTurnIds: [],
  truncateFromItemId: null,
  cancelRequested: false,
  lastEventIndex: -1,
  ...overrides,
});

describe("pairOutputsByCall (call_id uniqueness scope)", () => {
  it("pairs a call with its output within one turn", () => {
    const output = functionCallOutput("call_1");
    const paired = pairOutputsByCall([entry(output, "turn_a")]);
    expect(paired.get("turn_a", "call_1")).toBe(output);
  });

  it("does not let a later turn's output collide with an earlier turn's same call_id", () => {
    // Two unrelated turns both happen to use "call_1" as their call_id —
    // legitimate per the per-turn uniqueness contract (see
    // docs/generative-ui.md). Each turn's output must resolve
    // independently; an unscoped map would let turn_b's output silently
    // replace turn_a's.
    const outputA = functionCallOutput("call_1");
    const outputB = functionCallOutput("call_1");
    const paired = pairOutputsByCall([
      entry(outputA, "turn_a"),
      entry(outputB, "turn_b"),
    ]);
    expect(paired.get("turn_a", "call_1")).toBe(outputA);
    expect(paired.get("turn_b", "call_1")).toBe(outputB);
    expect(paired.get("turn_a", "call_1")).not.toBe(
      paired.get("turn_b", "call_1"),
    );
  });

  it("degrades deterministically (no pairing) when a call_id repeats within one turn", () => {
    // An agent violating the within-turn uniqueness contract by emitting
    // two distinct function_call_output items sharing one call_id in the
    // same turn — rather than silently keeping whichever arrived last,
    // the pairing must be explicitly ambiguous.
    const first = functionCallOutput("call_1");
    const second = functionCallOutput("call_1");
    const paired = pairOutputsByCall([
      entry(first, "turn_a"),
      entry(second, "turn_a"),
    ]);
    expect(paired.get("turn_a", "call_1")).toBe(AMBIGUOUS_CALL_OUTPUT);
  });

  it("returns undefined for a call_id that never appears", () => {
    const paired = pairOutputsByCall([
      entry(functionCallOutput("call_1"), "turn_a"),
    ]);
    expect(paired.get("turn_a", "call_2")).toBeUndefined();
    expect(paired.get("turn_z", "call_1")).toBeUndefined();
  });
});

describe("buildThread (turnKey assignment)", () => {
  it("scopes persisted rows by their own turnId, even when call_id repeats across turns", () => {
    const detail = {
      items: [
        {
          id: "item_1",
          turnId: "turn_a",
          source: "agent",
          payload: functionCall("call_1"),
          createdAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "item_2",
          turnId: "turn_a",
          source: "agent",
          payload: functionCallOutput("call_1"),
          createdAt: "2024-01-01T00:00:01.000Z",
        },
        {
          id: "item_3",
          turnId: "turn_b",
          source: "agent",
          payload: functionCall("call_1"),
          createdAt: "2024-01-01T00:01:00.000Z",
        },
      ],
    } as unknown as ConversationDetail;

    const entries = buildThread(detail, undefined);
    expect(entries.map((e) => e.turnKey)).toEqual([
      "turn_a",
      "turn_a",
      "turn_b",
    ]);

    // Directly demonstrates the bug this scoping fixes: were turnKey
    // omitted (or bare call_id used as the key), turn_a's and turn_b's
    // call_1 outputs would collide.
    const paired = pairOutputsByCall(entries);
    expect(paired.get("turn_a", "call_1")).toBeDefined();
    expect(paired.get("turn_b", "call_1")).toBeUndefined();
  });

  it("gives every item of one live streaming turn the same turnKey, so they pair", () => {
    const active = activeTurn({
      turnId: "turn_live",
      state: {
        ...initialTurnStreamState,
        // `items` may contain holes while streaming (sparse by
        // output_index) — the type doesn't capture that, but buildThread
        // handles it at runtime (`if (!item) return;`).
        items: [
          functionCall("call_1"),
          null,
          functionCallOutput("call_1"),
        ] as unknown as ORItem[],
      },
    });

    const entries = buildThread(null, active);
    const agentEntries = entries.filter((e) => e.source === "agent");
    expect(agentEntries).toHaveLength(2);
    expect(agentEntries.every((e) => e.turnKey === "turn_live")).toBe(true);

    const paired = pairOutputsByCall(entries);
    expect(paired.get("turn_live", "call_1")).toBeDefined();
  });

  it("falls back to a stable per-entry key for the optimistic user item", () => {
    const active = activeTurn({
      turnId: null,
      optimisticUserItem: { type: "message", role: "user", content: "hi" },
    });

    const entries = buildThread(null, active);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.turnKey).toBe("__optimistic__");
  });
});
