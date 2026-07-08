/**
 * The built-in demo agent: a tiny, self-contained Open Responses server used
 * for trying Parley without any external agent. It also doubles as a
 * reference implementation of the streaming protocol and is exercised by the
 * integration tests.
 */

import type { ORItem } from "~/lib/openresponses";
import { newId } from "~/server/ids";

/**
 * Sentinel base URL identifying the built-in demo agent. Requests to it are
 * dispatched in-process (never over the network), so the demo works
 * regardless of APP_URL, port mappings, or proxy topology. It also remains
 * reachable externally at `{APP_URL}/api/demo/v1/responses` for curl testing.
 */
export const DEMO_AGENT_BASE_URL = "parley://demo";

interface DemoRequestBody {
  input?: unknown;
  stream?: boolean;
  instructions?: string;
  model?: string;
}

interface DemoEvent {
  type: string;
  [key: string]: unknown;
}

const encoder = new TextEncoder();

function lastUserText(input: unknown): {
  text: string;
  images: number;
  files: number;
  turns: number;
} {
  let text = "";
  let images = 0;
  let files = 0;
  let turns = 0;
  if (typeof input === "string")
    return { text: input, images: 0, files: 0, turns: 1 };
  if (!Array.isArray(input)) return { text, images, files, turns };
  for (const raw of input) {
    const item = raw as Record<string, unknown>;
    if (item.type === "message" && item.role === "user") {
      turns += 1;
      text = "";
      images = 0;
      files = 0;
      if (typeof item.content === "string") {
        text = item.content;
      } else if (Array.isArray(item.content)) {
        for (const part of item.content as Array<Record<string, unknown>>) {
          if (part.type === "input_text" && typeof part.text === "string") {
            text += part.text;
          }
          if (part.type === "input_image") images += 1;
          if (part.type === "input_file") files += 1;
        }
      }
    }
  }
  return { text, images, files, turns };
}

function chunkText(text: string, size = 12): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

const MARKDOWN_SAMPLE = `Here's a quick tour of what I can render:

## Markdown showcase

**Bold**, *italic*, ~~strikethrough~~, \`inline code\`, and [links](https://openresponses.org).

### A table

| Feature | Status |
| --- | --- |
| Streaming | ✅ |
| Reasoning | ✅ |
| Tool calls | ✅ |

### Code

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

> Everything you see here streamed over the Open Responses protocol.

1. First
2. Second
3. Third

That's the demo!`;

function buildReply(parsed: ReturnType<typeof lastUserText>): {
  reasoning: string;
  reply: string;
  tool: { name: string; args: string; output: string } | null;
} {
  const text = parsed.text.trim();
  const lower = text.toLowerCase();

  if (lower.includes("markdown")) {
    return {
      reasoning:
        "The user wants to see markdown rendering. I'll produce a document exercising headings, tables, code blocks and lists.",
      reply: MARKDOWN_SAMPLE,
      tool: null,
    };
  }

  if (lower.includes("weather") || lower.includes("tool")) {
    const city =
      /in ([a-z\s]+)[?.!]?$/i.exec(text)?.[1]?.trim() ?? "San Francisco";
    return {
      reasoning: `The user asked about ${
        lower.includes("weather") ? "the weather" : "tool calling"
      }. I'll call the demo get_weather tool for ${city}, then summarize the result.`,
      reply: `I called the \`get_weather\` tool for **${city}**. It reports **18°C, partly cloudy** with a light breeze — a fabricated but beautifully formatted forecast, since I'm the built-in demo agent. Connect a real agent to get real answers!`,
      tool: {
        name: "get_weather",
        args: JSON.stringify({ city, unit: "celsius" }),
        output: JSON.stringify({
          city,
          temperature_c: 18,
          conditions: "partly cloudy",
          wind_kph: 9,
        }),
      },
    };
  }

  const attachmentNote =
    parsed.images > 0 || parsed.files > 0
      ? ` I can see you attached ${[
          parsed.images > 0
            ? `${parsed.images} image${parsed.images > 1 ? "s" : ""}`
            : null,
          parsed.files > 0
            ? `${parsed.files} file${parsed.files > 1 ? "s" : ""}`
            : null,
        ]
          .filter(Boolean)
          .join(" and ")} — a real agent would be able to analyze ${
          parsed.images + parsed.files > 1 ? "them" : "it"
        }.`
      : "";

  const intro =
    parsed.turns > 1
      ? `We're ${parsed.turns} turns into this conversation — the full transcript is replayed to me each time, exactly as the Open Responses spec prescribes.`
      : "I'm **Parley's built-in demo agent**, a minimal reference implementation of the [Open Responses](https://openresponses.org) protocol.";

  const echo =
    text.length > 0
      ? `\n\nYou said:\n\n> ${text.slice(0, 500).replace(/\n/g, "\n> ")}\n\n`
      : "\n\n";

  return {
    reasoning:
      "The user sent a general message. I'll introduce myself, echo their message back, and suggest things to try.",
    reply: `${intro}${echo}${attachmentNote}\n\nThings to try:\n- Ask me about the **weather** to see a tool call\n- Say **markdown** to see rich rendering\n- Connect your own agent from the **Agents** page`,
    tool: null,
  };
}

