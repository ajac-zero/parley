import { describe, expect, it } from "vitest";
import { titleFromText } from "~/server/services/conversations";
import { hasMessageContent, isMissingEstablishedContinuation } from "./turns";

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

describe("message emptiness policy", () => {
  it("rejects a message with no text, files, or a2ui", () => {
    expect(hasMessageContent({ text: "  ", fileIds: [] })).toBe(false);
  });

  it("accepts plain text", () => {
    expect(hasMessageContent({ text: "hello", fileIds: [] })).toBe(true);
  });

  it("accepts a file attachment with no text", () => {
    expect(hasMessageContent({ text: "", fileIds: ["file_1"] })).toBe(true);
  });

  it("accepts an A2UI-only message (no text, no files)", () => {
    expect(
      hasMessageContent({ text: "", fileIds: [], a2ui: [{ action: "tap" }] }),
    ).toBe(true);
  });

  it("treats an empty a2ui array as no content", () => {
    expect(hasMessageContent({ text: "", fileIds: [], a2ui: [] })).toBe(false);
  });

  it("accepts normal text-plus-A2UI messages unchanged", () => {
    expect(
      hasMessageContent({
        text: "confirmed",
        fileIds: [],
        a2ui: [{ action: "tap" }],
      }),
    ).toBe(true);
  });

  it("applies the same policy regardless of whether this is the first or a later turn", () => {
    const a2uiOnly = { text: "", fileIds: [], a2ui: [{ action: "tap" }] };
    // Same message shape must be valid whether it's the initial message of a
    // new conversation or a subsequent message in an existing one.
    expect(hasMessageContent(a2uiOnly)).toBe(true);
  });
});

describe("initial-turn title fallback for A2UI-only messages", () => {
  // Mirrors the exact expression used at the conversation-creation call site
  // in `start`: `titleFromText(params.message.text || ownedFiles[0]?.name || "")`.
  const initialTitleFor = (text: string, firstFileName?: string) =>
    titleFromText(text || firstFileName || "");

  it("falls back to 'New chat' for an A2UI-only initial message (no text, no files)", () => {
    expect(initialTitleFor("", undefined)).toBe("New chat");
  });

  it("still titles from the first file name when no text but a file is attached", () => {
    expect(initialTitleFor("", "invoice.pdf")).toBe("invoice.pdf");
  });

  it("still titles from message text when present, regardless of a2ui", () => {
    expect(initialTitleFor("Book a table", "invoice.pdf")).toBe("Book a table");
  });
});
