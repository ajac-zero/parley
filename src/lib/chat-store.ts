/**
 * A tiny external store that owns in-flight chat turns. It lives outside
 * React so streams survive route transitions (e.g. navigating from /chat to
 * /chat/$conversationId when the server assigns a conversation id) and can be
 * re-attached after a page refresh via GET /api/chat/$turnId/stream.
 */

import {
  initialTurnStreamState,
  type ORItem,
  type ORStreamEvent,
  reduceORevent,
  type TurnStatus,
  type TurnStreamState,
} from "~/lib/openresponses";
import { parseSseStream, SSE_DONE } from "~/lib/sse";

export const NEW_CHAT_KEY = "__new__";

export interface ActiveTurn {
  key: string;
  turnId: string | null;
  conversationId: string | null;
  phase: "connecting" | "streaming" | "finished";
  state: TurnStreamState;
  /** Persisted user items (from parley.turn.started). */
  userItems: Array<{ id: string; payload: ORItem }>;
  /** Local echo shown until the server confirms the user items. */
  optimisticUserItem: ORItem | null;
  finishedStatus: TurnStatus | null;
  error: { code?: string; message: string } | null;
  /** Hide server items belonging to these turns (regenerate). */
  suppressTurnIds: string[];
  /** Hide server items from this item onwards (edit & resend). */
  truncateFromItemId: string | null;
  cancelRequested: boolean;
  lastEventIndex: number;
}

export interface SendOptions {
  conversationId?: string | null;
  agentId?: string | null;
  text: string;
  fileIds?: string[];
  regenerate?: boolean;
  editFromItemId?: string | null;
  suppressTurnIds?: string[];
  onConversationCreated?: (conversationId: string) => void;
}

export interface ChatStoreHandlers {
  onConversationUpdated?: (conversationId: string, title: string) => void;
  onTurnStarted?: (conversationId: string) => void;
  onTurnFinished?: (
    conversationId: string,
    status: TurnStatus,
  ) => Promise<void> | void;
}

type Listener = () => void;

const emptyTurn = (key: string): ActiveTurn => ({
  key,
  turnId: null,
  conversationId: null,
  phase: "connecting",
  state: initialTurnStreamState,
  userItems: [],
  optimisticUserItem: null,
  finishedStatus: null,
  error: null,
  suppressTurnIds: [],
  truncateFromItemId: null,
  cancelRequested: false,
  lastEventIndex: -1,
});

