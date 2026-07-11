/**
 * The built-in demo agent: a tiny, self-contained Open Responses server used
 * for trying Parley without any external agent. It also doubles as a
 * reference implementation of the streaming protocol and is exercised by the
 * integration tests.
 */

import { A2UI_MIME_TYPE } from "~/lib/a2ui";
import type { ContentPart, ORItem } from "~/lib/openresponses";
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

/** An A2UI action carried in a user message's `a2ui` content part. */
interface DemoA2uiAction {
  name: string;
  context: Record<string, unknown>;
}

function a2uiActionFromParts(
  parts: Array<Record<string, unknown>>,
): DemoA2uiAction | null {
  for (const part of parts) {
    if (part.type !== "a2ui" || !Array.isArray(part.data)) continue;
    for (const raw of part.data as Array<Record<string, unknown>>) {
      const action = raw?.action as Record<string, unknown> | undefined;
      if (action && typeof action.name === "string") {
        return {
          name: action.name,
          context:
            typeof action.context === "object" && action.context !== null
              ? (action.context as Record<string, unknown>)
              : {},
        };
      }
    }
  }
  return null;
}

function lastUserText(input: unknown): {
  text: string;
  images: number;
  files: number;
  turns: number;
  a2uiAction: DemoA2uiAction | null;
} {
  let text = "";
  let images = 0;
  let files = 0;
  let turns = 0;
  let a2uiAction: DemoA2uiAction | null = null;
  if (typeof input === "string")
    return { text: input, images: 0, files: 0, turns: 1, a2uiAction: null };
  if (!Array.isArray(input)) return { text, images, files, turns, a2uiAction };
  for (const raw of input) {
    const item = raw as Record<string, unknown>;
    if (item.type === "message" && item.role === "user") {
      turns += 1;
      text = "";
      images = 0;
      files = 0;
      a2uiAction = null;
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
        a2uiAction = a2uiActionFromParts(
          item.content as Array<Record<string, unknown>>,
        );
      }
    }
  }
  return { text, images, files, turns, a2uiAction };
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

/* ------------------------------ A2UI showcase ----------------------------- */

const A2UI_VERSION = "v0.9.1";
const A2UI_CATALOG_ID =
  "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json";

/** Wraps A2UI messages in the MCP embedded-resource convention, alongside a
 * textual fallback for clients that can't render the resource. */
function a2uiToolOutput(
  uri: string,
  fallback: string,
  messages: Array<Record<string, unknown>>,
): ContentPart[] {
  return [
    { type: "output_text", text: fallback },
    {
      type: "resource",
      resource: {
        uri,
        mimeType: A2UI_MIME_TYPE,
        text: JSON.stringify(messages),
      },
    } as unknown as ContentPart,
  ];
}

/** The reservation form surface (exercises most of the Basic Catalog). */
function reservationFormMessages(): Array<Record<string, unknown>> {
  const surfaceId = "demo_reservation_form";
  const requiredName = {
    condition: {
      call: "required",
      args: { value: { path: "/reservation/name" } },
    },
    message: "A reservation name is required.",
  };
  const components = [
    { id: "root", component: "Card", child: "layout" },
    {
      id: "layout",
      component: "Column",
      children: [
        "title",
        "subtitle",
        "rule",
        "name",
        "when",
        "party",
        "seating",
        "notify",
        "footer",
      ],
    },
    {
      id: "title",
      component: "Text",
      variant: "h3",
      text: "Book a table at Chez Parley",
    },
    {
      id: "subtitle",
      component: "Text",
      variant: "caption",
      text: "The demo bistro always has room — this form arrived as an A2UI resource in a tool result.",
    },
    { id: "rule", component: "Divider" },
    {
      id: "name",
      component: "TextField",
      label: "Reservation name",
      value: { path: "/reservation/name" },
      checks: [requiredName],
    },
    {
      id: "when",
      component: "DateTimeInput",
      label: "Date & time",
      enableDate: true,
      enableTime: true,
      value: { path: "/reservation/when" },
    },
    {
      id: "party",
      component: "Slider",
      label: "Party size",
      min: 1,
      max: 12,
      value: { path: "/reservation/partySize" },
    },
    {
      id: "seating",
      component: "ChoicePicker",
      label: "Seating",
      variant: "mutuallyExclusive",
      displayStyle: "chips",
      options: [
        { label: "Dining room", value: "dining room" },
        { label: "Patio", value: "patio" },
        { label: "Chef's bar", value: "chef's bar" },
      ],
      value: { path: "/reservation/seating" },
    },
    {
      id: "notify",
      component: "CheckBox",
      label: "Email me a confirmation",
      value: { path: "/reservation/notify" },
    },
    { id: "footer", component: "Row", justify: "end", children: ["submit"] },
    { id: "submit_text", component: "Text", text: "Request reservation" },
    {
      id: "submit",
      component: "Button",
      variant: "primary",
      child: "submit_text",
      action: {
        event: {
          name: "submit_reservation",
          context: { reservation: { path: "/reservation" } },
        },
      },
      checks: [requiredName],
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId: A2UI_CATALOG_ID },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/reservation",
        value: {
          name: "",
          when: "",
          partySize: 2,
          seating: ["dining room"],
          notify: true,
        },
      },
    },
  ];
}

