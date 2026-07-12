import { handleDemoResponses } from "./agent";

const port = Number.parseInt(process.env.DEMO_AGENT_PORT ?? "8080", 10);

export function startDemoAgentServer(options: { port?: number } = {}) {
  return Bun.serve({
    port: options.port ?? port,
    idleTimeout: 240,
    fetch(request) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      if (
        request.method === "GET" &&
        url.pathname === "/.well-known/agent-card.json"
      ) {
        const baseUrl = `${url.protocol}//${url.host}`;
        return Response.json({
          name: "Demo Agent",
          description:
            "A reference agent showcasing Open Responses streaming, reasoning, tool calls, attachments, and generative UI.",
          version: "1.0.0",
          capabilities: { streaming: true },
          defaultInputModes: ["text/plain", "image/*", "application/octet-stream"],
          defaultOutputModes: ["text/plain", "application/a2ui+json"],
          skills: [],
          supportedInterfaces: [
            {
              url: `${baseUrl}/v1`,
              protocolBinding: "https://openresponses.org/v1",
              protocolVersion: "1.0",
            },
          ],
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/responses") {
        return handleDemoResponses(request);
      }

      return Response.json(
        { error: { message: "Not found", code: "not_found" } },
        { status: 404 },
      );
    },
  });
}

if (import.meta.main) {
  const server = startDemoAgentServer();
  console.log(`[demo-agent] listening on http://localhost:${server.port}`);
}
