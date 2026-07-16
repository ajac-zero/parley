import { isIP } from "node:net";
import { Data, Effect, Stream } from "effect";
import {
  ARTIFACT_ITEM_TYPE,
  type DownloadableArtifactItem,
  type ORStreamEvent,
  type ParleyAttachmentItem,
} from "~/lib/openresponses";
import { parseSseStream, SSE_DONE } from "~/lib/sse";
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

type ArtifactFetcher = (url: URL, init?: RequestInit) => Promise<Response>;

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

const validArtifactFilename = (filename: string): boolean =>
  filename !== "." &&
  filename !== ".." &&
  ![...filename].some((character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code < 32 || code === 127;
  });

export function resolveArtifactUrl(baseUrl: string, downloadUrl: string): URL {
  const base = new URL(baseUrl);
  const resolved = new URL(downloadUrl, base);
  if (
    !["http:", "https:"].includes(resolved.protocol) ||
    resolved.origin !== base.origin ||
    resolved.username !== "" ||
    resolved.password !== ""
  ) {
    throw new AgentRequestError({
      message: "Artifact download URL must use the agent origin.",
    });
  }
  return resolved;
}

export function validateDownloadableArtifact(
  value: unknown,
): DownloadableArtifactItem {
  const artifact = value as Partial<DownloadableArtifactItem>;
  if (
    artifact?.type !== ARTIFACT_ITEM_TYPE ||
    artifact.status !== "completed" ||
    typeof artifact.id !== "string" ||
    artifact.id.length === 0 ||
    artifact.id.length > 200 ||
    typeof artifact.size !== "number" ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 0 ||
    typeof artifact.content_url !== "string" ||
    artifact.content_url.length === 0 ||
    artifact.content_url.length > 2000 ||
    typeof artifact.filename !== "string" ||
    artifact.filename.length === 0 ||
    artifact.filename.length > 300 ||
    artifact.filename !== artifact.filename.trim() ||
    !validArtifactFilename(artifact.filename) ||
    typeof artifact.mime_type !== "string" ||
    artifact.mime_type.length > 200 ||
    !MIME_TYPE.test(artifact.mime_type)
  ) {
    throw new AgentRequestError({
      message: "Agent returned an invalid artifact.",
    });
  }
  return artifact as DownloadableArtifactItem;
}

export function artifactAttachmentItem(
  artifact: DownloadableArtifactItem,
  file: { id: string; size: number },
): ParleyAttachmentItem {
  return {
    type: "parley:attachment",
    id: artifact.id,
    status: "completed",
    filename: artifact.filename,
    mime_type: artifact.mime_type,
    size: file.size,
    file_url: `parley-file:${file.id}`,
    provider_artifact: { id: artifact.id },
  };
}

export async function downloadArtifact(
  endpoint: AgentEndpoint,
  value: unknown,
  maxBytes: number,
  fetcher: ArtifactFetcher = fetch,
  signal?: AbortSignal,
): Promise<{ artifact: DownloadableArtifactItem; data: Uint8Array }> {
  const artifact = validateDownloadableArtifact(value);
  if (artifact.size > maxBytes) {
    throw new AgentRequestError({
      message: "Agent artifact exceeds the file size limit.",
    });
  }
  const url = resolveArtifactUrl(endpoint.baseUrl, artifact.content_url);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        accept: artifact.mime_type,
        ...(endpoint.apiKey
          ? { authorization: `Bearer ${endpoint.apiKey}` }
          : {}),
      },
      redirect: "manual",
      signal,
    });
  } catch (error) {
    throw new AgentRequestError({ message: connectionErrorMessage(error) });
  }
  if (
    !response.ok ||
    !response.body ||
    response.status < 200 ||
    response.status >= 300
  ) {
    await response.body?.cancel();
    throw new AgentRequestError({
      status: response.status,
      message: `Agent artifact download returned HTTP ${response.status}.`,
    });
  }
  const responseType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (
    !responseType ||
    !MIME_TYPE.test(responseType) ||
    responseType.toLowerCase() !== artifact.mime_type.toLowerCase()
  ) {
    await response.body.cancel();
    throw new AgentRequestError({
      message: "Agent artifact response has an unexpected Content-Type.",
    });
  }
  const lengthHeader = response.headers.get("content-length");
  const encoded = response.headers.has("content-encoding");
  if (lengthHeader !== null && !encoded) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0) {
      await response.body.cancel();
      throw new AgentRequestError({
        message: "Agent artifact has an invalid Content-Length.",
      });
    }
    if (length > maxBytes) {
      await response.body.cancel();
      throw new AgentRequestError({
        message: "Agent artifact exceeds the file size limit.",
      });
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AgentRequestError({
          message: "Agent artifact exceeds the file size limit.",
        });
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof AgentRequestError) throw error;
    throw new AgentRequestError({
      message: "Agent artifact download failed while reading data.",
    });
  }
  if (lengthHeader !== null && !encoded && size !== Number(lengthHeader)) {
    throw new AgentRequestError({
      message: "Agent artifact response was truncated.",
    });
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (size !== artifact.size) {
    throw new AgentRequestError({
      message: "Agent artifact size does not match the downloaded content.",
    });
  }
  return { artifact, data };
}

/** `https://host/v1` -> `https://host/v1/responses` (idempotent). */
export function responsesUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/responses") ? path : `${path}/responses`;
  return url.toString();
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
      message?: string;
      detail?: string;
    };
    if (body?.error?.message) message = body.error.message;
    else if (body?.message) message = body.message;
    else if (body?.detail) message = body.detail;
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

            const res = yield* Effect.tryPromise({
              try: () => fetch(responsesUrl(endpoint.baseUrl), requestInit),
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

            const contentType = (res.headers.get("content-type") ?? "")
              .split(";", 1)[0]
              ?.trim()
              .toLowerCase();

            if (
              contentType === "application/json" ||
              contentType?.endsWith("+json")
            ) {
              // Non-streaming fallback: synthesize terminal events.
              const body = yield* Effect.tryPromise({
                try: () => res.json() as Promise<Record<string, unknown>>,
                catch: () =>
                  new AgentRequestError({
                    message: "Agent returned invalid JSON.",
                  }),
              });
              const status = body.status;
              if (
                status !== "completed" &&
                status !== "failed" &&
                status !== "incomplete"
              ) {
                return yield* Effect.fail(
                  new AgentRequestError({
                    message: `Agent returned a non-terminal JSON response${
                      typeof status === "string" ? ` (${status})` : ""
                    }.`,
                  }),
                );
              }
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

            if (contentType !== "text/event-stream") {
              return yield* Effect.fail(
                new AgentRequestError({
                  message: `Agent returned unsupported content type: ${
                    contentType || "missing"
                  }.`,
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
              Stream.mapEffect((msg) =>
                Effect.try({
                  try: () => {
                    const parsed = JSON.parse(msg.data) as ORStreamEvent;
                    if (typeof parsed?.type !== "string") {
                      throw new Error("event data has no type");
                    }
                    if (msg.event && msg.event !== parsed.type) {
                      throw new Error(
                        `event name ${msg.event} does not match data type ${parsed.type}`,
                      );
                    }
                    return parsed;
                  },
                  catch: (error) =>
                    new AgentRequestError({
                      message: `Agent returned an invalid SSE event: ${
                        error instanceof Error ? error.message : String(error)
                      }.`,
                    }),
                }),
              ),
            );
          }),
        ),
    }),
  },
) {}
