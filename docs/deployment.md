# Deployment

## Shape

Two deployable units plus a database:

- **API** — a Node process (`apps/api`). Stateless apart from the in-memory rate limiter.
- **Web** — a static bundle (`apps/web/dist`) served by any CDN or static host.
- **PostgreSQL** — any managed Postgres (Neon, Supabase, RDS, Cloud SQL, Railway).

The web client calls `/api`, so put both behind one origin — a reverse proxy, or the static host's rewrite rules. Same-origin keeps the session cookie simple and avoids third-party cookie restrictions.

## Environment

Start from `.env.example`. For production:

```bash
NODE_ENV=production
API_PORT=4000
WEB_ORIGIN=https://app.yourdomain.com

DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/nexa?sslmode=require

# 32+ chars. node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
AUTH_SECRET=<random>
SESSION_TTL_DAYS=30
COOKIE_SECURE=true

AI_PROVIDER=anthropic
AI_API_KEY=<key>
AI_MODEL=claude-sonnet-5

LOG_LEVEL=info
RATE_LIMIT_ENABLED=true
```

The config layer validates all of this at boot and **refuses to start** on an invalid configuration. In production it additionally rejects the development `AUTH_SECRET` default and `COOKIE_SECURE=false`. A misconfigured instance fails immediately and visibly rather than at 3am under load.

## Build and run

```bash
npm ci
npm run build                    # type-checks and builds the web bundle
npm run start -w @nexa/api       # migrations run before the port opens
```

`apps/api/src/index.ts` applies migrations, then listens. The process either has a schema it can serve or it exits — a half-migrated instance never accepts traffic. It handles `SIGTERM`/`SIGINT` with a graceful drain and a 10-second hard timeout.

### Container

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci --omit=dev
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@nexa/api"]
```

The API runs TypeScript through `tsx`, so no separate compile step is needed for the server. If you prefer a compiled artefact, `tsc -p apps/api` emits to `apps/api/dist`.

## Migrations

Checked into `packages/database/migrations/` and applied automatically at boot, tracked in `drizzle.__drizzle_migrations`.

With several API replicas, run migrations as a **release step** before rolling instances, so concurrent boots do not race:

```bash
npm run db:push
```

## Before the first production deploy

- [ ] `AUTH_SECRET` is a fresh 32+ character random value, stored in a secret manager
- [ ] `COOKIE_SECURE=true` and everything is behind TLS
- [ ] `WEB_ORIGIN` is the exact production origin — CORS is a strict allowlist
- [ ] `DATABASE_URL` uses `sslmode=require`
- [ ] Automated database backups with a tested restore
- [ ] Migrations run as a release step, not concurrently at boot
- [ ] `/health` wired to the load balancer
- [ ] Log aggregation collecting the JSON lines (each carries a request id)
- [ ] Error tracking on unhandled rejections
- [ ] Redis-backed rate limiter if running more than one instance (`setRateLimitStore`)
- [ ] Real email provider configured, or accept that invoices are prepared and not delivered

## Scaling notes

**The API is stateless.** Sessions are in the database, so instances can be added freely. Two caveats:

1. The rate limiter is per-process. Fine for one instance; implement `RateLimitStore` against Redis for more.
2. Nothing else holds process-local state.

**Database first.** The indexes described in [database.md](database.md) are what keep dashboard and analytics queries flat as data grows. Watch `orders (business_id, occurred_at)` — it backs every revenue figure.

**Caching.** None today, deliberately. The dashboard is a handful of indexed aggregates. If it becomes hot, cache `collectSnapshot()` per business with a short TTL — it is the single place all headline figures come from, so one cache covers the dashboard, the brief and the AI's business summary at once.

**AI cost.** Each `/ai/chat` turn is up to four model round-trips plus tool execution. It is already rate-limited per user (20/min) and audited with token counts in `ai_messages`, which is where to look when forecasting spend.

## Backups

Back up Postgres, not the application — there is no other state. `audit_logs` and `inventory_movements` are append-only and are what let you reconstruct how the business reached its current numbers, so retain them at least as long as your tax obligations require.
