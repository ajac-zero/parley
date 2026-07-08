import { Link } from "@tanstack/react-router";
import { Bot, Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import type { PublicAgent } from "~/server/services/agents";

export function AgentAvatar({
  agent,
  className,
}: {
  agent: Pick<PublicAgent, "avatar" | "name">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[13px]",
        className,
      )}
      aria-hidden="true"
    >
      {agent.avatar?.trim() ? (
        agent.avatar
      ) : (
        <Bot className="size-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

export function AgentPicker({
  agents,
  selectedId,
  onSelect,
  disabled,
}: {
  agents: PublicAgent[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  disabled?: boolean;
}) {
  const selected = agents.find((a) => a.id === selectedId) ?? null;
  const enabled = agents.filter((a) => a.isEnabled);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          className="h-9 gap-1.5 px-2.5 font-medium text-[15px]"
        >
          {selected ? (
            <>
              <AgentAvatar agent={selected} className="size-5 text-xs" />
              <span className="max-w-44 truncate">{selected.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Choose an agent</span>
          )}
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {enabled.length === 0 && (
          <div className="px-3 py-6 text-center text-muted-foreground text-sm">
            No agents available yet.
          </div>
        )}
        {enabled.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            className="items-start gap-2.5 py-2.5"
            onClick={() => onSelect(agent.id)}
          >
            <AgentAvatar agent={agent} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{agent.name}</span>
                {agent.isGlobal && (
                  <span className="rounded-full border px-1.5 py-px text-[10px] text-muted-foreground uppercase tracking-wide">
                    shared
                  </span>
                )}
              </span>
              {agent.description && (
                <span className="mt-0.5 line-clamp-2 block text-muted-foreground text-xs">
                  {agent.description}
                </span>
              )}
            </span>
            {agent.id === selectedId && (
              <Check className="mt-1 size-4 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/agents">
            <Plus className="size-4" /> Add an agent
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
