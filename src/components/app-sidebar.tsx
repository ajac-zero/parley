import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  Bot,
  Check,
  LogOut,
  MessageSquarePlus,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Search,
  Settings,
  Shield,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "~/components/theme";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { AppConfig } from "~/functions/config";
import {
  deleteConversation,
  renameConversation,
} from "~/functions/conversations";
import { authClient } from "~/lib/auth-client";
import { chatStore } from "~/lib/chat-store";
import { conversationsQuery } from "~/lib/queries";
import { cn } from "~/lib/utils";

interface SessionUserLike {
  id: string;
  name: string;
  email: string;
  role: string;
}

function groupLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.floor(
    (startOfDay(now) - startOfDay(date)) / 86_400_000,
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  if (diffDays < 30) return "Previous 30 days";
  return "Older";
}

const GROUP_ORDER = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
];

export function AppSidebar({
  config,
  user,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  config: AppConfig;
  user: SessionUserLike;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [search, setSearch] = useState("");
  const { data: conversations } = useQuery(conversationsQuery());
  const params = useParams({ strict: false }) as { conversationId?: string };
  const activeId = params.conversationId;

  const groups = useMemo(() => {
    const filtered = (conversations ?? []).filter((c) =>
      c.title.toLowerCase().includes(search.toLowerCase()),
    );
    const map = new Map<string, typeof filtered>();
    for (const conversation of filtered) {
      const label = groupLabel(conversation.updatedAt);
      const list = map.get(label) ?? [];
      list.push(conversation);
      map.set(label, list);
    }
    return GROUP_ORDER.flatMap((label) => {
      const list = map.get(label);
      return list ? [{ label, list }] : [];
    });
  }, [conversations, search]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
        {/* Header */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-1">
          <SidebarLogoToggle
            config={config}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onToggleCollapse={onToggleCollapse}
          />
          {onToggleCollapse && (
            <div
              className={cn(
                "shrink-0 overflow-hidden transition-[max-width,opacity] duration-200",
                collapsed ? "max-w-0 opacity-0" : "max-w-10 opacity-100",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent"
                    onClick={onToggleCollapse}
                    aria-label="Collapse sidebar"
                    tabIndex={collapsed ? -1 : 0}
                  >
                    <PanelLeft className="size-4.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Collapse sidebar</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-0.5 px-3 py-2">
          <SidebarNavItem
            to="/chat"
            icon={<MessageSquarePlus className="size-4.5 shrink-0" />}
            label="New chat"
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          <SidebarNavItem
            to="/agents"
            icon={<Bot className="size-4.5 shrink-0" />}
            label="Agents"
            collapsed={collapsed}
            onNavigate={onNavigate}
            activeProps={{ className: "bg-sidebar-accent" }}
          />
        </div>

        {/* Search */}
        <div
          className={cn(
            "overflow-hidden px-3 transition-[max-height,opacity] duration-200",
            collapsed ? "max-h-0 opacity-0" : "max-h-12 pb-2 opacity-100",
          )}
        >
          <div className="relative">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="h-8 border-transparent bg-sidebar-accent/60 pl-8 text-sm focus-visible:border-input focus-visible:bg-background"
            />
          </div>
        </div>

        {/* Conversations */}
        <div
          className={cn(
            "flex-1 overflow-hidden transition-opacity duration-200",
            collapsed && "pointer-events-none opacity-0",
          )}
        >
          <nav className="h-full overflow-y-auto px-3 pb-2 scrollbar-thin">
            {groups.length === 0 && (
              <p className="px-2 py-6 text-center text-muted-foreground text-sm">
                {search ? "No chats match your search." : "No chats yet."}
              </p>
            )}
            {groups.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                  {group.label}
                </div>
                <ul className="space-y-px">
                  {group.list.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      id={conversation.id}
                      title={conversation.title}
                      active={conversation.id === activeId}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* User footer */}
        <div className="border-sidebar-border border-t p-3">
          <UserMenu user={user} onNavigate={onNavigate} collapsed={collapsed} />
        </div>
      </div>
    </TooltipProvider>
  );
}

function SidebarNavItem({
  to,
  icon,
  label,
  collapsed,
  onNavigate,
  activeProps,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  onNavigate?: () => void;
  activeProps?: { className: string };
}) {
  const content = (
    <Link
      to={to}
      onClick={onNavigate}
      activeProps={activeProps}
      className={cn(
        "flex items-center overflow-hidden rounded-lg text-sm transition-colors hover:bg-sidebar-accent",
        collapsed ? "size-9 shrink-0 justify-center" : "gap-2.5 px-2 py-2",
      )}
      aria-label={label}
    >
      {icon}
      <span
        className={cn(
          "truncate transition-[max-width,opacity] duration-200",
          collapsed ? "max-w-0 opacity-0" : "max-w-[200px] opacity-100",
        )}
      >
        {label}
      </span>
    </Link>
  );

  if (!collapsed) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarLogoToggle({
  config,
  collapsed,
  onNavigate,
  onToggleCollapse,
}: {
  config: AppConfig;
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
}) {
  const content = (
    <Link
      to="/chat"
      onClick={(e) => {
        if (collapsed && onToggleCollapse) {
          e.preventDefault();
          onToggleCollapse();
        } else {
          onNavigate?.();
        }
      }}
      className={cn(
        "group flex items-center overflow-hidden rounded-lg transition-colors hover:bg-sidebar-accent",
        collapsed
          ? "size-9 shrink-0 justify-center"
          : "min-w-0 flex-1 gap-2 py-1.5 pl-2",
      )}
      aria-label={collapsed ? "Expand sidebar" : config.appName}
    >
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <span
          className={cn(
            "flex items-center justify-center transition-opacity",
            collapsed && "group-hover:opacity-0",
          )}
        >
          {config.appLogoUrl ? (
            <img
              src={config.appLogoUrl}
              alt=""
              className="size-6 rounded-md object-contain"
            />
          ) : (
            <ParleyMark className="size-6" />
          )}
        </span>
        {collapsed && (
          <PanelLeft className="absolute inset-0 m-auto size-4.5 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </span>
      <span
        className={cn(
          "truncate font-semibold text-[15px] transition-[max-width,opacity] duration-200",
          collapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100",
        )}
      >
        {config.appName}
      </span>
    </Link>
  );

  if (!collapsed) return content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">Expand sidebar</TooltipContent>
    </Tooltip>
  );
}

function ConversationRow({
  id,
  title,
  active,
  onNavigate,
}: {
  id: string;
  title: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);

  const renameMutation = useMutation({
    mutationFn: (newTitle: string) =>
      renameConversation({ data: { conversationId: id, title: newTitle } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["conversation", id] });
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteConversation({ data: { conversationId: id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      chatStore.remove(id);
      if (active) navigate({ to: "/chat" });
    },
    onError: (error) => toast.error(error.message),
  });

  if (renaming) {
    return (
      <li className="flex items-center gap-1 px-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              renameMutation.mutate(draft.trim());
              setRenaming(false);
            }
            if (e.key === "Escape") setRenaming(false);
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => {
            if (draft.trim()) renameMutation.mutate(draft.trim());
            setRenaming(false);
          }}
          aria-label="Save name"
        >
          <Check className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => setRenaming(false)}
          aria-label="Cancel rename"
        >
          <X className="size-3.5" />
        </Button>
      </li>
    );
  }

  return (
    <li className="group/row relative">
      <Link
        to="/chat/$conversationId"
        params={{ conversationId: id }}
        onClick={onNavigate}
        className={cn(
          "block truncate rounded-lg px-2 py-2 pr-8 text-sm transition-colors hover:bg-sidebar-accent",
          active && "bg-sidebar-accent",
        )}
      >
        {title}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "-translate-y-1/2 absolute top-1/2 right-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground focus:opacity-100 group-hover/row:opacity-100",
              active && "opacity-100",
            )}
            aria-label="Chat options"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem
            onClick={() => {
              setDraft(title);
              setRenaming(true);
            }}
          >
            <Pencil className="size-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
          >
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function UserMenu({
  user,
  onNavigate,
  collapsed = false,
}: {
  user: SessionUserLike;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const trigger = (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
      aria-label={user.name}
    >
      <Avatar className="size-7 shrink-0">
        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
          {initials || "?"}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "min-w-0 transition-[max-width,opacity] duration-200",
          collapsed ? "max-w-0 opacity-0" : "max-w-[180px] flex-1 opacity-100",
        )}
      >
        <span className="block truncate font-medium text-sm">{user.name}</span>
        <span className="block truncate text-muted-foreground text-xs">
          {user.email}
        </span>
      </span>
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{user.name}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={collapsed ? "right" : "top"}
        className="w-56"
      >
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Theme
        </DropdownMenuLabel>
        <div className="flex gap-1 px-2 pb-1.5">
          {(
            [
              ["light", Sun],
              ["dark", Moon],
              ["system", Monitor],
            ] as const
          ).map(([value, Icon]) => (
            <Button
              key={value}
              variant={preference === value ? "secondary" : "ghost"}
              size="icon"
              className="size-8 flex-1"
              onClick={() => setPreference(value)}
              aria-label={`${value} theme`}
            >
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            onNavigate?.();
            navigate({ to: "/settings" });
          }}
        >
          <Settings className="size-4" /> Settings
        </DropdownMenuItem>
        {user.role === "admin" && (
          <DropdownMenuItem
            onClick={() => {
              onNavigate?.();
              navigate({ to: "/admin" });
            }}
          >
            <Shield className="size-4" /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/auth/sign-in";
          }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ParleyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M10 21.5V12a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-5.5L10 21.5Z"
        className="stroke-primary-foreground"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="13.5" r="1" className="fill-primary-foreground" />
      <circle cx="18" cy="13.5" r="1" className="fill-primary-foreground" />
    </svg>
  );
}
