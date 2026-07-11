import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ShowReasoningProvider } from "~/components/reasoning-preference";
import { ThemeProvider } from "~/components/theme";
import { Toaster } from "~/components/ui/sonner";
import { getAppContext } from "~/functions/config";
import appCss from "~/styles/app.css?url";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const appContext = await getAppContext();
    return appContext;
  },
  head: ({ match }) => {
    const config = (
      match.context as unknown as {
        config?: { appName?: string; appTagline?: string | null };
      }
    ).config;
    const appName = config?.appName ?? "Parley";
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: appName },
        {
          name: "description",
          content:
            config?.appTagline ??
            "The open, self-hostable platform for chatting with your Open Responses agents.",
        },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      ],
    };
  },
  component: RootComponent,
});

const themeInitScript = `(function(){try{var t=localStorage.getItem("parley-theme");var d=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;

function RootComponent() {
  const { config } = Route.useRouteContext();
  return (
    <RootDocument customCss={config.customCss}>
      <ThemeProvider>
        <ShowReasoningProvider>
          <Outlet />
          <Toaster position="top-center" />
        </ShowReasoningProvider>
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({
  children,
  customCss,
}: Readonly<{ children: ReactNode; customCss: string | null }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap script */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
        {customCss ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: admin-provided theme CSS
          <style dangerouslySetInnerHTML={{ __html: customCss }} />
        ) : null}
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
