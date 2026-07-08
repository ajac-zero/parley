# Parley

**A self-hostable chat platform for your agents.**

Parley gives any agent that speaks the
[Open Responses](https://www.openresponses.org) protocol a polished,
ChatGPT-style web app: streaming chat with reasoning and tool-call rendering,
image and file attachments, multi-user auth, and an admin panel — all in a
single small container you run yourself.

|                       |                                                                       |
| --------------------- | --------------------------------------------------------------------- |
| **Bring any agent**   | Point Parley at any `/v1/responses`-compatible endpoint and chat      |
| **True streaming**    | Token deltas, reasoning summaries, and tool calls render live         |
| **Lossless replay**   | Conversations persist verbatim OR items — nothing is paraphrased      |
| **Resumable turns**   | Turns run server-side; refresh mid-answer and pick up where you were  |
| **Multi-user**        | Email/password auth; first account becomes admin                      |
| **White-label**       | Rename, re-logo, and re-theme the whole app from the admin panel      |
| **Boring to operate** | One container + Postgres + Redis; migrations run automatically        |

## Quick start (Docker Compose)

```bash
git clone https://github.com/your-org/parley && cd parley
APP_SECRET=$(openssl rand -base64 32) docker compose up -d
```

Open <http://localhost:3000>, create your account (the first one is the
admin), and chat with the built-in demo agent. Connect your own from the
**Agents** page.

## Connecting an agent

Any HTTP endpoint implementing the Open Responses spec works. In
**Agents → Add agent**, set:

- **Base URL** — requests go to `{base URL}/responses`
- **API key** (optional) — sent as `Authorization: Bearer …`, stored encrypted
  (AES-256-GCM, key derived from `APP_SECRET`)
- **Conversation state** — replay the full transcript each turn (default), or
  use `previous_response_id` if your agent stores state server-side
- **Capabilities** — enable image/file input if your agent accepts
  `input_image` / `input_file` parts

Admins can mark agents as *shared with everyone*; members can also register
personal agents (can be disabled). See
[docs/building-agents.md](docs/building-agents.md) for a minimal agent
implementation walkthrough.

## Development

```bash
bun install
docker compose -f docker-compose.dev.yml up -d   # Postgres :5433, Redis :6380
bun run dev                                       # http://localhost:3000
```

Useful scripts:

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `bun run dev`       | Vite dev server with HMR            |
| `bun run build`     | Production build into `dist/`       |
| `bun run start`     | Serve the production build (Bun)    |
| `bun run test`      | Unit tests (Vitest)                 |
| `bun run lint`      | Biome lint + format check           |
| `bun run typecheck` | TypeScript                          |

**Stack:** TanStack Start + React, Effect, Drizzle (Postgres), Redis,
better-auth, Tailwind + shadcn/ui, Bun.

**How a turn works:** `POST /api/chat` persists your message, spawns a
server-side fiber that calls the agent and appends every streamed frame to a
Redis list (published for live followers), and returns an SSE response that
forwards agent events verbatim plus `parley.*` platform events. Reconnecting
clients resume from any index via `GET /api/chat/:turnId/stream?after=N`.
Completed items are persisted verbatim to Postgres for lossless replay.

## Deploying

- [docs/deployment.md](docs/deployment.md) — Docker, Compose, Kubernetes
  (manifests in [`k8s/`](k8s/)), TLS/proxy notes for SSE
- [docs/configuration.md](docs/configuration.md) — every environment variable
- [docs/theming.md](docs/theming.md) — branding and custom CSS themes

## License

[MIT](LICENSE)
