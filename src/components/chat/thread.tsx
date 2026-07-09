import { AlertCircle } from "lucide-react";
import { Fragment, memo, useMemo } from "react";
import {
  AssistantMessage,
  ReasoningBlock,
  ThinkingDot,
  ToolCallBlock,
  UnknownItemBlock,
  UserMessage,
} from "~/components/chat/items";
import { Button } from "~/components/ui/button";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "~/components/ui/conversation";
import type { ConversationDetail } from "~/functions/conversations";
import type { ActiveTurn } from "~/lib/chat-store";
import type {
  FunctionCallItem,
  FunctionCallOutputItem,
  MessageItem,
  ORItem,
  ReasoningItem,
} from "~/lib/openresponses";

export interface ThreadEntry {
  key: string;
  item: ORItem;
  source: "user" | "agent";
  /** Platform item id (present for persisted items). */
  itemDbId?: string;
  streaming?: boolean;
}

/** Merges the persisted transcript with the currently streaming turn. */
export function buildThread(
  detail: ConversationDetail | null | undefined,
  active: ActiveTurn | undefined,
): ThreadEntry[] {
  let serverItems = detail?.items ?? [];

  if (active) {
    if (active.truncateFromItemId) {
      const index = serverItems.findIndex(
        (row) => row.id === active.truncateFromItemId,
      );
      if (index >= 0) serverItems = serverItems.slice(0, index);
    }
    if (active.suppressTurnIds.length > 0) {
      serverItems = serverItems.filter(
        (row) => !row.turnId || !active.suppressTurnIds.includes(row.turnId),
      );
    }
    if (active.turnId) {
      serverItems = serverItems.filter((row) => row.turnId !== active.turnId);
    }
  }

  const entries: ThreadEntry[] = serverItems.map((row) => ({
    key: row.id,
    item: row.payload,
    source: row.source,
    itemDbId: row.id,
  }));

  if (active) {
    if (active.userItems.length > 0) {
      for (const userItem of active.userItems) {
        entries.push({
          key: userItem.id,
          item: userItem.payload,
          source: "user",
          itemDbId: userItem.id,
        });
      }
    } else if (active.optimisticUserItem) {
      entries.push({
        key: "__optimistic__",
        item: active.optimisticUserItem,
        source: "user",
      });
    }
    active.state.items.forEach((item, index) => {
      if (!item) return;
      entries.push({
        key: `__stream_${index}`,
        item,
        source: "agent",
        streaming:
          active.phase !== "finished" &&
          (item as { status?: string }).status !== "completed",
      });
    });
  }

  return entries;
}

export const Thread = memo(function Thread({
  entries,
  active,
  lastTurnError,
  lastTurnCancelled,
  onEditMessage,
  onRegenerate,
  onRetry,
  onDismissError,
  disabled,
}: {
  entries: ThreadEntry[];
  active: ActiveTurn | undefined;
  /** Error of the most recent persisted turn (when no active stream). */
  lastTurnError?: { message: string } | null;
  lastTurnCancelled?: boolean;
  onEditMessage?: (itemDbId: string, newText: string) => void;
  onRegenerate?: () => void;
  onRetry?: () => void;
  onDismissError?: () => void;
  disabled?: boolean;
}) {
  /* Pair function_call items with their outputs. */
  const pairedOutputs = useMemo(() => {
    const map = new Map<string, FunctionCallOutputItem>();
    for (const entry of entries) {
      if (entry.item.type === "function_call_output") {
        const output = entry.item as FunctionCallOutputItem;
        if (output.call_id) map.set(output.call_id, output);
      }
    }
    return map;
  }, [entries]);

  const lastAssistantKey = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry && entry.item.type === "message") {
        const message = entry.item as MessageItem;
        if (message.role === "assistant") return entry.key;
      }
    }
    return null;
  }, [entries]);

  const showThinking =
    active !== undefined &&
    active.phase !== "finished" &&
    active.state.items.filter(Boolean).length === 0;

  const activeError = active?.error ?? null;

  return (
    <Conversation className="scrollbar-thin">
      {/* Extra bottom padding keeps the last message clear of the floating
       * composer, which overlaps the bottom of this scroll area. */}
      <ConversationContent className="mx-auto w-full max-w-3xl px-4 pt-6 pb-40">
        {entries.map((entry) => {
          const { item } = entry;

          if (item.type === "message") {
            const message = item as MessageItem;
            if (message.role === "user") {
              return (
                <UserMessage
                  key={entry.key}
                  item={message}
                  disabled={disabled}
                  onEdit={
                    entry.itemDbId &&
                    onEditMessage &&
                    !entry.key.startsWith("__")
                      ? (newText) =>
                          entry.itemDbId &&
                          onEditMessage(entry.itemDbId, newText)
                      : undefined
                  }
                />
              );
            }
            if (message.role === "assistant") {
              return (
                <AssistantMessage
                  key={entry.key}
                  item={message}
                  streaming={entry.streaming}
                  isLast={entry.key === lastAssistantKey && !active}
                  onRegenerate={onRegenerate}
                />
              );
            }
            return (
              <div
                key={entry.key}
                className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-sm"
              >
                <span className="mr-2 font-mono text-xs uppercase">
                  {message.role}
                </span>
                {typeof message.content === "string" ? message.content : null}
              </div>
            );
          }

          if (item.type === "reasoning") {
            return (
              <ReasoningBlock
                key={entry.key}
                item={item as ReasoningItem}
                streaming={entry.streaming}
              />
            );
          }

          if (item.type === "function_call") {
            const call = item as FunctionCallItem;
            return (
              <ToolCallBlock
                key={entry.key}
                call={call}
                output={pairedOutputs.get(call.call_id) ?? null}
                streaming={entry.streaming}
              />
            );
          }

          if (item.type === "function_call_output") {
            // Rendered inline with its call.
            return <Fragment key={entry.key} />;
          }

          if (item.type === "compaction") {
            return (
              <div
                key={entry.key}
                className="text-center text-muted-foreground text-xs"
              >
                — context compacted —
              </div>
            );
          }

          return <UnknownItemBlock key={entry.key} item={item} />;
        })}

        {showThinking && <ThinkingDot />}

        {activeError && active?.phase === "finished" && (
          <ErrorBanner
            message={activeError.message}
            onRetry={onRetry}
            onDismiss={onDismissError}
          />
        )}

        {!active && lastTurnError && (
          <ErrorBanner message={lastTurnError.message} onRetry={onRetry} />
        )}

        {!active && !lastTurnError && lastTurnCancelled && (
          <div className="text-muted-foreground text-sm">
            Generation stopped.
          </div>
        )}
      </ConversationContent>

      <ConversationScrollButton />
    </Conversation>
  );
});

function ErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex-1">{message}</div>
      <div className="flex shrink-0 gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
