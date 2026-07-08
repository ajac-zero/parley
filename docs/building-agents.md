# Building agents for Parley

Parley talks to agents over the
[Open Responses](https://www.openresponses.org) protocol — the same wire
format as the OpenAI Responses API. If your agent (or an off-the-shelf
gateway/framework) already exposes `POST /v1/responses`, it works with Parley
unmodified. This guide covers what Parley sends, what it expects back, and
how to build a minimal agent from scratch.

## The request

For every turn, Parley makes one HTTP request:

```
POST {base URL}/responses
Content-Type: application/json
Accept: text/event-stream
Authorization: Bearer <api key>        # only if configured for the agent
```

```jsonc
{
  "input": [ /* items — see below */ ],
  "stream": true,
  "store": false,                       // true in previous_response_id mode
  "model": "…",                         // only if set on the agent
  "instructions": "…",                  // only if set on the agent
  "previous_response_id": "resp_…"      // only in previous_response_id mode
  // …plus any extra params configured on the agent (temperature, etc.)
}
```

If the agent's base URL already ends in `/responses`, Parley doesn't append
it again.

### Conversation state: two modes

Configured per agent in the Parley UI:

- **Replay (default, stateless agents).** `input` contains the *entire*
  conversation so far — every user message, and every output item your agent
  previously produced (assistant messages, function calls, function call
  outputs, reasoning items), replayed verbatim with `id` fields stripped.
  Your agent needs no storage at all.
- **`previous_response_id` (stateful agents).** `input` contains only the
  *new* user items, `store: true` is set, and after the first turn Parley
  passes the `previous_response_id` it saw in your last
  `response.completed`. Your agent is responsible for remembering the
  conversation.

### Input items

User messages arrive as message items:

```json
{
  "type": "message",
  "role": "user",
  "content": [
    { "type": "input_text", "text": "What's in this picture?" },
    { "type": "input_image", "image_url": "data:image/png;base64,…" },
    { "type": "input_file", "filename": "report.pdf", "file_data": "data:application/pdf;base64,…" }
  ]
}
```

Attachments are inlined as base64 data URLs. `input_image` / `input_file`
parts only appear if you enable the matching capability toggles on the agent.

## The response

Reply with an SSE stream (`Content-Type: text/event-stream`). Each event's
`data:` is a JSON object with a `type` field; end the stream with
`data: [DONE]`. A minimal happy path:

```
data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}

data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","status":"in_progress","content":[]}}

data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"Hello"}

data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":" world"}

data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hello world"}]}}

data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[…]}}

data: [DONE]
```

Parley renders these event families live:

| Events                                                                 | Rendered as                          |
| ---------------------------------------------------------------------- | ------------------------------------ |
| `response.output_text.delta/done`, `response.refusal.delta/done`       | Streaming assistant text (markdown)  |
| `response.reasoning_summary_text.*`, `response.reasoning_text.*`       | Collapsible "thinking" section       |
| `response.function_call_arguments.delta/done` + `function_call` items  | Tool call cards with live arguments  |
| `response.output_item.added/done`, `response.content_part.added/done`  | Item/part lifecycle                  |
| `response.completed` / `response.incomplete` / `response.failed` / `error` | Turn end state / error banner    |

Unknown event types are tolerated and passed through, so newer protocol
features degrade gracefully.

**Non-streaming fallback:** if you ignore `stream: true` and reply with
`application/json`, Parley synthesizes a `response.completed` from the
response object. Fine for prototypes; streaming is much nicer to use.

**Errors:** return a non-2xx status with
`{"error": {"message": "…", "code": "…"}}` and Parley shows the message to
the user. Mid-stream, emit a `response.failed` or `error` event.

### Tool calls

Emit `function_call` items (with `response.function_call_arguments.delta`
for live argument streaming), execute the tool yourself, then emit a
`function_call_output` item — all within the same response stream. Parley
renders the call and its output; in replay mode both items are included in
subsequent turns' input so your agent keeps the context.

## A minimal agent (Bun/Node)

```ts
const enc = new TextEncoder();
const sse = (data: unknown) =>
  enc.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);

export default {
  port: 8080,
  async fetch(req: Request) {
    const url = new URL(req.url);
    if (req.method !== "POST" || !url.pathname.endsWith("/responses")) {
      return new Response("Not found", { status: 404 });
    }
    const { input } = (await req.json()) as { input: any[] };
    const lastUser = [...input].reverse().find(
      (i) => i.type === "message" && i.role === "user",
    );
    const text = lastUser?.content
      ?.filter((p: any) => p.type === "input_text")
      .map((p: any) => p.text)
      .join("\n") ?? "";

    const reply = `You said: ${text}`;
    const item = (status: string, content: any[]) => ({
      type: "message", id: "msg_1", role: "assistant", status, content,
    });

    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(sse({ type: "response.created", response: { id: "resp_1", status: "in_progress" } }));
        c.enqueue(sse({ type: "response.output_item.added", output_index: 0, item: item("in_progress", []) }));
        for (const word of reply.split(/(?<= )/)) {
          c.enqueue(sse({ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: word }));
          await new Promise((r) => setTimeout(r, 40));
        }
        const done = item("completed", [{ type: "output_text", text: reply }]);
        c.enqueue(sse({ type: "response.output_item.done", output_index: 0, item: done }));
        c.enqueue(sse({ type: "response.completed", response: { id: "resp_1", status: "completed", output: [done] } }));
        c.enqueue(sse("[DONE]"));
        c.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  },
};
```

Run it (`bun run agent.ts`), then in Parley add an agent with base URL
`http://localhost:8080` — done.

> Studying a fuller example? The built-in demo agent
> (`src/server/demo-agent.ts`) implements streaming text, reasoning
> summaries, tool calls, attachments, and the non-streaming fallback in one
> file.

## Operational notes

- **Timeouts:** Parley disconnects if your agent sends nothing for
  `TURN_IDLE_TIMEOUT_SEC` (default 120s) and hard-caps turns at
  `TURN_MAX_DURATION_SEC` (default 600s). Emit deltas or reasoning events
  periodically during long work.
- **Cancellation:** when a user stops a turn, Parley aborts the HTTP
  request. Treat client disconnect as cancellation.
- **API keys** are stored encrypted at rest and sent only as the
  `Authorization` header.
- **Network policy:** deployments with `BLOCK_PRIVATE_AGENT_ADDRESSES=true`
  refuse agent URLs that resolve to loopback/private ranges.
