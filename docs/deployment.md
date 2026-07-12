# Deployment

Parley ships as a single stateless container. It needs **Postgres** (durable
state) and **Redis** (live turn streams, rate limiting). Database migrations
run automatically at boot, so upgrades are: pull new image, restart.

## Docker Compose (single host)

The repo's [`docker-compose.yml`](../docker-compose.yml) runs the full stack
with persistent volumes and healthchecks:

```bash
APP_SECRET=$(openssl rand -base64 32) docker compose up -d
```

Compose-level knobs (all via environment): `APP_URL`, `APP_SECRET`
(required), `PORT` (host port, default 3000), `POSTGRES_PASSWORD`,
`DEMO_AGENT`. Compose runs the demo agent as a separate service and configures
Parley with its internal `DEMO_AGENT_URL`.

For a real deployment, put a TLS-terminating proxy in front (see
[Reverse proxies and SSE](#reverse-proxies-and-sse)) and set
`APP_URL=https://your-domain`.

## Plain Docker

```bash
docker build -t parley .
docker run -d -p 3000:3000 \
  -e APP_URL=https://chat.example.com \
  -e APP_SECRET="$(openssl rand -base64 32)" \
  -e DATABASE_URL=postgres://user:pass@db-host:5432/parley \
  -e REDIS_URL=redis://redis-host:6379 \
  parley
```

The image is multi-stage (`oven/bun` build → `bun:slim` runtime), runs as a
non-root user, and starts via `bun run server.ts`.

To seed the demo when running Parley outside Compose, start the reference
server separately with `bun run demo-agent` and set `DEMO_AGENT_URL` to its
reachable `/v1` base URL. Setting `DEMO_AGENT=false` skips the seed entirely.

## Kubernetes

Reference manifests live in [`k8s/`](../k8s/):

- [`secret.example.yaml`](../k8s/secret.example.yaml) — copy to
  `secret.yaml`, fill in `APP_SECRET` / `DATABASE_URL` / `REDIS_URL`
- [`deployment.yaml`](../k8s/deployment.yaml) — namespace, Deployment
  (2 replicas, liveness/readiness probes on `/api/health`, non-root,
  read-only rootfs), a standalone demo-agent sidecar, and Service
- [`ingress.yaml`](../k8s/ingress.yaml) — nginx-class Ingress with
  SSE-friendly annotations and TLS

```bash
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

Update the `image:` reference and `APP_URL`/host to your values. Postgres and
Redis are expected as managed services or your own in-cluster deployments;
they are intentionally not included.

**Scaling:** the app is stateless — conversations persist in Postgres and
live turn streams are shared through Redis, so any replica can serve any
request (including resuming a stream started on another replica). Scale
horizontally at will.

## Health checks

`GET /api/health` verifies Postgres and Redis connectivity and returns
`{"ok":true}` (or HTTP 503). Use it for container healthchecks, k8s probes,
and uptime monitoring.

## Reverse proxies and SSE

Chat streams over Server-Sent Events. Any proxy in front must not buffer:

- **nginx:** `proxy_buffering off; proxy_read_timeout 3600s;`
  (the provided Ingress sets the equivalent annotations)
- **Caddy / Traefik:** streaming works out of the box
- **Cloudflare:** SSE passes through; avoid response-buffering features on
  `/api/chat*`

Parley also sends `X-Accel-Buffering: no` and heartbeat comments on its SSE
responses to keep intermediaries honest.

## Backups

All durable state is in Postgres — `pg_dump` covers everything (users,
agents, conversations, uploaded files, settings). Redis holds only transient
stream data and rate-limit counters; it is safe to lose, and `--appendonly`
in the Compose file is just to survive restarts gracefully.

## Upgrades

1. Pull/build the new image.
2. Restart the container(s). Migrations in `drizzle/` apply automatically at
   boot; replicas that boot concurrently take a Postgres advisory lock so
   only one migrates.
