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
  artifactAttachmentItem,
  buildCreateResponseBody,
  downloadArtifact,
  OpenResponsesClient,
  resolveArtifactUrl,
  responsesUrl,
  validateDownloadableArtifact,
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

describe("provider artifact downloads", () => {
  const artifact = {
    type: "ajac-zero:artifact" as const,
    id: "artifact-1",
    status: "completed" as const,
    filename: "report.pdf",
    mime_type: "application/pdf",
    size: 3,
    content_url: "/v1/artifacts/artifact-1",
  };

  it("resolves relative same-origin URLs and rejects cross-origin URLs", () => {
    expect(
      resolveArtifactUrl("https://agent.example/v1", artifact.content_url).href,
    ).toBe("https://agent.example/v1/artifacts/artifact-1");
    expect(() =>
      resolveArtifactUrl(
        "https://agent.example/v1",
        "https://evil.example/file",
      ),
    ).toThrow(/agent origin/);
    expect(() =>
      resolveArtifactUrl("https://agent.example/v1", "//evil.example/file"),
    ).toThrow(/agent origin/);
  });

  it("rejects malformed artifact metadata", () => {
    expect(() =>
      validateDownloadableArtifact({ ...artifact, filename: "../secret" }),
    ).toThrow(/invalid artifact/);
    expect(() =>
      validateDownloadableArtifact({ ...artifact, mime_type: "not a mime" }),
    ).toThrow(/invalid artifact/);
    expect(() =>
      validateDownloadableArtifact({ ...artifact, filename: ".." }),
    ).toThrow(/invalid artifact/);
    expect(() =>
      validateDownloadableArtifact({ ...artifact, id: "a".repeat(201) }),
    ).toThrow(/invalid artifact/);
    expect(() =>
      validateDownloadableArtifact({
        ...artifact,
        content_url: `/${"a".repeat(2000)}`,
      }),
    ).toThrow(/invalid artifact/);
  });

  it("uses bearer auth and returns received bytes", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const result = await downloadArtifact(
      { baseUrl: "https://agent.example/v1", apiKey: "secret-key" },
      artifact,
      10,
      async (input, init) => {
        request = { url: String(input), init };
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-length": "3",
            "content-type": "application/pdf",
          },
        });
      },
    );
    expect(request?.url).toBe("https://agent.example/v1/artifacts/artifact-1");
    expect(new Headers(request?.init?.headers).get("authorization")).toBe(
      "Bearer secret-key",
    );
    expect(request?.init?.redirect).toBe("manual");
    expect([...result.data]).toEqual([1, 2, 3]);
  });

  it("rejects declared oversize artifacts before fetching", async () => {
    const fetcher = vi.fn();
    await expect(
      downloadArtifact(
        { baseUrl: "https://agent.example/v1" },
        { ...artifact, size: 11 },
        10,
        fetcher,
      ),
    ).rejects.toThrow(/size limit/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires a matching response Content-Type case-insensitively", async () => {
    const upper = { ...artifact, mime_type: "Application/PDF" };
    await expect(
      downloadArtifact(
        { baseUrl: "https://agent.example/v1" },
        upper,
        10,
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "application/pdf; charset=binary" },
          }),
      ),
    ).resolves.toMatchObject({ artifact: upper });

    await expect(
      downloadArtifact(
        { baseUrl: "https://agent.example/v1" },
        artifact,
        10,
        async () => new Response(new Uint8Array([1, 2, 3])),
      ),
    ).rejects.toThrow(/Content-Type/);
  });

  it("builds the namespaced persisted attachment without provider bytes", () => {
    expect(
      artifactAttachmentItem(artifact, { id: "file-1", size: 123 }),
    ).toEqual({
      type: "parley:attachment",
      id: "artifact-1",
      status: "completed",
      filename: "report.pdf",
      mime_type: "application/pdf",
      size: 123,
      file_url: "parley-file:file-1",
      provider_artifact: { id: "artifact-1" },
    });
  });

  it("rejects oversized Content-Length before reading", async () => {
    await expect(
      downloadArtifact(
        { baseUrl: "https://agent.example/v1" },
        artifact,
        2,
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: {
              "content-length": "3",
              "content-type": "application/pdf",
            },
          }),
      ),
    ).rejects.toThrow(/size limit/);
  });

  it("rejects streamed bytes over the limit without Content-Length", async () => {
    await expect(
      downloadArtifact(
        { baseUrl: "https://agent.example/v1" },
        artifact,
        2,
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2]));
                controller.enqueue(new Uint8Array([3]));
                controller.close();
              },
            }),
            { headers: { "content-type": "application/pdf" } },
          ),
      ),
    ).rejects.toThrow(/size limit/);
  });

  it("does not compare decoded bytes with an encoded Content-Length", async () => {
    const result = await downloadArtifact(
      { baseUrl: "https://agent.example/v1" },
      artifact,
      10,
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-encoding": "gzip",
            "content-length": "2",
            "content-type": "application/pdf",
          },
        }),
    );

    expect([...result.data]).toEqual([1, 2, 3]);
  });
});
