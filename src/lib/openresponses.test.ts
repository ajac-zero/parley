import { describe, expect, it } from "vitest";
import {
  finalizePartialItems,
  initialTurnStreamState,
  isMessageItem,
  type MessageItem,
  messageText,
  type ORStreamEvent,
  portableInputItem,
  type ReasoningItem,
  reasoningSummaryText,
  reduceORevent,
  type TurnStreamState,
} from "./openresponses";

const run = (events: ORStreamEvent[], from = initialTurnStreamState) =>
  events.reduce(reduceORevent, from);

describe("reduceORevent", () => {
  it("tracks response id and status from lifecycle events", () => {
    const state = run([
      {
        type: "response.created",
        response: { id: "resp_1", status: "queued" },
      },
    ]);
    expect(state.responseId).toBe("resp_1");
    expect(state.status).toBe("in_progress");
  });

  it("accumulates streamed text deltas into message content", () => {
    const state = run([
      { type: "response.created", response: { id: "resp_1" } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", role: "assistant", content: [] },
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "" },
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Hel",
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "lo!",
      },
    ]);
    const item = state.items[0] as MessageItem;
    expect(messageText(item)).toBe("Hello!");
  });

  it("output_text.done replaces accumulated text with the final text", () => {
    const state = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "partial" }],
        },
      },
      {
        type: "response.output_text.done",
        output_index: 0,
        content_index: 0,
        text: "final text",
      },
    ]);
    expect(messageText(state.items[0] as MessageItem)).toBe("final text");
  });

  it("adds streamed output text annotations", () => {
    const state = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Source", annotations: [] }],
        },
      },
      {
        type: "response.output_text.annotation.added",
        output_index: 0,
        content_index: 0,
        annotation_index: 0,
        annotation: {
          type: "url_citation",
          url: "https://openresponses.org/specification",
          start_index: 0,
          end_index: 6,
          title: "Specification",
        },
      },
    ]);
    const item = state.items[0] as MessageItem;
    expect(
      (item.content[0] as { annotations?: unknown[] }).annotations,
    ).toEqual([
      {
        type: "url_citation",
        url: "https://openresponses.org/specification",
        start_index: 0,
        end_index: 6,
        title: "Specification",
      },
    ]);
  });

  it("ignores annotation indexes that would create sparse arrays", () => {
    const state = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Source", annotations: [] }],
        },
      },
      {
        type: "response.output_text.annotation.added",
        output_index: 0,
        content_index: 0,
        annotation_index: 2,
        annotation: { type: "url_citation" },
      },
      {
        type: "response.output_text.annotation.added",
        output_index: 0,
        content_index: 0,
        annotation_index: -1,
        annotation: { type: "url_citation" },
      },
    ]);

    const item = state.items[0] as MessageItem;
    expect(
      (item.content[0] as { annotations?: unknown[] }).annotations,
    ).toEqual([]);
  });

  it("accumulates function_call argument deltas and finalizes them", () => {
    const state = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          call_id: "c1",
          name: "get_weather",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: '{"city":',
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: '"Paris"}',
      },
    ]);
    expect((state.items[0] as { arguments: string }).arguments).toBe(
      '{"city":"Paris"}',
    );

    const done = reduceORevent(state, {
      type: "response.function_call_arguments.done",
      output_index: 0,
      arguments: '{"city":"Paris","unit":"celsius"}',
    });
    expect((done.items[0] as { arguments: string }).arguments).toBe(
      '{"city":"Paris","unit":"celsius"}',
    );
  });

  it("builds reasoning summaries from deltas", () => {
    const state = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "reasoning", summary: [] },
      },
      {
        type: "response.reasoning_summary_part.added",
        output_index: 0,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      },
      {
        type: "response.reasoning_summary_text.delta",
        output_index: 0,
        summary_index: 0,
        delta: "Thinking ",
      },
      {
        type: "response.reasoning_summary_text.delta",
        output_index: 0,
        summary_index: 0,
        delta: "hard.",
      },
    ]);
    expect(reasoningSummaryText(state.items[0] as ReasoningItem)).toBe(
      "Thinking hard.",
    );
  });

  it("reasoning deltas accumulate into reasoning content", () => {
    const state = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "reasoning", content: [] },
      },
      {
        type: "response.reasoning.delta",
        output_index: 0,
        content_index: 0,
        delta: "step 1",
      },
    ]);
    const item = state.items[0] as ReasoningItem;
    expect(item.content?.[0]?.text).toBe("step 1");
  });

  it("response.completed replaces items with the final output snapshot", () => {
    const state = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "streamed" }],
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_9",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "final" }],
            },
          ],
          usage: { total_tokens: 42 },
        },
      },
    ]);
    expect(state.status).toBe("completed");
    expect(state.responseId).toBe("resp_9");
    expect(state.usage).toEqual({ total_tokens: 42 });
    expect(messageText(state.items[0] as MessageItem)).toBe("final");
  });

  it("response.failed captures the error and usage", () => {
    const state = run([
      {
        type: "response.failed",
        response: {
          id: "r",
          error: { code: "server_error", message: "boom" },
          usage: { total_tokens: 7 },
        },
      },
    ]);
    expect(state.status).toBe("failed");
    expect(state.error).toEqual({ code: "server_error", message: "boom" });
    expect(state.usage).toEqual({ total_tokens: 7 });
  });

  it("error events capture message with fallbacks", () => {
    expect(run([{ type: "error", message: "direct" }]).error?.message).toBe(
      "direct",
    );
    expect(
      run([{ type: "error", error: { message: "nested" } }]).error?.message,
    ).toBe("nested");
    expect(run([{ type: "error" }]).error?.message).toMatch(
      /reported an error/,
    );
  });

  it("ignores unknown event types (spec extension requirement)", () => {
    const before: TurnStreamState = {
      ...initialTurnStreamState,
      items: [
        { type: "message", role: "assistant", content: "hi" } as MessageItem,
      ],
    };
    const after = reduceORevent(before, {
      type: "response.vendor_extension.pulse",
      foo: 1,
    });
    expect(after).toBe(before);
  });

  it("is resilient to deltas for items that were never added", () => {
    const state = run([
      {
        type: "response.output_text.delta",
        output_index: 3,
        content_index: 0,
        delta: "x",
      },
    ]);
    expect(state.items).toHaveLength(0);
  });

  it("does not mutate prior states (immutability)", () => {
    const s0 = run([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "a" }],
        },
      },
    ]);
    const s1 = reduceORevent(s0, {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "b",
    });
    expect(messageText(s0.items[0] as MessageItem)).toBe("a");
    expect(messageText(s1.items[0] as MessageItem)).toBe("ab");
  });
});

