import { getRequest } from "@tanstack/react-start/server";
import { Cause, type Effect, Exit, Option } from "effect";
import { type SessionInfo, sessionFromHeaders } from "~/server/auth";
import { ensureBoot } from "~/server/boot";
import type { Db } from "~/server/db/client";
import type { OpenResponsesClient } from "~/server/openresponses/client";
import { serverRuntime } from "~/server/runtime";
import type { Agents } from "~/server/services/agents";
import type { Conversations } from "~/server/services/conversations";
import type { Crypto } from "~/server/services/crypto";
import type { Files } from "~/server/services/files";
import type { RateLimit } from "~/server/services/rate-limit";
import type { Redis } from "~/server/services/redis";
import type { Settings } from "~/server/services/settings";
import type { Turns } from "~/server/services/turns";

export type AppServices =
  | Db
  | Redis
  | Crypto
  | Settings
  | Agents
  | Conversations
  | Files
  | RateLimit
  | OpenResponsesClient
  | Turns;

/** Runs an Effect against the app runtime from a server function. */
export const runApp = <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  serverRuntime.runPromise(effect);

/**
 * Runs an Effect, converting expected domain failures into plain `Error`s
 * whose messages are safe to surface in the UI. Defects become a generic 500.
 */
export async function runAppOrThrow<A, E extends { message: string }>(
  effect: Effect.Effect<A, E, AppServices>,
): Promise<A> {
  const exit = await serverRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw new Error(failure.value.message || "Request failed.");
  }
  console.error("[parley] server function defect:", Cause.pretty(exit.cause));
  throw new Error("Internal server error.");
}

export async function currentSession(): Promise<SessionInfo | null> {
  await ensureBoot();
  const request = getRequest();
  return sessionFromHeaders(request.headers);
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function requireUser(): Promise<SessionInfo> {
  const session = await currentSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export async function requireAdmin(): Promise<SessionInfo> {
  const session = await requireUser();
  if (!session.isAdmin) throw new UnauthorizedError("Admin access required.");
  return session;
}

export const actorOf = (session: SessionInfo) => ({
  userId: session.user.id,
  isAdmin: session.isAdmin,
});
