# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
FROM oven/bun:1.3 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Production dependencies only (the server bundle externalizes node_modules).
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# -------------------------------------------------------------- runtime stage
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/examples ./examples
COPY --from=build /app/server.ts /app/package.json ./

# Run as the unprivileged user provided by the base image.
USER bun

EXPOSE 3000
CMD ["bun", "run", "server.ts"]