describe("finalizePartialItems", () => {
  it("marks in_progress items incomplete and drops holes", () => {
    const sparse: Array<Record<string, unknown> | undefined> = [
      {
        type: "message",
        role: "assistant",
        status: "in_progress",
        content: [],
      },
      undefined,
      { type: "message", role: "assistant", status: "completed", content: [] },
    ];
    const out = finalizePartialItems(sparse as never);
    expect(out).toHaveLength(2);
    expect((out[0] as { status?: string }).status).toBe("incomplete");
    expect((out[1] as { status?: string }).status).toBe("completed");
  });
});

describe("helpers", () => {
  it("messageText joins string and part content", () => {
    expect(
      messageText({ type: "message", role: "user", content: "plain" }),
    ).toBe("plain");
    expect(
      messageText({
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "a" },
          { type: "input_image", image_url: "data:..." },
          { type: "input_text", text: "b" },
        ],
      }),
    ).toBe("ab");
  });

  it("isMessageItem narrows correctly", () => {
    expect(
      isMessageItem({ type: "message", role: "user", content: "" } as never),
    ).toBe(true);
    expect(isMessageItem({ type: "reasoning" } as never)).toBe(false);
  });

  it("removes known presentation parts without changing assistant output", () => {
    const user: MessageItem = {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "UI action fallback" },
        { type: "a2ui", data: [{ action: "submit" }] },
      ],
    };
    const assistant: MessageItem = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Keep me" }],
    };

    expect(portableInputItem(user)).toEqual({
      ...user,
      content: [{ type: "input_text", text: "UI action fallback" }],
    });
    expect(portableInputItem(assistant)).toBe(assistant);
  });

  it("preserves unknown user extension parts for replay", () => {
    const user: MessageItem = {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "fallback" },
        { type: "example:future_part", payload: { value: 42 } },
      ],
    };

    expect(portableInputItem(user)).toEqual(user);
  });

  it("preserves unknown extension items for provider replay", () => {
    const item = {
      type: "example:future_item",
      id: "future-1",
      status: "completed",
      payload: { value: 42 },
    };

    expect(portableInputItem(item)).toBe(item);
  });
});
