import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { A2uiCanvas, type A2uiCanvasItem } from "~/components/a2ui/canvas";
import {
  A2uiHostContext,
  type A2uiHostContextValue,
} from "~/components/a2ui/context";
import { AgentAvatar } from "~/components/agent-picker";
import { Composer } from "~/components/chat/composer";
import { buildThread, Thread } from "~/components/chat/thread";
import { Button } from "~/components/ui/button";
import { useActiveTurn } from "~/hooks/use-active-turn";
import { useElementHeight } from "~/hooks/use-element-size";
import { useMediaQuery } from "~/hooks/use-media-query";
import { usePinnedSurfaces } from "~/hooks/use-pinned-surfaces";
import { type A2uiOutputRef, reduceA2uiOutputs } from "~/lib/a2ui";
import { chatStore } from "~/lib/chat-store";
import type {
  FunctionCallItem,
  FunctionCallOutputItem,
} from "~/lib/openresponses";
import { conversationQuery } from "~/lib/queries";

export const Route = createFileRoute("/_app/chat/$conversationId")({
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(
      conversationQuery(params.conversationId),
    );
    if (!detail) throw notFound();
  },
  component: ConversationPage,
  notFoundComponent: () => (
    <main className="flex h-full flex-1 flex-col items-center justify-center gap-3">
      <p className="text-muted-foreground">This conversation doesn't exist.</p>
      <Button asChild variant="outline">
        <Link to="/chat">Start a new chat</Link>
      </Button>
    </main>
  ),
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const { config } = Route.useRouteContext();
  const { data: detail } = useQuery(conversationQuery(conversationId));
  const active = useActiveTurn(conversationId);

  /* Re-attach to a turn still running server-side (e.g. after refresh). */
  useEffect(() => {
    if (detail?.activeTurnId && !chatStore.isActive(conversationId)) {
      chatStore.resume(conversationId, detail.activeTurnId);
    }
  }, [detail?.activeTurnId, conversationId]);

  const entries = useMemo(() => buildThread(detail, active), [detail, active]);

  const busy = active !== undefined && active.phase !== "finished";

  /* A2UI surfaces are conversation-wide state: reduce every tool output in
   * order so a later result can update or delete a surface created by an
   * earlier call. Computed here (not in Thread) because placement is host
   * policy — the same map drives both inline anchors and the pinned
   * side canvas. */
  const a2uiByCall = useMemo(() => {
    const outputs: A2uiOutputRef[] = [];
    for (const entry of entries) {
      if (entry.item.type === "function_call_output") {
        const output = entry.item as FunctionCallOutputItem;
        if (output.call_id) {
          outputs.push({ callId: output.call_id, output: output.output });
        }
      }
    }
    return reduceA2uiOutputs(outputs);
  }, [entries]);

  /* Pinning: a client-side gesture persisted per conversation. The canvas
   * pane needs room, so on narrow viewports pins are dormant (surfaces
   * render inline and the pin affordance is hidden) without being lost. */
  const { pinned, togglePin } = usePinnedSurfaces(conversationId);
  const canvasAvailable = useMediaQuery("(min-width: 64rem)");
  const pinnedSet = useMemo(
    () => new Set(canvasAvailable ? pinned : []),
    [canvasAvailable, pinned],
  );

  const canvasItems = useMemo(() => {
    const callNames = new Map<string, string>();
    for (const entry of entries) {
      if (entry.item.type === "function_call") {
        const call = entry.item as FunctionCallItem;
        if (call.call_id) callNames.set(call.call_id, call.name);
      }
    }
    const items: A2uiCanvasItem[] = [];
    for (const [callId, group] of a2uiByCall) {
      for (const surface of group.surfaces) {
        if (surface.supported && pinnedSet.has(surface.surfaceId)) {
          items.push({
            surface,
            title: callNames.get(callId) ?? surface.surfaceId,
          });
        }
      }
    }
    return items;
  }, [a2uiByCall, entries, pinnedSet]);

  const a2uiHost = useMemo<A2uiHostContextValue>(
    () => ({
      stateScope: conversationId,
      pinnedSurfaceIds: pinnedSet,
      togglePin: canvasAvailable ? togglePin : null,
    }),
    [conversationId, pinnedSet, togglePin, canvasAvailable],
  );

  /* Status of the last persisted turn (for error/cancel notes). */
  const lastTurn = detail?.turns[detail.turns.length - 1];
  const lastTurnError =
    !busy && lastTurn?.status === "failed"
      ? (lastTurn.error ?? { message: "The agent failed to respond." })
      : null;
  const lastTurnCancelled = !busy && lastTurn?.status === "cancelled";

  const send = (text: string, fileIds: string[]) => {
    chatStore.send({ conversationId, text, fileIds });
  };

  const regenerate = () => {
    if (busy) return;
    chatStore.send({
      conversationId,
      text: "",
      regenerate: true,
      suppressTurnIds: lastTurn ? [lastTurn.id] : [],
    });
  };

  const editMessage = (itemDbId: string, newText: string) => {
    if (busy) return;
    chatStore.send({
      conversationId,
      text: newText,
      editFromItemId: itemDbId,
    });
  };

  /* Routes an A2UI action from a rendered tool surface back through the
   * agent: the summary is the text fallback, the messages ride along as a
   * typed content part. */
  const sendA2uiAction = (payload: {
    messages: Array<Record<string, unknown>>;
    summary: string;
  }) => {
    if (busy) return;
    chatStore.send({
      conversationId,
      text: payload.summary,
      a2ui: payload.messages,
    });
  };

  const agent = detail?.agent ?? null;

  const { ref: composerOverlayRef, height: composerHeight } =
    useElementHeight<HTMLDivElement>();
  const { ref: composerCardRef, height: composerCardHeight } =
    useElementHeight<HTMLDivElement>();

  return (
    <A2uiHostContext.Provider value={a2uiHost}>
      <main className="flex h-full min-w-0 flex-1">
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <Thread
            entries={entries}
            active={active}
            lastTurnError={lastTurnError}
            lastTurnCancelled={lastTurnCancelled ?? false}
            onEditMessage={editMessage}
            onRegenerate={regenerate}
            onRetry={regenerate}
            onDismissError={() => chatStore.remove(conversationId)}
            a2uiByCall={a2uiByCall}
            onA2uiAction={sendA2uiAction}
            disabled={busy}
            composerHeight={composerHeight}
            composerCardHeight={composerCardHeight}
          />

          {/* Floats over the top of the thread with no backdrop at all — the
           * agent name/icon just float directly over the thread, which stays
           * fully visible and sharp scrolling underneath, instead of being
           * hidden or blurred behind anything. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
            <header className="pointer-events-auto flex h-13 items-center gap-2 px-14 md:px-12">
              {agent ? (
                <div className="flex min-w-0 items-center gap-2">
                  <AgentAvatar agent={agent} className="size-5 text-xs" />
                  <span className="truncate font-medium text-[15px]">
                    {agent.name}
                  </span>
                  {!agent.isEnabled && (
                    <span className="rounded-full border px-2 py-px text-muted-foreground text-xs">
                      disabled
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground text-sm">
                  Agent unavailable
                </span>
              )}
            </header>
          </div>

          {/* Floats over the bottom of the thread. No fade — messages stay
           * fully sharp until they're covered by this overlay. Its own solid
           * background spans its *whole* box (not just a rectangle behind
           * the input card), so it also plugs the notch beside the card's
           * rounded corners and covers the disclaimer text underneath the
           * card — both of which sit over otherwise-transparent space and
           * would let content bleed through if only the card's own opaque
           * background were relied on. Stops short of the scroll area's
           * right edge so the scrollbar stays visible, instead of being
           * painted over by this overlay. Its measured height feeds back
           * into the thread's bottom padding above, so the last message
           * always clears it regardless of composer size. */}
          <div
            ref={composerOverlayRef}
            className="pointer-events-none absolute right-2.5 bottom-0 left-0 z-10 flex justify-center bg-background px-4 pb-2"
          >
            <div
              ref={composerCardRef}
              className="pointer-events-auto w-full max-w-3xl"
            >
              <Composer
                onSend={send}
                onStop={() => chatStore.cancel(conversationId)}
                busy={busy}
                disabled={!agent?.isEnabled}
                placeholder={
                  agent ? `Message ${agent.name}…` : "Agent unavailable"
                }
                supportsAttachments={
                  agent?.supportsImages || agent?.supportsFiles
                }
                disclaimer={config.chatDisclaimer}
                fileMaxMb={config.fileMaxMb}
              />
            </div>
          </div>
        </div>

        {canvasItems.length > 0 && (
          <A2uiCanvas
            items={canvasItems}
            onAction={sendA2uiAction}
            onUnpin={togglePin}
            disabled={busy}
          />
        )}
      </main>
    </A2uiHostContext.Provider>
  );
}
