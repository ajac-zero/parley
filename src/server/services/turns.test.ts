import { describe, expect, it } from "vitest";
import {
  exceedsAttachmentLimit,
  isMissingEstablishedContinuation,
  MAX_MESSAGE_ATTACHMENTS,
} from "./turns";

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

describe("attachment limit", () => {
  it("accepts exactly the maximum number of attachments", () => {
    const fileIds = Array.from(
      { length: MAX_MESSAGE_ATTACHMENTS },
      (_, i) => `file_${i}`,
    );
    expect(exceedsAttachmentLimit(fileIds)).toBe(false);
  });

  it("rejects one more than the maximum number of attachments", () => {
    const fileIds = Array.from(
      { length: MAX_MESSAGE_ATTACHMENTS + 1 },
      (_, i) => `file_${i}`,
    );
    expect(exceedsAttachmentLimit(fileIds)).toBe(true);
  });

  it("accepts an empty attachment list", () => {
    expect(exceedsAttachmentLimit([])).toBe(false);
  });
});
