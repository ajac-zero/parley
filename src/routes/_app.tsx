import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { AppSidebar } from "~/components/app-sidebar";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { chatStore } from "~/lib/chat-store";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.href },
      });
    }
    return { session: context.session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { config, session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  /* Wire the chat store to the query cache. */
  useEffect(() => {
    chatStore.handlers = {
      onConversationUpdated: () => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      },
      onTurnStarted: (conversationId) => {
        queryClient.invalidateQueries({
          queryKey: ["conversation", conversationId],
        });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      },
      onTurnFinished: async (conversationId) => {
        await queryClient.invalidateQueries({
          queryKey: ["conversation", conversationId],
        });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      },
    };
    return () => {
      chatStore.handlers = {};
    };
  }, [queryClient]);

  if (!session) return null;

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden shrink-0 overflow-hidden border-sidebar-border border-r transition-[width] duration-200 md:block",
          sidebarCollapsed ? "w-16" : "w-[268px]",
        )}
      >
        <div className="h-full w-full">
          <AppSidebar
            config={config}
            user={session.user}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          />
        </div>
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[290px] p-0 md:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <AppSidebar
            config={config}
            user={session.user}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-2 border-sidebar-border border-b px-2 py-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => setMobileOpen(true)}
            aria-label="Open sidebar"
          >
            <PanelLeft className="size-5" />
          </Button>
          <span className="truncate font-semibold text-[15px]">
            {config.appName}
          </span>
        </div>

        <Outlet />
      </div>
    </div>
  );
}
