import { isIP } from "node:net";
import { Data, Effect, Option, Stream } from "effect";
import type { ORStreamEvent } from "~/lib/openresponses";
import { parseSseStream, SSE_DONE } from "~/lib/sse";
import { DEMO_AGENT_BASE_URL, handleDemoResponses } from "~/server/demo-agent";
import { appEnv } from "~/server/env";

export class AgentRequestError extends Data.TaggedError("AgentRequestError")<{
  status?: number;
  code?: string;
  message: string;
}> {}

export interface AgentEndpoint {
  baseUrl: string;
  apiKey?: string | null;
}

export interface CreateResponseOptions {
  model?: string | null;
  instructions?: string | null;
  input: unknown[];
  previousResponseId?: string | null;
  store: boolean;
  /** Extra provider params (temperature, reasoning, ...). Core fields win. */
  params?: Record<string, unknown> | null;
}

/** `https://host/v1` -> `https://host/v1/responses` (idempotent). */
export function responsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/responses") ? trimmed : `${trimmed}/responses`;
}

export function buildCreateResponseBody(
  options: CreateResponseOptions,
): Record<string, unknown> {
  return {
    ...(options.params ?? {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.instructions ? { instructions: options.instructions } : {}),
    input: options.input,
    stream: true,
    store: options.store,
    ...(options.previousResponseId
      ? { previous_response_id: options.previousResponseId }
      : {}),
  };
}

const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return PRIVATE_V4.test(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("::ffff:127.") ||
      lower.startsWith("::ffff:10.") ||
      lower.startsWith("::ffff:192.168.")
    );
  }
  return false;
}

/**
 * Validates an agent base URL. Enforces http(s) and, when
 * BLOCK_PRIVATE_AGENT_ADDRESSES is enabled, refuses private/loopback targets.
 * Self-hosters commonly point Parley at localhost agents, so blocking is
 * opt-in; enable it for multi-tenant/public deployments.
 */
export const validateAgentUrl = (
  baseUrl: string,
): Effect.Effect<void, AgentRequestError> =>
  Effect.gen(function* () {
    // The built-in demo agent is dispatched in-process; nothing to validate.
    if (baseUrl === DEMO_AGENT_BASE_URL) return;
    const url = yield* Effect.try({
      try: () => new URL(baseUrl),
      catch: () =>
        new AgentRequestError({ message: `Invalid agent URL: ${baseUrl}` }),
    });
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return yield* new AgentRequestError({
        message: "Agent URLs must use http:// or https://",
      });
    }
    if (!appEnv.blockPrivateAgentAddresses) return;

    const { lookup } = yield* Effect.promise(() => import("node:dns/promises"));
    const literalIp = isIP(url.hostname.replace(/^\[|\]$/g, ""));
    const addresses = literalIp
      ? [url.hostname.replace(/^\[|\]$/g, "")]
      : (yield* Effect.tryPromise({
          try: () => lookup(url.hostname, { all: true }),
          catch: () =>
            new AgentRequestError({
              message: `Could not resolve agent host: ${url.hostname}`,
            }),
        })).map((a) => a.address);

    if (addresses.some(isPrivateAddress)) {
      return yield* new AgentRequestError({
        message:
          "Agent endpoints resolving to private addresses are blocked on this deployment (BLOCK_PRIVATE_AGENT_ADDRESSES=true).",
      });
    }
  });

async function parseErrorResponse(res: Response): Promise<AgentRequestError> {
  let message = `Agent returned HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: { message?: string; code?: string; type?: string };
    };
    if (body?.error?.message) message = body.error.message;
    code = body?.error?.code ?? body?.error?.type;
  } catch {
    // non-JSON error body
  }
  return new AgentRequestError({ status: res.status, code, message });
}

const connectionErrorMessage = (error: unknown): string => {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const detail =
    cause?.code ?? (error instanceof Error ? error.message : String(error));
  return `Could not reach the agent endpoint (${detail}). Check the base URL and that the agent is running.`;
};

/**
 * Client for Open Responses agent endpoints. `stream` performs
 * `POST {base}/responses` with `stream: true` and yields semantic events.
 * Agents that reply with `application/json` (ignoring the stream flag) are
 * tolerated: the final response object is synthesized into a
 * `response.completed` event.
 */
export class OpenResponsesClient extends Effect.Service<OpenResponsesClient>()(
  "OpenResponsesClient",
  {
    sync: () => ({
      stream: (
        endpoint: AgentEndpoint,
        options: CreateResponseOptions,
      ): Stream.Stream<ORStreamEvent, AgentRequestError> =>
        Stream.unwrapScoped(
          Effect.gen(function* () {
            const isDemo = endpoint.baseUrl === DEMO_AGENT_BASE_URL;
            if (isDemo && !appEnv.demoAgent) {
              return yield* Effect.fail(
                new AgentRequestError({
                  message: "The demo agent is disabled on this deployment.",
                }),
              );
            }
            yield* validateAgentUrl(endpoint.baseUrl);

            const controller = new AbortController();
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => controller.abort()),
            );

            const requestInit: RequestInit = {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "text/event-stream",
                ...(endpoint.apiKey
                  ? { authorization: `Bearer ${endpoint.apiKey}` }
                  : {}),
              },
              body: JSON.stringify(buildCreateResponseBody(options)),
              signal: controller.signal,
            };

            // The demo agent is called in-process: it must work regardless
            // of how (or whether) the public APP_URL routes back to us.
            const res = yield* Effect.tryPromise({
              try: () =>
                isDemo
                  ? handleDemoResponses(
                      new Request(
                        "http://demo.parley.internal/v1/responses",
                        requestInit,
                      ),
                    )
                  : fetch(responsesUrl(endpoint.baseUrl), requestInit),
              catch: (error) =>
                new AgentRequestError({
                  message: connectionErrorMessage(error),
                }),
            });

            if (!res.ok) {
              const error = yield* Effect.promise(() =>
                parseErrorResponse(res),
              );
              return yield* Effect.fail(error);
            }

            const contentType = res.headers.get("content-type") ?? "";

            if (contentType.includes("application/json")) {
              // Non-streaming fallback: synthesize terminal events.
              const body = yield* Effect.tryPromise({
                try: () => res.json() as Promise<Record<string, unknown>>,
                catch: () =>
                  new AgentRequestError({
                    message: "Agent returned invalid JSON.",
                  }),
              });
              const status =
                typeof body.status === "string" ? body.status : "completed";
              const terminal: ORStreamEvent = {
                type:
                  status === "failed"
                    ? "response.failed"
                    : status === "incomplete"
                      ? "response.incomplete"
                      : "response.completed",
                response: body,
              };
              return Stream.fromIterable([terminal]);
            }

            if (!res.body) {
              return yield* Effect.fail(
                new AgentRequestError({
                  message: "Agent response had no body.",
                }),
              );
            }

            return Stream.fromAsyncIterable(
              parseSseStream(res.body),
              (error) =>
                new AgentRequestError({
                  message: `Agent stream failed: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                }),
            ).pipe(
              Stream.takeWhile((msg) => msg.data.trim() !== SSE_DONE),
              Stream.filterMap((msg) => {
                try {
                  const parsed = JSON.parse(msg.data) as ORStreamEvent;
                  return typeof parsed?.type === "string"
                    ? Option.some(parsed)
                    : Option.none();
                } catch {
                  return Option.none();
                }
              }),
            );
          }),
        ),
    }),
  },
) {}
