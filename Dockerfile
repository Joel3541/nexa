# ---------------------------------------------------------------------------
# NEXA — production image
#
# One container serves both the API and the web client (see
# apps/api/src/middleware/static.ts). That is a deliberate choice: a small
# business hosting this should deploy one thing, not negotiate CORS between two.
#
# The image runs TypeScript directly through tsx rather than emitting JavaScript.
# The workspace packages are consumed as source by design — @nexa/types is the
# same file the API and the web client both compile against — so a build step
# that emitted .js per package would add a compilation graph without removing
# any risk. Type safety is enforced in CI via `npm run typecheck`, which must
# pass before an image is built.
# ---------------------------------------------------------------------------

# --- Stage 1: install dependencies ------------------------------------------
FROM node:24-slim AS deps
WORKDIR /app

# Copy only manifests first so this layer caches until a dependency changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/integrations/package.json packages/integrations/
COPY packages/types/package.json packages/types/

RUN npm ci


# --- Stage 2: build the web client ------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .

# Fails the build on a type error rather than shipping one.
RUN npm run typecheck
RUN npm run build -w @nexa/web


# --- Stage 3: runtime -------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Node's own resolution of the workspace symlinks needs the real tree, so the
# runtime image carries source rather than a bundle.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# tini reaps zombies and forwards SIGTERM, which is what makes the graceful
# shutdown in apps/api/src/index.ts actually run on a container stop.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages

# The web client's source is not needed at runtime — only its built bundle.
RUN rm -rf apps/web/src apps/web/node_modules/.vite

# Run unprivileged. The node image ships a `node` user for exactly this.
RUN mkdir -p /app/.pgdata && chown -R node:node /app
USER node

EXPOSE 4000

# Compose/Kubernetes read this; platform health checks use /health directly.
# Mirrors the application's own precedence: PORT (platform-assigned) first,
# then API_PORT, then the default. A healthcheck probing a different port than
# the server bound to would report every healthy container as unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations run inside the process before the port opens, so there is no
# separate release step to forget.
CMD ["npm", "run", "start", "-w", "@nexa/api"]
