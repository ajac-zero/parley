import { createServer } from "node:http";
import { Chunk, Effect, Stream } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleDemoResponses } from "../../../examples/demo-agent/agent";
import { OpenResponsesClient } from "./client";

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
});
