import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_ATTACHMENTS } from "~/lib/limits";
import {
  isMissingEstablishedContinuation,
  validateMessageAttachments,
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

describe("validateMessageAttachments", () => {
  it("accepts exactly the maximum number of attachments", () => {
    const fileIds = Array.from(
      { length: MAX_MESSAGE_ATTACHMENTS },
      (_, i) => `file_${i}`,
    );
    expect(validateMessageAttachments(fileIds)).toBeNull();
  });

  it("rejects one more than the maximum number of attachments with a 400", () => {
    const fileIds = Array.from(
      { length: MAX_MESSAGE_ATTACHMENTS + 1 },
      (_, i) => `file_${i}`,
    );
    const violation = validateMessageAttachments(fileIds);
    expect(violation).not.toBeNull();
    expect(violation?.status).toBe(400);
    expect(violation?.message).toMatch(/more than 10 attachments/);
  });

  it("accepts an empty attachment list", () => {
    expect(validateMessageAttachments([])).toBeNull();
  });

  it("rejects duplicate attachment ids even within the limit", () => {
    const violation = validateMessageAttachments(["file_1", "file_1"]);
    expect(violation).not.toBeNull();
    expect(violation?.status).toBe(400);
    expect(violation?.message).toMatch(/same attachment twice/);
  });
});
