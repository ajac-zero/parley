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
    { "type": "input_file", "filename": "report.pdf", "file_url": "https://parley.example/api/attachments/…" }
  ]
}
```

Non-image attachments follow the agent's **File delivery** setting:

- **Capability URL** (default): `file_url` is a single-file, HMAC-signed
  Parley URL. It remains valid for `ATTACHMENT_CAPABILITY_TTL_SEC` (default
  15 minutes), which must exceed the maximum turn duration by at least 60
  seconds. Stateful servers must ingest URL-backed input during the original
  turn if they need it for later `previous_response_id` continuations. The
  endpoint serves bytes directly without redirects and requires the agent to
  reach the Parley deployment configured by `APP_URL`.
- **Inline base64**: the part carries raw base64 in `file_data` instead of
  `file_url`. Choose this for agents that cannot reach Parley. Requests are
  larger and are sent again on every replayed turn.

The modes are explicit: Parley never falls back from one to the other.
`input_image` / `input_file` parts only appear if you enable the matching
capability toggles on the agent.

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

**`call_id` uniqueness:** Open Responses does not explicitly define the
scope of uniqueness, so Parley treats `call_id` as unique within the single
response (turn) it belongs to. Parley scopes every
`function_call` ↔ `function_call_output` (and, if you use them, A2UI
presentation sidecar) pairing by `(turn, call_id)`, never by `call_id`
alone. Reusing a short or sequential id scheme across turns is fine and
expected. Within one response, use each `call_id` for exactly one
`function_call` and one `function_call_output`. If either is duplicated,
Parley treats the association as ambiguous: the thread pairs no output and
A2UI ignores content and sidecars for that scoped id.

### Downloadable artifacts

Providers may emit the optional `ajac-zero:artifact` item from the
[Open Responses Extensions](https://github.com/ajac-zero/openresponses-extensions)
profile. Parley validates and downloads completed artifacts from the agent's
own origin, stores the bytes as a user-owned file, and persists a durable
`parley:attachment` in place of the provider URL. Artifact and attachment
items are never replayed to providers. While ingestion is in progress, Parley
shows the provider artifact as preparing; the terminal turn event replaces it
with the finalized durable attachment.

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

> Studying a fuller example? The standalone demo agent
> (`examples/demo-agent`) implements streaming text, reasoning summaries,
> tool calls, attachments, generative UI, and the non-streaming fallback.
> Parley connects to it over HTTP exactly like any other agent.

## Make your agent importable by URL (A2A agent card)

Parley can register your agent from a single URL. Publish an
[A2A agent card](https://a2a-protocol.org/dev/specification/#8-agent-discovery-the-agent-card)
at `https://{your-domain}/.well-known/agent-card.json` and declare your Open
Responses endpoint as a custom-binding interface (A2A §5.8) using the exact
identifier `https://openresponses.org/v1`:

```json
{
  "name": "My Research Agent",
  "description": "Finds and summarizes sources.",
  "version": "1.0.0",
  "capabilities": {},
  "defaultInputModes": ["text/plain", "image/png"],
  "defaultOutputModes": ["text/plain"],
  "skills": [],
  "supportedInterfaces": [
    {
      "url": "https://my-agent.example.com/v1",
      "protocolBinding": "https://openresponses.org/v1",
      "protocolVersion": "1.0"
    }
  ]
}
```

When a user pastes any URL on your domain into "Import from agent card",
Parley fetches the card and prefills the agent's name, description, base URL
(from the interface above), and image/file input support (from
`defaultInputModes`: any `image/*` mode enables image input; modes beyond
text/JSON/images enable file input). The card URL is stored so the agent can
be re-synced later from the edit dialog.

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
