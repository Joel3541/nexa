# Deployment

NEXA ships as **one container** that serves both the API and the web client.
That is a deliberate choice, not a shortcut: a single origin removes CORS from
production, lets the session cookie stay `SameSite=Lax` without a cross-site
exemption, and means a small business hosting this operates one deployment
rather than two that have to agree on an origin.

The API detects the built client at `apps/web/dist` and mounts it
(`apps/api/src/middleware/static.ts`). If the bundle is absent — the normal case
in development, where Vite serves the client on port 5173 — nothing is mounted
and the process is API-only. The startup log line reports which mode you are in
via `servingWebClient`.

Splitting them is still supported: build `apps/web` and host the bundle
anywhere, set `WEB_ORIGIN` to that host, and the CORS allowlist takes over.

---

## Going live, in an order that cannot break the site

Run `npm run preflight` at any point to see exactly what is still stubbed. It
exits non-zero on a blocker, so it also works as a release gate in CI.

The ordering below matters. `AI_PROVIDER=anthropic` without a key, or
`EMAIL_PROVIDER=smtp` without a host, **fails validation and the process
refuses to start** — that is deliberate, but it means the provider switch is
always the *last* change, and it belongs in the hosting dashboard rather than in
a committed file where it takes effect the instant the blueprint syncs.

| # | Step | Why this order |
|---|---|---|
| 1 | Database on a paid plan | Render's free Postgres **expires 30 days after creation**, then is deleted 14 days later — and free databases have no backups of any kind, so there is nothing to restore. |
| 2 | `AUTH_SECRET`, `COOKIE_SECURE=true` | The app refuses to boot in production without them. |
| 3 | SMTP credentials → *then* `EMAIL_PROVIDER=smtp` | Until this is done, password reset has no recovery path. Do it before real signups, not after. |
| 4 | `AI_MONTHLY_BUDGET_CENTS` → `AI_API_KEY` → *then* `AI_PROVIDER=anthropic` | Cap the spend before enabling the spend. Then prove it with `npm run ai:verify`. |
| 5 | Payment keys + webhook secret → *then* `PAYMENT_PROVIDER` | Last, because this is where a bug costs someone real money. Test with a live low-value transaction. |

Steps 3–5 are each independently useful: the product works with any subset
enabled, and every disabled provider says so in the UI rather than pretending.

## Before anything else

Two settings decide whether a deployment is safe to put a real business on. The
app **refuses to boot** in production without them:

| Setting | Why it matters |
|---|---|
| `AUTH_SECRET` | Signs session material. 32+ random characters. Generate: `openssl rand -hex 32` |
| `COOKIE_SECURE=true` | Anything terminating TLS in front of NEXA satisfies this |

Three more it *warns* about at startup rather than refusing, because each is
occasionally the right call:

- `DATABASE_DRIVER=pglite` in production — the database becomes a directory
  inside the container. On an ephemeral filesystem every deploy destroys it, and
  nothing external can take a backup. Fine for a personal instance on a
  persistent volume; wrong for a business.
- `SEED_DEMO_DATA=true` — a live install should not ship the demo workspace.
- `AI_PROVIDER=anthropic` with `AI_MONTHLY_BUDGET_CENTS=0` — no ceiling on what
  a single workspace can spend.

---

## Docker Compose (self-hosting)

The most complete configuration: PostgreSQL in its own container, NEXA talking
to it over the network.

```bash
cp .env.example .env
# set at minimum: POSTGRES_PASSWORD, AUTH_SECRET, COOKIE_SECURE
docker compose up -d
```

Then open `http://localhost:4000`. The first run applies migrations before the
port opens, so the process either has a schema it can serve or it exits — an
instance never accepts traffic half-migrated.

Create the first workspace by signing up through the UI.

---

## What the platform tells the app about itself

Two settings cannot be filled in before a first deploy, because they depend on
facts that do not exist until the service does. NEXA reads them from the
platform rather than asking you to guess:

| Setting | Resolved from | Notes |
|---|---|---|
| Port | `PORT` | Outranks `API_PORT`. Every platform here assigns a port and health-checks the one it assigned. |
| `WEB_ORIGIN` | `RENDER_EXTERNAL_URL`, `RAILWAY_PUBLIC_DOMAIN`, `FLY_APP_NAME` | `https://` is added when the platform omits it — Railway's variable is a bare hostname, and a scheme-less origin produces email links that fail silently. |

`DATABASE_DRIVER` is inferred too: in production, with `DATABASE_URL` set and no
explicit driver, NEXA uses `postgres`. Defaulting to PGlite there would boot the
app against a directory *inside the container* — every request correct, every
row destroyed by the next deploy, nothing logged as an error. An explicit
`DATABASE_DRIVER` is always respected, including `pglite` on a persistent
volume.

