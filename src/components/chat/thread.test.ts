import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  Thread,
  type ThreadEntry,
} from "./thread";

const functionCallOutput = (
  callId: string,
  output: string = JSON.stringify({ ok: true, forCall: callId }),
): FunctionCallOutputItem => ({
  type: "function_call_output",
  call_id: callId,
  output,
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

describe("Thread rendering (end-to-end call_id scoping)", () => {
  it("does not let a later turn's output leak onto an earlier turn's same-id call", () => {
    // Reproduces the exact bug named in issue #31 ("earlier calls can
    // display later outputs") at the actual JSX call site
    // (`pairedOutputs.get(entry.turnKey, call.call_id)` in
    // `thread.tsx`'s render), not just in the extracted pure functions:
    // turn_a's call_1 has no output of its own; turn_b's call_1 does. A
    // `call.call_id`-only (unscoped) lookup would incorrectly show
    // turn_a's card as "Completed" with turn_b's output leaking in. A
    // future refactor that accidentally drops `entry.turnKey` from that
    // lookup would make this test fail.
    //
    // Radix's Collapsible omits its (closed-by-default) content from SSR
    // markup, so this asserts on the always-rendered header state badge
    // ("Pending" vs "Completed") rather than the collapsed output body.
    const entries: ThreadEntry[] = [
      {
        key: "call_a",
        item: functionCall("call_1"),
        source: "agent",
        turnKey: "turn_a",
      },
      {
        key: "call_b",
        item: functionCall("call_1"),
        source: "agent",
        turnKey: "turn_b",
      },
      {
        key: "output_b",
        item: functionCallOutput("call_1"),
        source: "agent",
        turnKey: "turn_b",
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(Thread, { entries, active: undefined }),
    );

    const pendingIndex = markup.indexOf(">Pending<");
    const completedIndex = markup.indexOf(">Completed<");
    expect(pendingIndex).toBeGreaterThan(-1);
    expect(completedIndex).toBeGreaterThan(-1);
    // turn_a's card (rendered first, entries order) must show "Pending",
    // not "Completed" with turn_b's output — i.e. its badge appears
    // before turn_b's in the markup.
    expect(pendingIndex).toBeLessThan(completedIndex);
  });
});
