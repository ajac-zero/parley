import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AgentPicker } from "~/components/agent-picker";
import { Composer } from "~/components/chat/composer";
import { buildThread, Thread } from "~/components/chat/thread";
import { useActiveTurn } from "~/hooks/use-active-turn";
import { useElementHeight } from "~/hooks/use-element-size";
import { chatStore, NEW_CHAT_KEY } from "~/lib/chat-store";
import { agentsQuery } from "~/lib/queries";

export const Route = createFileRoute("/_app/chat/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(agentsQuery());
  },
  component: NewChatPage,
});

const LAST_AGENT_KEY = "parley-last-agent";

function NewChatPage() {
  const { config, session } = Route.useRouteContext();
  const navigate = useNavigate();
  const { data: agents = [] } = useQuery(agentsQuery());
  const active = useActiveTurn(NEW_CHAT_KEY);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  /* Pick a sensible default agent: last used → deployment default → first. */
  useEffect(() => {
    if (selectedAgentId && agents.some((a) => a.id === selectedAgentId)) return;
    const enabled = agents.filter((a) => a.isEnabled);
    const last =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_AGENT_KEY)
        : null;
    const candidate =
      (last && enabled.find((a) => a.id === last)) ||
      (config.defaultAgentId &&
        enabled.find((a) => a.id === config.defaultAgentId)) ||
      enabled[0];
    if (candidate) setSelectedAgentId(candidate.id);
  }, [agents, config.defaultAgentId, selectedAgentId]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const handleSend = (text: string, fileIds: string[]) => {
    if (!selectedAgentId) return;
    window.localStorage.setItem(LAST_AGENT_KEY, selectedAgentId);
    chatStore.send({
      agentId: selectedAgentId,
      text,
      fileIds,
      onConversationCreated: (conversationId) => {
        navigate({
          to: "/chat/$conversationId",
          params: { conversationId },
        });
      },
    });
  };

  const thread = buildThread(null, active);
  const busy = active !== undefined && active.phase !== "finished";

  const { ref: composerOverlayRef, height: composerHeight } =
    useElementHeight<HTMLDivElement>();
  const { ref: composerCardRef, height: composerCardHeight } =
    useElementHeight<HTMLDivElement>();

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col">
      {active ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Thread
            entries={thread}
            active={active}
            onRetry={() => chatStore.remove(NEW_CHAT_KEY)}
            onDismissError={() => chatStore.remove(NEW_CHAT_KEY)}
            composerHeight={composerHeight}
            composerCardHeight={composerCardHeight}
          />

          {/* Floats over the top of the thread with no backdrop at all —
           * the agent picker just floats directly over the thread, which
           * stays fully visible and sharp scrolling underneath, instead of
           * being hidden or blurred behind anything. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
            <header className="pointer-events-auto flex h-13 items-center gap-1 px-14 md:px-12">
              <AgentPicker
                agents={agents}
                selectedId={selectedAgentId}
                onSelect={setSelectedAgentId}
                disabled={busy}
              />
            </header>
          </div>

          {/* Floats over the bottom of the thread. No fade — messages stay
           * fully sharp until they're covered by this overlay. Its own
           * solid background spans its *whole* box (not just a rectangle
           * behind the input card), so it also plugs the notch beside the
           * card's rounded corners and covers the disclaimer text
           * underneath the card — both of which sit over otherwise-
           * transparent space and would let content bleed through if only
           * the card's own opaque background were relied on. Stops short
           * of the scroll area's right edge so the scrollbar stays
           * visible, instead of being painted over by this overlay. Its
           * measured height feeds back into the thread's bottom padding
           * above, so the last message always clears it regardless of
           * composer size. */}
          <div
            ref={composerOverlayRef}
            className="pointer-events-none absolute right-2.5 bottom-0 left-0 z-10 flex justify-center bg-background px-4 pb-2"
          >
            <div
              ref={composerCardRef}
              className="pointer-events-auto w-full max-w-3xl"
            >
              <Composer
                onSend={handleSend}
                onStop={() => chatStore.cancel(NEW_CHAT_KEY)}
                busy={busy}
                disclaimer={config.chatDisclaimer}
                supportsAttachments={
                  selectedAgent?.supportsImages || selectedAgent?.supportsFiles
                }
                fileMaxMb={config.fileMaxMb}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* No active thread yet: still show the picker header (not
           * floating — there's no scrollable content underneath it to
           * fade). */}
          <header className="flex h-13 shrink-0 items-center gap-1 px-14 md:px-12">
            <AgentPicker
              agents={agents}
              selectedId={selectedAgentId}
              onSelect={setSelectedAgentId}
              disabled={busy}
            />
          </header>
          <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
            <div className="w-full max-w-3xl">
              <h1 className="mb-8 text-center font-medium text-[28px] text-foreground/90 tracking-tight">
                {greeting(session?.user.name)}
              </h1>
              <Composer
                onSend={handleSend}
                busy={false}
                disabled={!selectedAgentId}
                placeholder={
                  selectedAgent
                    ? `Message ${selectedAgent.name}…`
                    : "Add an agent to start chatting"
                }
                disclaimer={config.chatDisclaimer}
                supportsAttachments={
                  selectedAgent?.supportsImages || selectedAgent?.supportsFiles
                }
                fileMaxMb={config.fileMaxMb}
                autoFocus
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function greeting(name?: string): string {
  const hour = new Date().getHours();
  const timeOfDay =
    hour < 5
      ? "night owl"
      : hour < 12
        ? "morning"
        : hour < 18
          ? "afternoon"
          : "evening";
  const first = name?.split(/\s+/)[0];
  if (timeOfDay === "night owl") return `Hello${first ? `, ${first}` : ""} 🌙`;
  return `Good ${timeOfDay}${first ? `, ${first}` : ""}`;
}
