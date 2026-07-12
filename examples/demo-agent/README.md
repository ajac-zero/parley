# Demo agent

This standalone Bun server is Parley's reference Open Responses agent. It is
deliberately deployed as a separate process so demo conversations exercise the
same HTTP and SSE transport as every other agent.

```bash
bun run demo-agent
```

It listens on port `8080` by default. Set `DEMO_AGENT_PORT` to change it.

- `POST /v1/responses` - Open Responses endpoint
- `GET /.well-known/agent-card.json` - A2A agent card
- `GET /health` - process health
