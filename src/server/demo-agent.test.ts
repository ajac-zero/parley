import { describe, expect, it } from "vitest";
import {
  initialTurnStreamState,
  isMessageItem,
  type MessageItem,
  messageText,
  type ORStreamEvent,
  reduceORevent,
} from "~/lib/openresponses";
import { parseSseStream, SSE_DONE } from "~/lib/sse";
import { handleDemoResponses } from "./demo-agent";

const request = (body: unknown) =>
  new Request("http://demo.local/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const userMessage = (text: string) => ({
  type: "message",
  role: "user",
  content: [{ type: "input_text", text }],
});

/** Streams a demo response and reduces it like the platform does. */
async function streamAndReduce(body: unknown) {
  const response = await handleDemoResponses(request(body));
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const events: ORStreamEvent[] = [];
  let sawDone = false;
  for await (const message of parseSseStream(
    response.body as ReadableStream<Uint8Array>,
  )) {
    if (message.data === SSE_DONE) {
      sawDone = true;
      break;
    }
    events.push(JSON.parse(message.data) as ORStreamEvent);
  }
  const state = events.reduce(reduceORevent, initialTurnStreamState);
  return { events, state, sawDone };
}

describe("handleDemoResponses", () => {
  it("rejects invalid JSON with a 400 in OR error shape", async () => {
    const response = await handleDemoResponses(
      new Request("http://demo.local/v1/responses", {
        method: "POST",
        body: "{oops",
      }),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid_json");
  });

  it("returns a complete JSON response when stream=false", async () => {
    const response = await handleDemoResponses(
      request({ stream: false, input: [userMessage("hi")] }),
    );
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = (await response.json()) as {
      status: string;
      output: Array<Record<string, unknown>>;
      usage: { total_tokens: number };
    };
    expect(payload.status).toBe("completed");
    expect(payload.output.length).toBeGreaterThan(0);
    expect(payload.usage.total_tokens).toBeGreaterThan(0);
  });

  it("streams a spec-shaped event sequence ending in [DONE]", async () => {
    const { events, state, sawDone } = await streamAndReduce({
      input: [userMessage("hello there")],
    });

    expect(sawDone).toBe(true);
    expect(events[0]?.type).toBe("response.created");
    expect(events.at(-1)?.type).toBe("response.completed");
    expect(events.every((e) => typeof e.sequence_number === "number")).toBe(
      true,
    );

    // Reducing the stream must converge to the completed snapshot.
    expect(state.status).toBe("completed");
    expect(state.responseId).toMatch(/^resp_/);
    const message = state.items.find((i) => isMessageItem(i)) as MessageItem;
    expect(messageText(message)).toContain("demo agent");
  });

  it("echoes the user text back in the reply", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("my unique probe 12321")],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("my unique probe 12321");
  });

  it("emits reasoning plus a get_weather tool round-trip for weather asks", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("What is the weather in Tokyo?")],
    });
    const types = state.items.map((i) => i.type);
    expect(types).toContain("reasoning");
    expect(types).toContain("function_call");
    expect(types).toContain("function_call_output");

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
      arguments: string;
      call_id: string;
    };
    expect(call.name).toBe("get_weather");
    expect(JSON.parse(call.arguments)).toMatchObject({ city: "Tokyo" });

    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as {
      call_id: string;
      output: string;
    };
    expect(output.call_id).toBe(call.call_id);
    expect(JSON.parse(output.output)).toMatchObject({ city: "Tokyo" });
  });

  it("returns the markdown tour when asked about markdown", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("show markdown")],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    const text = messageText(message);
    expect(text).toContain("| Feature |");
    expect(text).toContain("```ts");
  });

  it("acknowledges attachments", async () => {
    const { state } = await streamAndReduce({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "look at these" },
            { type: "input_image", image_url: "data:image/png;base64,AAA" },
            { type: "input_image", image_url: "data:image/png;base64,BBB" },
            { type: "input_file", filename: "notes.txt", file_data: "aGk=" },
          ],
        },
      ],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    const text = messageText(message);
    expect(text).toContain("2 images");
    expect(text).toContain("1 file");
  });

  it("counts conversation turns from the replayed transcript", async () => {
    const { state } = await streamAndReduce({
      input: [
        userMessage("first"),
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "reply" }],
        },
        userMessage("second"),
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "reply" }],
        },
        userMessage("third"),
      ],
    });
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("3 turns");
  });

  it("accepts a bare string input", async () => {
    const { state } = await streamAndReduce({ input: "plain string input" });
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("plain string input");
  });
});