/**
 * The confirmation: no new surface — these envelopes target the existing
 * `demo_reservation_form` surface (created by an earlier tool result) and
 * morph it in place, the standard A2UI way to reflect an action's outcome.
 * Data lands first so the swapped components bind in the same commit; the
 * details are server-written (not read from the client's local edits) so
 * replaying the conversation reproduces the confirmed state.
 * (Exercises template children + relative bindings.)
 */
function confirmationUpdateMessages(
  details: Array<{ label: string; value: string }>,
): Array<Record<string, unknown>> {
  const surfaceId = "demo_reservation_form";
  const components = [
    // Re-point the existing root at the confirmation layout; the old form
    // components stay in the surface's map, just unreferenced.
    { id: "root", component: "Card", child: "confirm_layout" },
    {
      id: "confirm_layout",
      component: "Column",
      children: [
        "confirm_header",
        "confirm_rule",
        "confirm_details",
        "confirm_footnote",
      ],
    },
    {
      id: "confirm_header",
      component: "Row",
      align: "center",
      children: ["confirm_icon", "confirm_title"],
    },
    { id: "confirm_icon", component: "Icon", name: "check" },
    {
      id: "confirm_title",
      component: "Text",
      variant: "h4",
      text: "Reservation confirmed",
    },
    { id: "confirm_rule", component: "Divider" },
    {
      id: "confirm_details",
      component: "List",
      children: { path: "/confirmation/details", componentId: "confirm_row" },
    },
    {
      id: "confirm_row",
      component: "Row",
      justify: "spaceBetween",
      children: ["confirm_label", "confirm_value"],
    },
    {
      id: "confirm_label",
      component: "Text",
      variant: "caption",
      text: { path: "label" },
    },
    {
      id: "confirm_value",
      component: "Text",
      variant: "h5",
      text: { path: "value" },
    },
    {
      id: "confirm_footnote",
      component: "Text",
      variant: "caption",
      text: "Confirmation #PARLEY-0042 — the demo bistro never overbooks.",
    },
  ];
  return [
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/confirmation",
        value: { details },
      },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

const str = (value: unknown, max = 120): string =>
  typeof value === "string" ? value.slice(0, max) : "";

/** Builds the confirmation turn for a submitted reservation action. */
function replyForA2uiAction(action: DemoA2uiAction): BuiltReply {
  if (action.name !== "submit_reservation") {
    return {
      reasoning: `The user triggered the A2UI action "${str(action.name, 60)}". I'll acknowledge it and echo the context so they can see the round-trip.`,
      reply: `I received your \`${str(action.name, 60)}\` UI action with this context:\n\n\`\`\`json\n${JSON.stringify(action.context, null, 2).slice(0, 2_000)}\n\`\`\`\n\nA real agent would route it back to the tool that owns the surface.`,
      tool: null,
    };
  }

  const reservation =
    typeof action.context.reservation === "object" &&
    action.context.reservation !== null
      ? (action.context.reservation as Record<string, unknown>)
      : {};
  const name = str(reservation.name, 80) || "Guest";
  const when = str(reservation.when, 40);
  const partySize =
    typeof reservation.partySize === "number" &&
    Number.isFinite(reservation.partySize)
      ? Math.max(1, Math.min(99, Math.round(reservation.partySize)))
      : 2;
  const seating = Array.isArray(reservation.seating)
    ? str(reservation.seating[0], 40)
    : str(reservation.seating, 40);
  const notify = reservation.notify === true;

  const details = [
    { label: "Name", value: name },
    { label: "When", value: when || "Whenever you arrive" },
    {
      label: "Party",
      value: `${partySize} ${partySize === 1 ? "guest" : "guests"}`,
    },
    { label: "Seating", value: seating || "Dining room" },
    {
      label: "Confirmation",
      value: notify ? "Email on its way" : "No email requested",
    },
  ];

  return {
    reasoning: `The user submitted the reservation form (an A2UI action routed back through the conversation). I'll confirm the booking for ${name} by updating the existing form surface in place.`,
    reply: `All set, **${name}**! Your table for **${partySize}** is requested${
      when ? ` for **${when}**` : ""
    }${seating ? ` in the **${seating}**` : ""}. ${
      notify
        ? "A (pretend) confirmation email is on its way."
        : "No confirmation email will be sent."
    }\n\nNotice the form above turned into the confirmation **in place**: \`confirm_reservation\` returned \`updateComponents\`/\`updateDataModel\` envelopes targeting the *same* \`surfaceId\`, so Parley morphed the existing surface instead of rendering a new one. That's the full A2UI loop: tool → typed resource → rendered form → user action → agent-driven update.`,
    tool: {
      name: "confirm_reservation",
      args: JSON.stringify({ name, when, party_size: partySize, seating }),
      output: a2uiToolOutput(
        "a2ui://demo/reservation-confirmation",
        `Reservation confirmed for ${name} (party of ${partySize}).`,
        confirmationUpdateMessages(details),
      ),
    },
  };
}

interface BuiltReply {
  reasoning: string;
  reply: string;
  tool: {
    name: string;
    args: string;
    output: string | ContentPart[];
  } | null;
}

function buildReply(parsed: ReturnType<typeof lastUserText>): BuiltReply {
  const text = parsed.text.trim();
  const lower = text.toLowerCase();

  if (parsed.a2uiAction) {
    return replyForA2uiAction(parsed.a2uiAction);
  }

  if (lower.includes("markdown")) {
    return {
      reasoning:
        "The user wants to see markdown rendering. I'll produce a document exercising headings, tables, code blocks and lists.",
      reply: MARKDOWN_SAMPLE,
      tool: null,
    };
  }

  if (/\b(a2ui|book|reserve|reservation|table|form)\b/.test(lower)) {
    return {
      reasoning:
        "The user wants to see generative UI. I'll call the demo find_table tool, which returns an A2UI form resource, and invite them to submit it.",
      reply: `I called the \`find_table\` tool and it returned a **typed A2UI resource** (\`application/a2ui+json\`) along with its JSON result — Parley rendered it as the form above using native components.\n\nFill it in and hit **Request reservation**: the action flows back to me through the conversation, and I'll confirm your booking by updating this same surface in place.`,
      tool: {
        name: "find_table",
        args: JSON.stringify({ venue: "Chez Parley", date: "tonight" }),
        output: a2uiToolOutput(
          "a2ui://demo/reservation-form",
          "Reservation form for Chez Parley. Fill it in and submit to request a table.",
          reservationFormMessages(),
        ),
      },
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
    reply: `${intro}${echo}${attachmentNote}\n\nThings to try:\n- Ask me about the **weather** to see a tool call\n- Say **markdown** to see rich rendering\n- Say **book a table** to see generative UI (A2UI)\n- Connect your own agent from the **Agents** page`,
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