function buildEvents(body: DemoRequestBody): {
  events: DemoEvent[];
  response: Record<string, unknown>;
} {
  const parsed = lastUserText(body.input);
  const { reasoning, reply, tool } = buildReply(parsed);

  const responseId = newId("resp");
  const reasoningId = newId("rs");
  const messageId = newId("msg");

  const output: ORItem[] = [];
  const events: DemoEvent[] = [];
  let seq = 0;
  const push = (event: DemoEvent) => {
    events.push({ ...event, sequence_number: seq++ });
  };

  const baseResponse = {
    id: responseId,
    object: "response",
    model: body.model ?? "parley-demo-1",
    created_at: Math.floor(Date.now() / 1000),
  };

  push({
    type: "response.created",
    response: { ...baseResponse, status: "queued", output: [] },
  });
  push({
    type: "response.in_progress",
    response: { ...baseResponse, status: "in_progress", output: [] },
  });

  /* Reasoning item with a streamed summary */
  let outputIndex = 0;
  push({
    type: "response.output_item.added",
    output_index: outputIndex,
    item: {
      id: reasoningId,
      type: "reasoning",
      status: "in_progress",
      summary: [],
    },
  });
  push({
    type: "response.reasoning_summary_part.added",
    item_id: reasoningId,
    output_index: outputIndex,
    summary_index: 0,
    part: { type: "summary_text", text: "" },
  });
  for (const delta of chunkText(reasoning, 18)) {
    push({
      type: "response.reasoning_summary_text.delta",
      item_id: reasoningId,
      output_index: outputIndex,
      summary_index: 0,
      delta,
    });
  }
  push({
    type: "response.reasoning_summary_text.done",
    item_id: reasoningId,
    output_index: outputIndex,
    summary_index: 0,
    text: reasoning,
  });
  const reasoningItem: ORItem = {
    id: reasoningId,
    type: "reasoning",
    status: "completed",
    summary: [{ type: "summary_text", text: reasoning }],
  } as ORItem;
  push({
    type: "response.output_item.done",
    output_index: outputIndex,
    item: reasoningItem,
  });
  output.push(reasoningItem);

  /* Optional demo tool round-trip (internally hosted) */
  if (tool) {
    outputIndex += 1;
    const callId = newId("call");
    const fcId = newId("fc");
    push({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: {
        id: fcId,
        type: "function_call",
        status: "in_progress",
        call_id: callId,
        name: tool.name,
        arguments: "",
      },
    });
    for (const delta of chunkText(tool.args, 10)) {
      push({
        type: "response.function_call_arguments.delta",
        item_id: fcId,
        output_index: outputIndex,
        delta,
      });
    }
    push({
      type: "response.function_call_arguments.done",
      item_id: fcId,
      output_index: outputIndex,
      arguments: tool.args,
    });
    const fcItem: ORItem = {
      id: fcId,
      type: "function_call",
      status: "completed",
      call_id: callId,
      name: tool.name,
      arguments: tool.args,
    };
    push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: fcItem,
    });
    output.push(fcItem);

    outputIndex += 1;
    const fcoId = newId("fco");
    const fcoItem: ORItem = {
      id: fcoId,
      type: "function_call_output",
      status: "completed",
      call_id: callId,
      output: tool.output,
    };
    push({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { ...fcoItem, status: "in_progress" },
    });
    push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: fcoItem,
    });
    output.push(fcoItem);
  }

  /* Assistant message streamed as output_text deltas */
  outputIndex += 1;
  push({
    type: "response.output_item.added",
    output_index: outputIndex,
    item: {
      id: messageId,
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [],
    },
  });
  push({
    type: "response.content_part.added",
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    part: { type: "output_text", annotations: [], text: "" },
  });
  for (const delta of chunkText(reply, 16)) {
    push({
      type: "response.output_text.delta",
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      delta,
    });
  }
  push({
    type: "response.output_text.done",
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    text: reply,
  });
  push({
    type: "response.content_part.done",
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    part: { type: "output_text", annotations: [], text: reply },
  });
  const messageItem: ORItem = {
    id: messageId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", annotations: [], text: reply }],
  } as ORItem;
  push({
    type: "response.output_item.done",
    output_index: outputIndex,
    item: messageItem,
  });
  output.push(messageItem);

  const usage = {
    input_tokens: Math.ceil(JSON.stringify(body.input ?? "").length / 4),
    output_tokens: Math.ceil(reply.length / 4),
    total_tokens: Math.ceil(
      (JSON.stringify(body.input ?? "").length + reply.length) / 4,
    ),
  };

  const response = {
    ...baseResponse,
    status: "completed",
    completed_at: Math.floor(Date.now() / 1000),
    output,
    usage,
    error: null,
  };
  push({ type: "response.completed", response });

  return { events, response };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleDemoResponses(request: Request): Promise<Response> {
  let body: DemoRequestBody;
  try {
    body = (await request.json()) as DemoRequestBody;
  } catch {
    return Response.json(
      {
        error: {
          message: "Request body must be valid JSON.",
          type: "invalid_request",
          param: null,
          code: "invalid_json",
        },
      },
      { status: 400 },
    );
  }

  const { events, response } = buildEvents(body);

  if (body.stream === false) {
    return Response.json(response);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
          const type = String(event.type);
          // Pace the interesting delta events so streaming is visible.
          if (type.endsWith(".delta")) await sleep(24);
          else await sleep(8);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        // Client disconnected; nothing to clean up.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