class ChatStore {
  #entries = new Map<string, ActiveTurn>();
  /**
   * Maps a stale key (e.g. NEW_CHAT_KEY) to the canonical key an entry was
   * migrated to. Lets components that haven't re-rendered/unmounted yet
   * (e.g. the /chat page during the brief window before the router swaps to
   * /chat/$conversationId) keep resolving to the same live entry instead of
   * observing it disappear mid-transition.
   */
  #aliases = new Map<string, string>();
  #listeners = new Set<Listener>();
  handlers: ChatStoreHandlers = {};

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Resolves a possibly-stale key to the entry's current canonical key. */
  #resolve(key: string): string {
    const seen = new Set<string>();
    let current = key;
    while (this.#aliases.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.#aliases.get(current) as string;
    }
    return current;
  }

  get = (key: string): ActiveTurn | undefined =>
    this.#entries.get(this.#resolve(key));

  #emit() {
    for (const listener of this.#listeners) listener();
  }

  #set(key: string, entry: ActiveTurn) {
    this.#entries.set(key, entry);
    this.#emit();
  }

  #update(key: string, patch: Partial<ActiveTurn>) {
    const canonical = this.#resolve(key);
    const current = this.#entries.get(canonical);
    if (!current) return;
    this.#set(canonical, { ...current, ...patch });
  }

  /** Removes a finished entry (after the server transcript was refetched). */
  remove(key: string) {
    const canonical = this.#resolve(key);
    const deleted = this.#entries.delete(canonical);
    for (const [alias, target] of this.#aliases) {
      if (target === canonical) this.#aliases.delete(alias);
    }
    if (deleted) this.#emit();
  }

  /** True if a turn is currently running for this key. */
  isActive(key: string): boolean {
    const entry = this.get(key);
    return entry !== undefined && entry.phase !== "finished";
  }

  async cancel(key: string): Promise<void> {
    const entry = this.get(key);
    if (!entry) return;
    this.#update(key, { cancelRequested: true });
    if (!entry.turnId) return;
    await fetch(`/api/chat/${entry.turnId}/cancel`, { method: "POST" }).catch(
      () => {},
    );
  }

  /** Starts a new turn (send / regenerate / edit&resend). */
  send(options: SendOptions): void {
    const key = options.conversationId ?? NEW_CHAT_KEY;
    if (this.isActive(key)) return;
    // Starting a fresh draft under this key: drop any stale alias left over
    // from a previously migrated (or finished) entry so it doesn't leak in.
    this.#aliases.delete(key);

    const optimistic: ORItem | null =
      options.text.trim().length > 0 || (options.fileIds?.length ?? 0) > 0
        ? {
            type: "message",
            role: "user",
            content: [
              ...(options.text.trim().length > 0
                ? [{ type: "input_text" as const, text: options.text.trim() }]
                : []),
              ...(options.fileIds ?? []).map((id) => ({
                type: "input_image" as const,
                image_url: `parley-file:${id}`,
              })),
            ],
          }
        : null;

    this.#set(key, {
      ...emptyTurn(key),
      conversationId: options.conversationId ?? null,
      optimisticUserItem: options.regenerate ? null : optimistic,
      suppressTurnIds: options.suppressTurnIds ?? [],
      truncateFromItemId: options.editFromItemId ?? null,
    });

    void this.#run(key, options);
  }

  /** Re-attaches to a turn that is already running server-side. */
  resume(conversationId: string, turnId: string): void {
    const key = conversationId;
    const existing = this.#entries.get(key);
    if (
      existing &&
      (existing.phase !== "finished" || existing.turnId === turnId)
    ) {
      return;
    }
    this.#set(key, {
      ...emptyTurn(key),
      conversationId,
      turnId,
      phase: "streaming",
    });
    void this.#attach(key, turnId, -1, 0);
  }

  async #run(key: string, options: SendOptions): Promise<void> {
    let response: Response;
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: options.conversationId ?? null,
          agentId: options.agentId ?? null,
          message:
            options.text.trim().length > 0 || (options.fileIds?.length ?? 0) > 0
              ? { text: options.text, fileIds: options.fileIds ?? [] }
              : null,
          regenerate: options.regenerate ?? false,
          editFromItemId: options.editFromItemId ?? null,
        }),
      });
    } catch {
      this.#fail(key, "Could not reach the server. Check your connection.");
      return;
    }

    if (!response.ok || !response.body) {
      let message = `Request failed (${response.status}).`;
      try {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        if (body.error?.message) message = body.error.message;
      } catch {
        // keep default
      }
      this.#fail(key, message);
      return;
    }

    const turnId = response.headers.get("x-parley-turn-id");
    const conversationId = response.headers.get("x-parley-conversation-id");
    if (turnId) this.#update(key, { turnId, phase: "streaming" });
    if (conversationId && key === NEW_CHAT_KEY) {
      this.#migrate(key, conversationId, options.onConversationCreated);
    }

    const finalKey = conversationId ?? key;
    if (this.#entries.get(finalKey)?.cancelRequested && turnId) {
      void fetch(`/api/chat/${turnId}/cancel`, { method: "POST" }).catch(
        () => {},
      );
    }

    await this.#consume(finalKey, response.body, options);
  }

  #migrate(
    fromKey: string,
    conversationId: string,
    onCreated?: (id: string) => void,
  ) {
    const canonicalFrom = this.#resolve(fromKey);
    const entry = this.#entries.get(canonicalFrom);
    if (!entry) return;
    if (canonicalFrom !== conversationId) {
      this.#entries.delete(canonicalFrom);
      this.#entries.set(conversationId, {
        ...entry,
        key: conversationId,
        conversationId,
      });
    }
    // Keep fromKey (and anything already aliased to canonicalFrom) resolving
    // to the live entry so consumers still reading the old key (e.g. a page
    // that hasn't unmounted yet) don't observe a gap during the transition.
    for (const [alias, target] of this.#aliases) {
      if (target === canonicalFrom) this.#aliases.set(alias, conversationId);
    }
    this.#aliases.set(fromKey, conversationId);
    this.#emit();
    onCreated?.(conversationId);
  }

  async #attach(
    key: string,
    turnId: string,
    afterIndex: number,
    attempt: number,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`/api/chat/${turnId}/stream?after=${afterIndex}`, {
        headers: { accept: "text/event-stream" },
      });
    } catch {
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        return this.#attach(
          key,
          turnId,
          this.#entries.get(key)?.lastEventIndex ?? afterIndex,
          attempt + 1,
        );
      }
      this.#fail(key, "Lost connection to the stream.");
      return;
    }
    if (!response.ok || !response.body) {
      this.#fail(key, "Could not attach to the response stream.");
      return;
    }
    await this.#consume(key, response.body, {} as SendOptions);
  }

  async #consume(
    key: string,
    body: ReadableStream<Uint8Array>,
    options: Partial<SendOptions>,
  ): Promise<void> {
    let sawFinished = false;
    try {
      for await (const message of parseSseStream(body)) {
        if (message.data.trim() === SSE_DONE) break;
        let event: ORStreamEvent;
        try {
          event = JSON.parse(message.data) as ORStreamEvent;
        } catch {
          continue;
        }
        const parsedIndex = message.id
          ? Number.parseInt(message.id, 10)
          : Number.NaN;
        const index = Number.isFinite(parsedIndex) ? parsedIndex : null;
        const resolvedKey = this.#dispatch(key, event, index, options);
        if (resolvedKey !== key) key = resolvedKey;
        if (event.type === "parley.turn.finished") sawFinished = true;
      }
    } catch {
      // Network interruption: the turn is still running server-side.
      const entry = this.#entries.get(key);
      if (entry?.turnId && entry.phase !== "finished") {
        return this.#attach(key, entry.turnId, entry.lastEventIndex, 0);
      }
    }

    if (!sawFinished) {
      const entry = this.#entries.get(key);
      if (entry && entry.phase !== "finished") {
        if (entry.turnId) {
          // Stream ended without a terminal event; try to re-attach once.
          return this.#attach(key, entry.turnId, entry.lastEventIndex, 0);
        }
        this.#fail(key, "The stream ended unexpectedly.");
      }
    }
  }

  #dispatch(
    key: string,
    event: ORStreamEvent,
    index: number | null,
    options: Partial<SendOptions>,
  ): string {
    const entry = this.#entries.get(key);
    if (!entry) return key;
    const indexPatch = index !== null ? { lastEventIndex: index } : {};

    switch (event.type) {
      case "parley.turn.started": {
        const conversationId = String(event.conversation_id ?? "");
        const turnId = String(event.turn_id ?? "");
        const userItems = Array.isArray(event.user_items)
          ? (event.user_items as Array<{ id: string; payload: ORItem }>)
          : [];
        let nextKey = key;
        if (key === NEW_CHAT_KEY && conversationId) {
          this.#migrate(key, conversationId, options.onConversationCreated);
          nextKey = conversationId;
        }
        this.#update(nextKey, {
          turnId,
          conversationId,
          phase: "streaming",
          userItems,
          optimisticUserItem: null,
          ...indexPatch,
        });
        if (conversationId) this.handlers.onTurnStarted?.(conversationId);
        return nextKey;
      }

      case "parley.conversation.updated": {
        const conversationId = String(event.conversation_id ?? "");
        const title = String(event.title ?? "");
        if (conversationId && title) {
          this.handlers.onConversationUpdated?.(conversationId, title);
        }
        this.#update(key, indexPatch);
        return key;
      }

      case "parley.turn.finished": {
        const status = (event.status as TurnStatus) ?? "failed";
        const error =
          (event.error as { code?: string; message: string } | null) ?? null;
        this.#update(key, {
          phase: "finished",
          finishedStatus: status,
          error: error ?? entry.error,
          ...indexPatch,
        });
        const conversationId = entry.conversationId;
        if (conversationId) {
          const done = this.handlers.onTurnFinished?.(conversationId, status);
          void Promise.resolve(done).then(() => this.remove(key));
        } else {
          this.remove(key);
        }
        return key;
      }

      default: {
        this.#update(key, {
          state: reduceORevent(entry.state, event),
          ...indexPatch,
        });
        return key;
      }
    }
  }

  #fail(key: string, message: string) {
    const canonical = this.#resolve(key);
    const entry = this.#entries.get(canonical);
    if (!entry) return;
    this.#set(canonical, {
      ...entry,
      phase: "finished",
      finishedStatus: "failed",
      error: entry.error ?? { message },
    });
  }
}

export const chatStore = new ChatStore();
