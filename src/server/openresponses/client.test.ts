import { createServer } from "node:http";
import { Chunk, Effect, Stream } from "effect";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { handleDemoResponses } from "../../../examples/demo-agent/agent";
import {
  buildCreateResponseBody,
  OpenResponsesClient,
  responsesUrl,
} from "./client";

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const result = await handleDemoResponses(
    new Request(`http://${request.headers.host}${request.url}`, {
      method: request.method,
      headers: request.headers as HeadersInit,
      body: Buffer.concat(chunks),
    }),
  );
  response.writeHead(result.status, Object.fromEntries(result.headers));
  if (!result.body) return response.end();
  const reader = result.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(value);
  }
  response.end();
});

let port: number;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const collectResponse = (response: Response) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* OpenResponsesClient;
      return yield* Stream.runCollect(
        client.stream(
          { baseUrl: "https://agent.example/v1" },
          { input: [], store: false },
        ),
      );
    }).pipe(Effect.provide(OpenResponsesClient.Default)),
  );
};

describe("OpenResponsesClient transport", () => {
  it("streams from the standalone demo agent over HTTP", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* OpenResponsesClient;
        return yield* Stream.runCollect(
          client.stream(
            { baseUrl: `http://127.0.0.1:${port}/v1` },
            {
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    { type: "input_text", text: "transport probe 4815" },
                  ],
                },
              ],
              store: false,
            },
          ),
        );
      }).pipe(Effect.provide(OpenResponsesClient.Default)),
    );

    const values = Chunk.toReadonlyArray(events);
    expect(values[0]?.type).toBe("response.created");
    expect(values.at(-1)?.type).toBe("response.completed");
    expect(JSON.stringify(values)).toContain("transport probe 4815");
  });

  it("accepts omitted or matching SSE event names", async () => {
    const events = await collectResponse(
      new Response(
        [
          'data: {"type":"response.created","response":{"id":"r1"}}',
          "",
          "event: response.completed",
          'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output":[]}}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      ),
    );

    expect(Chunk.toReadonlyArray(events).map((event) => event.type)).toEqual([
      "response.created",
      "response.completed",
    ]);
  });

  it("rejects malformed or mismatched SSE events", async () => {
    await expect(
      collectResponse(
        new Response("data: not-json\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    ).rejects.toThrow(/invalid SSE event/);

    await expect(
      collectResponse(
        new Response(
          'event: message\ndata: {"type":"response.completed"}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    ).rejects.toThrow(/does not match/);
  });

  it("rejects streaming responses without an SSE content type", async () => {
    await expect(
      collectResponse(
        new Response(new TextEncoder().encode("data: [DONE]\n\n")),
      ),
    ).rejects.toThrow(/unsupported content type: missing/);
  });
});

describe("Open Responses requests", () => {
  it("constructs response URLs without corrupting query parameters", () => {
    expect(responsesUrl("https://agent.example/v1?tenant=one")).toBe(
      "https://agent.example/v1/responses?tenant=one",
    );
    expect(responsesUrl("https://agent.example/v1/responses/")).toBe(
      "https://agent.example/v1/responses",
    );
  });

  it("lets core request fields override provider params", () => {
    expect(
      buildCreateResponseBody({
        input: [{ type: "message" }],
        store: false,
        params: {
          input: "wrong",
          stream: false,
          store: true,
          temperature: 0.2,
        },
      }),
    ).toEqual({
      input: [{ type: "message" }],
      stream: true,
      store: false,
      temperature: 0.2,
    });
  });
});
