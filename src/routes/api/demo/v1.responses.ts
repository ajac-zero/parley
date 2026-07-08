import { createFileRoute } from "@tanstack/react-router";
import { ensureBoot } from "~/server/boot";
import { handleDemoResponses } from "~/server/demo-agent";
import { appEnv } from "~/server/env";
import { jsonError } from "~/server/http";

export const Route = createFileRoute("/api/demo/v1/responses")({
  server: {
    handlers: {
      /** The built-in demo agent's Open Responses endpoint. */
      POST: async ({ request }) => {
        await ensureBoot();
        if (!appEnv.demoAgent) {
          return jsonError(404, "The demo agent is disabled.", "not_found");
        }
        return handleDemoResponses(request);
      },
    },
  },
});