On any host not in that table, set `WEB_ORIGIN` and `DATABASE_DRIVER` yourself.
`npm run preflight` will tell you if you have not.

---

## Railway

The shortest path, and the only one here with **no configuration file at all**.
Railway detects the `Dockerfile` and builds it.

1. **New Project → Deploy from GitHub repo**, and pick this repository.
2. **+ New → Database → Add PostgreSQL.** This is a real managed Postgres with
   no expiry timer.
3. On the app service, **Variables**, and add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — the literal text, including braces |
   | `NODE_ENV` | `production` |
   | `COOKIE_SECURE` | `true` |
   | `AUTH_SECRET` | 32+ random chars — `openssl rand -hex 32` |
   | `AI_MONTHLY_BUDGET_CENTS` | `2000` |
   | `SEED_DEMO_DATA` | `false` |

   `${{Postgres.DATABASE_URL}}` is Railway's cross-service reference syntax; it
   resolves at deploy time and follows the database if its credentials rotate.
   Substitute the service's actual name if you renamed it from `Postgres`.
4. **Settings → Networking → Generate Domain.** `WEB_ORIGIN` resolves itself
   from that domain; `DATABASE_DRIVER` resolves itself from `DATABASE_URL`.
5. **Settings → Deploy → Healthcheck Path:** `/health`.

Then the optional providers — `AI_API_KEY`, `SMTP_PASSWORD`, `EMAIL_FROM`,
payment keys — in the same Variables tab, in the order under *Going live* above.

> **Do not add a `railway.json` or `railway.toml`.** Railway's Config as Code is
> deprecated: new services cannot opt into it, and existing files **stop being
> read on 2026-12-01**. Its replacement, Infrastructure as Code
> (`.railway/railway.ts`), is *not* applied during a deploy — it has to be
> pushed with `railway config plan` and `railway config apply`. A committed
> config file would therefore either be ignored or quietly expire, which is why
> this repository has neither. The five settings above live in the dashboard,
> where they take effect when you save them.

---

## Render

`render.yaml` is a Blueprint. Push the repo to GitHub, then **New → Blueprint**.
Render provisions PostgreSQL, builds the Dockerfile, generates `AUTH_SECRET`,
and wires `DATABASE_URL`.

Set by hand in the dashboard (they are marked `sync: false`, so they never enter
the repo): `AI_API_KEY`, `SMTP_*`, `PAYMENT_PROVIDER_KEY`,
`PAYMENT_WEBHOOK_SECRET`.

The blueprint specifies `0.1c-256mb` for the database rather than `free`, and
that is deliberate. A free Render Postgres **expires 30 days after creation**,
becomes inaccessible, and is permanently deleted 14 days after that — and free
databases have no backups, so there is nothing to recover from. Upgrading is an
in-place instance-type change, not a migration, so an expired free database can
still be rescued; a deleted one cannot.

**Render's plan identifiers are CPU-and-memory coded, not named tiers.** Valid
Postgres plans are `free`, `0.1c-256mb`, `0.5c-1g`, `1c-2g`, …; valid web plans
are `free`, `0.5c-512mb`, `1c-2g`, …. Plausible-looking names like `starter` or
`basic-256mb` are rejected, and an unrecognised plan **fails the entire
blueprint sync** — so a one-word mistake here leaves every other change in the
file unapplied, with the service still running its old configuration. This cost
this project a five-week outage. If a sync does not take effect, check the
plan identifiers before anything else.

If the blueprint fights you, build the service by hand instead: **New → Web
Service**, point it at the repo, runtime Docker, then add a **New → PostgreSQL**
and set the variables as in the Railway section. Nothing in the application
requires the blueprint.

---

## Fly.io

```bash
fly launch --no-deploy
fly postgres create --name nexa-db
fly postgres attach nexa-db            # sets DATABASE_URL
fly secrets set AUTH_SECRET="$(openssl rand -hex 32)"
fly deploy
```

`fly.toml` sets `primary_region = "jnb"` (Johannesburg) — the closest Fly region
to West Africa. Change it to match where your customers are; latency to the
launch markets is a product concern, not just an ops one.

`min_machines_running = 1` is intentional. Scaling to zero means the first
request pays a cold start, and the first request is often a customer opening an
invoice payment link.

---

## Railway, App Platform, Cloud Run, and friends

Any platform that builds a Dockerfile works with no extra configuration. Set the
variables from `.env.example`, point the health check at `/health`, and expose
port 4000 (or set `API_PORT`).

---

## Payment webhooks

Point the gateway's webhook at:

```
https://<your-host>/webhooks/payments
```

This route is mounted **outside** `/api` and **before** the JSON body parser,
because signature verification runs over the exact bytes the gateway signed.

