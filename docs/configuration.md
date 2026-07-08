# Configuration

Parley splits configuration in two:

- **Environment variables** — process-level settings read once at boot
  (connections, secrets, limits). Documented below; see also
  [`.env.example`](../.env.example).
- **Admin panel settings** — runtime-tunable branding and access control,
  stored in Postgres and editable from **Admin → Branding & access** without
  a restart (see [theming.md](theming.md)).

## Required in production

| Variable       | Description                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`      | Public origin of the deployment, e.g. `https://chat.example.com`. Used for auth cookies/callbacks and trusted-origin checks.                                     |
| `APP_SECRET`   | Secret for session tokens and agent API-key encryption at rest (AES-256-GCM). Generate with `openssl rand -base64 32`. The server **refuses to boot** in production without it. |
| `DATABASE_URL` | Postgres connection string. All durable state: users, agents, conversations, items, files, settings. Migrations run automatically at boot.                       |
| `REDIS_URL`    | Redis connection string. Live turn streams (resume/replay of in-flight answers) and rate limiting.                                                              |

> **Rotating `APP_SECRET`** invalidates the encrypted agent API keys; each
> agent's key must be re-entered afterwards. Sessions are also reset.

## Optional

| Variable                        | Default | Description                                                                                          |
| ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`                          | `3000`  | Port the server listens on.                                                                          |
| `DEMO_AGENT`                    | `true`  | Serve the built-in demo agent and seed it on first boot. Disable in real deployments if undesired.    |
| `FILE_MAX_MB`                   | `10`    | Max attachment upload size in megabytes.                                                              |
| `CHAT_RATE_LIMIT`               | `30`    | Chat messages per user per minute; `0` disables rate limiting.                                        |
| `TURN_IDLE_TIMEOUT_SEC`         | `120`   | Abort a turn if the agent sends no events for this long.                                              |
| `TURN_MAX_DURATION_SEC`         | `600`   | Hard cap on total turn duration.                                                                      |
| `BLOCK_PRIVATE_AGENT_ADDRESSES` | `false` | Refuse agent base URLs that resolve to loopback/private ranges. **Enable on multi-tenant deployments** to prevent SSRF. |
| `ALLOW_USER_AGENTS`             | `true`  | Let non-admin members register personal agents. When `false`, only admins manage agents.              |
| `LOG_LEVEL`                     | `Info`  | Effect log level: `All`, `Trace`, `Debug`, `Info`, `Warning`, `Error`, `Fatal`, `None`.               |

In development, `DATABASE_URL`/`REDIS_URL` default to the
`docker-compose.dev.yml` services (`localhost:5433` / `localhost:6380`) and
`APP_SECRET` falls back to an insecure dev value.

## Admin panel settings (no restart required)

Stored in the `settings` table and applied instantly:

- **App name / tagline / logo URL** — white-label the whole UI
- **Custom CSS** — injected globally; theme anything (see [theming.md](theming.md))
- **Registration enabled** — allow anyone to sign up, or lock it down after
  your team has joined
- **Allow user agents** — runtime counterpart of `ALLOW_USER_AGENTS` (both
  must permit it)
- **Default agent** — preselected for new conversations
- **Chat disclaimer** — small print shown under the composer

## Users and roles

- The **first account** created on a fresh install becomes the admin.
- Admins can promote/demote members and ban/unban accounts from
  **Admin → Members**.
- Banned users cannot sign in; their data is retained.
