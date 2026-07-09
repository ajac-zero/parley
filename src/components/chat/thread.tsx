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

/**
 * Fallback bottom padding used before the floating composer's real height
 * has been measured (e.g. on first render/SSR). Roughly matches a
 * single-line composer plus its gradient scrim, so there's no visible pop
 * once the real measurement lands.
 */
const DEFAULT_COMPOSER_INSET = 160;

/** Breathing room between the last message and the top of the composer's
 * gradient scrim, on top of its measured height. */
const COMPOSER_INSET_GAP = 16;

/**
 * Fallback height for the composer's own card (not the full overlay, which
 * also includes its transparent top fade) — used to float the
 * scroll-to-bottom button just above the input itself, matching the same
 * relationship it had pre-overlay (`bottom-4`-ish gap above the composer).
 */
const DEFAULT_COMPOSER_CARD_HEIGHT = 56;

/** Gap between the scroll-to-bottom button and the top of the composer
 * card underneath it. */
const SCROLL_BUTTON_GAP = 16;

/**
 * Top padding so messages clear the floating header overlay (mirrors the
 * composer's bottom inset). The header's height (`h-13`, 52px) is fixed —
 * unlike the composer, it never grows with content — so this can be a
 * plain constant rather than something measured: 52px header + 24px
 * breathing room, matching the original `pt-6` gap used before the header
 * became a floating overlay.
 */
const HEADER_INSET = 52 + 24;

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
  composerHeight,
  composerCardHeight,
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
  /**
   * Measured height (px) of the floating composer overlay that sits on top
   * of this thread, so the scroll area's bottom padding can track it
   * precisely instead of guessing at a fixed value. Falls back to
   * `DEFAULT_COMPOSER_INSET` when not yet measured.
   */
  composerHeight?: number;
  /**
   * Measured height (px) of just the composer's visible card, excluding the
   * overlay's transparent top fade — used to position the scroll-to-bottom
   * button snug above the input rather than above the whole gradient
   * region. Falls back to `DEFAULT_COMPOSER_CARD_HEIGHT` when not yet
   * measured.
   */
  composerCardHeight?: number;
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
      {/* Top padding clears the floating header overlay (fixed height, see
       * `HEADER_INSET`); bottom padding tracks the floating composer's
       * measured height (see `composerHeight`) so the last message always
       * clears it, even as the composer grows with attachments or a
       * multi-line draft. */}
      <ConversationContent
        className="mx-auto w-full max-w-3xl px-4"
        style={{
          paddingTop: HEADER_INSET,
          paddingBottom:
            (composerHeight ?? DEFAULT_COMPOSER_INSET) + COMPOSER_INSET_GAP,
        }}
      >
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

      {/* Offset to clear the floating composer overlay (z-20 vs its z-10),
       * otherwise this button renders hidden and unclickable underneath it.
       * Uses the composer *card's* height (not the full overlay, which
       * includes a large transparent top fade) so the button sits snug
       * above the input instead of floating oddly high above it. */}
      <ConversationScrollButton
        bottomOffset={
          (composerCardHeight ?? DEFAULT_COMPOSER_CARD_HEIGHT) +
          SCROLL_BUTTON_GAP
        }
      />
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
