import { describe, expect, it } from "vitest";
import { formatSseFrame, parseSseStream, SseParser } from "./sse";

const stream = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
};

const collect = async (s: ReadableStream<Uint8Array>) => {
  const out = [];
  for await (const message of parseSseStream(s)) out.push(message);
  return out;
};

describe("SseParser", () => {
  it("parses a simple data frame", () => {
    const parser = new SseParser();
    expect(parser.push("data: hello\n\n")).toEqual([{ data: "hello" }]);
  });

  it("joins multi-line data with newlines", () => {
    const parser = new SseParser();
    expect(parser.push("data: line1\ndata: line2\n\n")).toEqual([
      { data: "line1\nline2" },
    ]);
  });

  it("carries event and id fields", () => {
    const parser = new SseParser();
    expect(parser.push("id: 7\nevent: update\ndata: x\n\n")).toEqual([
      { data: "x", event: "update", id: "7" },
    ]);
  });

  it("handles CRLF and lone-CR line endings", () => {
    const parser = new SseParser();
    expect(parser.push("data: a\r\n\r\n")).toEqual([{ data: "a" }]);
    expect(parser.push("data: b\r\r")).toEqual([{ data: "b" }]);
  });

  it("ignores comment lines", () => {
    const parser = new SseParser();
    expect(parser.push(": keep-alive\n\ndata: real\n\n")).toEqual([
      { data: "real" },
    ]);
  });

  it("buffers frames split across pushes", () => {
    const parser = new SseParser();
    expect(parser.push("da")).toEqual([]);
    expect(parser.push("ta: par")).toEqual([]);
    expect(parser.push("tial\n")).toEqual([]);
    expect(parser.push("\n")).toEqual([{ data: "partial" }]);
  });

  it("strips exactly one leading space from field values", () => {
    const parser = new SseParser();
    expect(parser.push("data:  spaced\n\n")).toEqual([{ data: " spaced" }]);
    expect(parser.push("data:tight\n\n")).toEqual([{ data: "tight" }]);
  });

  it("ignores id fields containing NUL, per spec", () => {
    const parser = new SseParser();
    expect(parser.push("id: bad\u0000id\ndata: x\n\n")).toEqual([
      { data: "x" },
    ]);
  });
});

describe("parseSseStream", () => {
  it("yields messages across chunk boundaries", async () => {
    const messages = await collect(
      stream(["data: a\n\nda", "ta: b\n", "\ndata: c\n\n"]),
    );
    expect(messages.map((m) => m.data)).toEqual(["a", "b", "c"]);
  });

  it("handles multi-byte UTF-8 split across chunks", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("data: héllo\n\n");
    const mid = 8; // split inside the two-byte é sequence
    const s = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
        controller.close();
      },
    });
    const messages = await collect(s);
    expect(messages[0]?.data).toBe("héllo");
  });

  it("cancels the underlying stream when the consumer exits early", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const s = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: first\n\n"));
        // Stream intentionally left open; only cancel() ends it.
      },
      cancel() {
        cancelled = true;
      },
    });

    for await (const message of parseSseStream(s)) {
      expect(message.data).toBe("first");
      break; // early exit, e.g. on a [DONE] sentinel
    }

    expect(cancelled).toBe(true);
  });
});

describe("formatSseFrame", () => {
  it("round-trips through the parser", () => {
    const frame = formatSseFrame({
      id: "42",
      event: "response.output_text.delta",
      data: '{"delta":"multi\nline"}',
    });
    const parser = new SseParser();
    const [message] = parser.push(frame);
    expect(message).toEqual({
      id: "42",
      event: "response.output_text.delta",
      data: '{"delta":"multi\nline"}',
    });
  });

  it("omits optional fields", () => {
    expect(formatSseFrame({ data: "x" })).toBe("data: x\n\n");
  });
});
