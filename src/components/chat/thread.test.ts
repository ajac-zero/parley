import { describe, expect, it } from "vitest";
import type { FunctionCallOutputItem, ORItem } from "~/lib/openresponses";
import { AMBIGUOUS_CALL_OUTPUT, pairOutputsByCall } from "./thread";

const functionCallOutput = (callId: string): FunctionCallOutputItem => ({
  type: "function_call_output",
  call_id: callId,
  output: JSON.stringify({ ok: true, forCall: callId }),
});

const entry = (item: ORItem, turnKey: string) => ({ item, turnKey });

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
