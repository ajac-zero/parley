import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AgentAvatar } from "~/components/agent-picker";
import { Composer } from "~/components/chat/composer";
import { buildThread, Thread } from "~/components/chat/thread";
import { Button } from "~/components/ui/button";
import { useActiveTurn } from "~/hooks/use-active-turn";
import { chatStore } from "~/lib/chat-store";
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

  const agent = detail?.agent ?? null;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-2 px-14 md:px-12">
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

      <div className="relative flex min-h-0 flex-1 flex-col">
        <Thread
          entries={entries}
          active={active}
          lastTurnError={lastTurnError}
          lastTurnCancelled={lastTurnCancelled ?? false}
          onEditMessage={editMessage}
          onRegenerate={regenerate}
          onRetry={regenerate}
          onDismissError={() => chatStore.remove(conversationId)}
          disabled={busy}
        />

        {/* Floats over the bottom of the thread; the gradient scrim fades
         * messages into the page background as they scroll underneath it,
         * so the composer's rounded card reads cleanly on top. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-10 pb-2">
          <div className="pointer-events-auto w-full max-w-3xl">
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
    </main>
  );
}
