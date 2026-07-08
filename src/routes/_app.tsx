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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
          sidebarOpen ? "w-[268px]" : "w-0 border-r-0",
        )}
      >
        <div className="h-full w-[268px]">
          <AppSidebar config={config} user={session.user} />
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

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Sidebar toggles */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2.5 left-2.5 z-20 hidden text-muted-foreground md:flex"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2.5 left-2.5 z-20 text-muted-foreground md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open sidebar"
        >
          <PanelLeft className="size-5" />
        </Button>

        <Outlet />
      </div>
    </div>
  );
}
