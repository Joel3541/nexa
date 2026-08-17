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

## Render

`render.yaml` is a Blueprint. Push the repo to GitHub, then **New → Blueprint**.
Render provisions PostgreSQL, builds the Dockerfile, generates `AUTH_SECRET`,
and wires `DATABASE_URL`.

Set by hand in the dashboard (they are marked `sync: false`, so they never enter
the repo): `AI_API_KEY`, `SMTP_*`, `PAYMENT_PROVIDER_KEY`,
`PAYMENT_WEBHOOK_SECRET`.

The blueprint specifies `basic-256mb` for the database rather than `free`, and
that is deliberate. A free Render Postgres **expires 30 days after creation**,
becomes inaccessible, and is permanently deleted 14 days after that — and free
databases have no backups, so there is nothing to recover from. Upgrading is an
in-place instance-type change, not a migration, so an expired free database can
still be rescued; a deleted one cannot.

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
| Liveness / readiness | `GET /health` |
| Migrations | Applied automatically at boot, before the port opens |
| Graceful shutdown | SIGTERM closes the server, then the database. `tini` in the image forwards the signal so this actually runs |
| Logs | Structured JSON on stdout; `LOG_LEVEL` controls verbosity |
| Rate limiting | On by default; disable only behind your own gateway |
| Backups | Your database provider's. NEXA holds no state outside PostgreSQL apart from built assets |

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
