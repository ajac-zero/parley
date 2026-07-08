import { Effect, Stream } from "effect";
import { formatSseFrame, type SseMessage } from "~/lib/sse";
import type { SessionInfo } from "~/server/auth";
import { sessionFromHeaders } from "~/server/auth";
import { ensureBoot } from "~/server/boot";
import { serverRuntime } from "~/server/runtime";

export const jsonError = (status: number, message: string, code?: string) =>
  Response.json({ error: { message, ...(code ? { code } : {}) } }, { status });

/** Boots the app and authenticates the request, or returns a 401 response. */
export async function requireSession(
  request: Request,
): Promise<SessionInfo | Response> {
  await ensureBoot();
  const session = await sessionFromHeaders(request.headers);
  if (!session) return jsonError(401, "Authentication required.");
  return session;
}

const encoder = new TextEncoder();
const HEARTBEAT = encoder.encode(": keep-alive\n\n");

/**
 * Materializes a stream of SSE messages into a streaming HTTP response,
 * interleaving keep-alive comments so proxies don't sever idle connections.
 */
export async function sseResponse(
  frames: Stream.Stream<SseMessage, never, never>,
  init?: { headers?: Record<string, string> },
): Promise<Response> {
  const runtime = await serverRuntime.runtime();

  const bytes = frames.pipe(
    Stream.map((message) => encoder.encode(formatSseFrame(message))),
  );

  const heartbeats = Stream.repeatEffect(
    Effect.as(Effect.sleep("15 seconds"), HEARTBEAT),
  );

  const merged = Stream.merge(bytes, heartbeats, { haltStrategy: "left" });

  return new Response(Stream.toReadableStreamRuntime(merged, runtime), {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      ...init?.headers,
    },
  });
}
