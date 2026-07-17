import { describe, expect, it } from "vitest";
import {
  isMissingEstablishedContinuation,
  validateAttachmentCount,
} from "./turns";

describe("turn attachment limits", () => {
  it("accepts 10 attachment IDs", () => {
    const fileIds = Array.from({ length: 10 }, (_, index) => `file-${index}`);

    expect(validateAttachmentCount(fileIds)).toBeNull();
  });

  it("rejects 11 attachment IDs with a 400 error", () => {
    const fileIds = Array.from({ length: 11 }, (_, index) => `file-${index}`);

    expect(validateAttachmentCount(fileIds)).toMatchObject({
      message: "Too many attachments (max 10).",
      status: 400,
    });
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
