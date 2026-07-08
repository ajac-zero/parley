import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { currentSession, runApp } from "~/functions/context";
import { appEnv } from "~/server/env";
import { Settings } from "~/server/services/settings";

/**
 * Public app config + the current session, loaded once in the root route.
 */
export const getAppContext = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = await currentSession();
    const settings = await runApp(Effect.flatMap(Settings, (s) => s.get));
    return {
      config: {
        appName: settings.appName,
        appTagline: settings.appTagline,
        appLogoUrl: settings.appLogoUrl,
        customCss: settings.customCss,
        chatDisclaimer: settings.chatDisclaimer,
        registrationEnabled: settings.registrationEnabled,
        allowUserAgents: settings.allowUserAgents,
        defaultAgentId: settings.defaultAgentId,
        fileMaxMb: appEnv.fileMaxMb,
      },
      session,
    };
  },
);

export type AppContext = Awaited<ReturnType<typeof getAppContext>>;
export type AppConfig = AppContext["config"];
