import { describe, expect, it } from "vitest";
import { isMissingEstablishedContinuation } from "./turns";

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
