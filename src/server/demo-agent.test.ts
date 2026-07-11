import { describe, expect, it } from "vitest";
import { extractA2uiResources, reduceA2uiMessages } from "~/lib/a2ui";
import {
  type FunctionCallOutputItem,
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

  it("returns a typed A2UI form resource when asked to book a table", async () => {
    const { state } = await streamAndReduce({
      input: [userMessage("Can I book a table for tonight?")],
    });

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("find_table");

    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const extraction = extractA2uiResources(output.output);
    expect(extraction.resources).toHaveLength(1);
    expect(extraction.resources[0]?.uri).toBe("a2ui://demo/reservation-form");
    expect(extraction.fallbackText).toContain("Reservation form");

    const surfaces = reduceA2uiMessages(
      extraction.resources[0]?.messages ?? [],
    );
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0] as (typeof surfaces)[number];
    expect(surface.supported).toBe(true);
    expect(surface.components.root?.component).toBe("Card");
    expect(surface.components.submit?.component).toBe("Button");
    expect(
      (surface.dataModel as { reservation: { partySize: number } }).reservation
        .partySize,
    ).toBe(2);
  });

  it("confirms a submitted reservation action with a confirmation card", async () => {
    const { state } = await streamAndReduce({
      input: [
        userMessage("book a table"),
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "form sent" }],
        },
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: 'UI action: submit_reservation {"reservation":{...}}',
            },
            {
              type: "a2ui",
              mime_type: "application/a2ui+json",
              data: [
                {
                  version: "v0.9.1",
                  action: {
                    name: "submit_reservation",
                    surfaceId: "demo_reservation_form",
                    sourceComponentId: "submit",
                    timestamp: "2026-07-10T18:00:00.000Z",
                    context: {
                      reservation: {
                        name: "Ada Lovelace",
                        when: "2026-07-11T19:30",
                        partySize: 4,
                        seating: ["patio"],
                        notify: true,
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const message = state.items.find(isMessageItem) as MessageItem;
    const text = messageText(message);
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("**4**");
    expect(text).toContain("patio");

    const call = state.items.find((i) => i.type === "function_call") as {
      name: string;
    };
    expect(call.name).toBe("confirm_reservation");

    const output = state.items.find(
      (i) => i.type === "function_call_output",
    ) as FunctionCallOutputItem;
    const extraction = extractA2uiResources(output.output);
    const surfaces = reduceA2uiMessages(
      extraction.resources[0]?.messages ?? [],
    );
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0] as (typeof surfaces)[number];
    expect(surface.surfaceId).toBe("demo_reservation_confirmation");
    const details = (
      surface.dataModel as {
        details: Array<{ label: string; value: string }>;
      }
    ).details;
    expect(details.find((d) => d.label === "Name")?.value).toBe("Ada Lovelace");
    expect(details.find((d) => d.label === "Party")?.value).toBe("4 guests");
  });

  it("acknowledges unknown A2UI actions without a tool round-trip", async () => {
    const { state } = await streamAndReduce({
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "UI action: custom_action" },
            {
              type: "a2ui",
              mime_type: "application/a2ui+json",
              data: [
                {
                  version: "v0.9.1",
                  action: {
                    name: "custom_action",
                    surfaceId: "s",
                    sourceComponentId: "c",
                    timestamp: "2026-07-10T18:00:00.000Z",
                    context: { probe: 42 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const types = state.items.map((i) => i.type);
    expect(types).not.toContain("function_call");
    const message = state.items.find(isMessageItem) as MessageItem;
    expect(messageText(message)).toContain("custom_action");
    expect(messageText(message)).toContain("42");
  });
});