`PAYMENT_WEBHOOK_SECRET` is mandatory for any live provider — the app refuses to
boot without it, and the endpoint refuses to process a request it cannot verify.
An unverified payment webhook means anyone who learns the URL can mark invoices
paid.

- **Paystack** signs with your secret key (HMAC-SHA512).
- **Stripe** signs with the endpoint's signing secret (`whsec_…`), and NEXA
  additionally enforces a 5-minute timestamp tolerance so a captured request
  cannot be replayed later.

A payer being redirected back to `PAYMENT_CALLBACK_URL` is **never** treated as
proof of payment. Only the signed webhook settles an invoice. Redelivery is
safe: `payment_links.settled_at` is claimed with a conditional update, so a
webhook replayed ten times records the money once.

---

## Turning the AI on

1. Put a key from `console.anthropic.com` in `AI_API_KEY`.
2. Set `AI_PROVIDER=anthropic`.
3. Run `npm run ai:verify`.

The verification script checks the credentials, makes a real round trip, then
runs a full tool-calling turn against your actual seeded data and reports the
tokens and estimated cost. It never prints your key, and it writes nothing.

Cost controls:

| Variable | Effect |
|---|---|
| `AI_MODEL` | `claude-opus-5` (default), `claude-sonnet-5` (~60% of the cost), `claude-haiku-4-5` for simple lookups |
| `AI_EFFORT` | `low` … `max`; `medium` is the balance point |
| `AI_THINKING` | Adaptive reasoning. Off trades answer quality for latency and spend |
| `AI_MONTHLY_BUDGET_CENTS` | Per-business ceiling on *estimated* spend for the calendar month |

The budget is checked *before* each turn, so an overshoot is bounded by one
request rather than by how long it takes someone to look at a dashboard.
`GET /api/ai/usage` reports month-to-date consumption, and every assistant
message stores its own token counts and estimated cost.

---

## Email

`EMAIL_PROVIDER=console` writes messages to the log and the outbox table and
marks them `simulated` — the UI says "prepared, not delivered" rather than
implying a send happened.

`EMAIL_PROVIDER=smtp` delivers for real. SMTP rather than a vendor SDK because
every transactional provider worth using speaks it (Postmark, SES, Resend,
Mailgun, Brevo), as does a mail server you run yourself — one adapter covers
every market, including those a US-only vendor does not serve.

An address the mail server explicitly rejects is recorded as `failed` with the
server's own reason, not reported as sent.

---

## Operating it

| Concern | Where |
|---|---|
| Liveness (is the process alive?) | `GET /health` — cheap, no dependencies |
| Readiness (can it serve?) | `GET /health/ready` — pings the database, 503 if unreachable |
| Migrations | Applied automatically at boot, before the port opens |
| Graceful shutdown | SIGTERM closes the server, then the database. `tini` in the image forwards the signal so this actually runs |
| Logs | Structured JSON on stdout; `LOG_LEVEL` controls verbosity |
| Rate limiting | On by default; disable only behind your own gateway |
| Backups | Your database provider's. NEXA holds no state outside PostgreSQL apart from built assets |

### Monitoring — set this up before you have users

The two endpoints are deliberately different, and pointing the wrong one at the
wrong consumer causes the failure it was meant to prevent:

- **`/health` is what the platform restarts on.** It must not check the
  database. A five-second blip would otherwise kill a healthy process and
  restart it into a crash loop, turning a brief degradation into an outage.
  This is what `healthCheckPath` in `render.yaml` points at.
- **`/health/ready` is what *you* watch.** It answers 503 when the database is
  unreachable, which is the state a liveness check cannot see: the process is
  genuinely alive, it simply cannot do anything useful.

Point an external uptime monitor at `https://<your-host>/health/ready` with a
five-minute interval and email alerts. UptimeRobot and Better Stack both cover
this on their free tiers. Render's own notification settings will additionally
tell you about failed deploys and suspensions.

This matters more than it sounds. Nothing inside a dead process can report that
it died, so without an external watcher the first thing that tells you the site
is down is a user — or nobody at all. A deployment can sit broken for weeks
while `/health` keeps answering, which is precisely how this project's first
production database reached its expiry unnoticed.

### Upgrading

Migrations are versioned SQL in `packages/database/migrations`, applied in order
at boot. Take a database snapshot before deploying a release that includes one —
the same rule as any Postgres application.

### Scaling

The API is stateless apart from the in-memory rate limiter, so it scales
horizontally. Two caveats before you add instances:

- The rate limiter counts per process. Behind N instances the effective limit is
  N times what is configured. Move it to a shared store, or enforce limits at
  your gateway, before that matters.
- The scheduled agent worker must run in exactly one place. See `roadmap.md`.
