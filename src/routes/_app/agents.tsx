import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Globe, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AgentAvatar } from "~/components/agent-picker";
import { AgentDialog } from "~/components/agents/agent-dialog";
import { Button } from "~/components/ui/button";
import { deleteAgent } from "~/functions/agents";
import { agentsQuery } from "~/lib/queries";
import type { PublicAgent } from "~/server/services/agents";

export const Route = createFileRoute("/_app/agents")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(agentsQuery());
  },
  component: AgentsPage,
});

function AgentsPage() {
  const { config, session } = Route.useRouteContext();
  const isAdmin = session?.isAdmin ?? false;
  const userId = session?.user.id;
  const { data: agents = [] } = useQuery(agentsQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PublicAgent | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAgent({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Agent deleted.");
    },
    onError: (error) => toast.error(error.message),
  });

  const canEdit = (agent: PublicAgent) =>
    agent.ownerId === userId || (agent.isGlobal && isAdmin);

  const startChat = (agent: PublicAgent) => {
    window.localStorage.setItem("parley-last-agent", agent.id);
    navigate({ to: "/chat" });
  };

  const canCreate = isAdmin || config.allowUserAgents;

  return (
    <main className="h-full flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-3xl px-4 pt-16 pb-16 md:px-6">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-semibold text-2xl tracking-tight">Agents</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Connect endpoints that speak the Open Responses protocol and chat
              with them.
            </p>
          </div>
          {canCreate && (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" /> Add agent
            </Button>
          )}
        </div>

        {agents.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-16 text-center">
            <p className="font-medium">No agents yet</p>
            <p className="mt-1 text-muted-foreground text-sm">
              Add your first Open Responses endpoint to start chatting.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="flex items-start gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-ring/40"
              >
                <AgentAvatar agent={agent} className="mt-0.5 size-10 text-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{agent.name}</span>
                    {agent.isGlobal && (
                      <span className="flex items-center gap-1 rounded-full border px-2 py-px text-muted-foreground text-xs">
                        <Globe className="size-3" /> shared
                      </span>
                    )}
                    {!agent.isEnabled && (
                      <span className="rounded-full border border-destructive/40 px-2 py-px text-destructive text-xs">
                        disabled
                      </span>
                    )}
                  </div>
                  {agent.description && (
                    <p className="mt-0.5 line-clamp-2 text-muted-foreground text-sm">
                      {agent.description}
                    </p>
                  )}
                  <p className="mt-1.5 truncate font-mono text-muted-foreground text-xs">
                    {agent.baseUrl}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startChat(agent)}
                    disabled={!agent.isEnabled}
                    aria-label={`Chat with ${agent.name}`}
                  >
                    <MessageSquare className="size-4" />
                  </Button>
                  {canEdit(agent) && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditing(agent);
                          setDialogOpen(true);
                        }}
                        aria-label={`Edit ${agent.name}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete "${agent.name}"? Conversations with it are kept but can no longer continue.`,
                            )
                          ) {
                            deleteMutation.mutate(agent.id);
                          }
                        }}
                        aria-label={`Delete ${agent.name}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AgentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agent={editing}
        isAdmin={isAdmin}
        allowUserAgents={config.allowUserAgents}
      />
    </main>
  );
}
