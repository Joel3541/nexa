# NEXA

**The intelligent operating system for modern small businesses.**

NEXA brings a small business's operational reality — customers, sales, stock, invoices, money — into one system, and puts an AI layer on top that understands it. Not a chatbot bolted onto a dashboard: an assistant that queries the same data the dashboard renders, through typed and permission-checked tools, and asks before it changes anything.

Built for Ghana and West Africa first — mobile money as a first-class payment rail, multi-currency from the first commit, and a UI that assumes a mid-range Android phone on a metered connection.

---

## Run it locally

```bash
npm install && npm run setup && npm run dev
```

`npm run setup` installs dependencies, applies migrations and seeds a complete demo business. Then open **http://localhost:5173**.

**Demo sign-in**

| Role | Email | Password |
| --- | --- | --- |
| Owner (full access) | `demo@nexa.app` | `NexaDemo2026` |
| Manager (reduced permissions) | `ama@aurabeauty.gh` | `NexaDemo2026` |

Sign in as the manager to see role-based permissions actually take effect — the AI assistant can be used but its actions cannot be approved, and settings are read-only.

> These credentials are published here on purpose, so the demo is one command
> away. That also makes them a back door, so the seeder **refuses to run in
> production** unless you explicitly set `SEED_DEMO_DATA=true`. On a live
> install, create your first workspace by signing up.

**No database server is required.** Local development runs PostgreSQL itself, compiled to WebAssembly and embedded in the API process, persisting to `.pgdata/`. The schema, SQL and migrations are ordinary Postgres; moving to a managed Postgres is a change of two environment variables.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API on `:4000` and web on `:5173` |
| `npm run setup` | Install, migrate, seed |
| `npm test` | Full suite (60 tests) against a throwaway database |
| `npm run typecheck` | Type-check every workspace |
| `npm run ai:verify` | Prove a live Anthropic key works, end to end |
| `npm run db:reset` | Wipe and rebuild the demo workspace |
| `npm run db:push` | Apply migrations only |
| `npm run build` | Type-check and build the web bundle |
| `npm run generate -w @nexa/database` | Regenerate SQL migrations after a schema change |

## What's here

```
apps/
  api/     Express 5 + Zod REST API, services, AI tools, worker, demo seed
  web/     React 19 + Vite + Tailwind 4 client
packages/
  types/         Domain enums, permissions, Zod contracts, API view models
  config/        Validated environment + country/currency/tax registry
  database/      Drizzle schema (33 tables), migrations, driver abstraction
  ai/            Tool contract, registry, agents, orchestrator, providers, pricing
  integrations/  Payments (Paystack, Stripe), email (SMTP), webhook verification
docs/            Architecture, database, API, AI, security, deployment, roadmap
tests/           Tenant isolation, auth, operations, AI safety, permissions,
                 payment signatures, cost accounting, job concurrency
```

## Deploy it

One container serves both the API and the web client, so hosting is a single
deployment rather than two that have to agree on an origin.

```bash
cp .env.example .env    # set AUTH_SECRET and COOKIE_SECURE at minimum
docker compose up -d
```

`render.yaml` and `fly.toml` are included for one-click hosting. Full guide:
**[docs/deployment.md](docs/deployment.md)**.

---

## Four decisions worth defending

**Money is never a float.** Every monetary value is an integer count of minor units (pesewas, cents) in a `bigint` column, formatted only at the edge. There is one function that computes document totals, shared by orders and invoices. AI spend is tracked the same way, in micro-dollars — a single turn can cost less than a hundredth of a cent, so cents are too coarse a unit to accumulate a month of usage in.

**The AI cannot lie about your numbers.** It has no database access. It selects from a registry of typed tools whose arguments are validated before any handler runs, and whose results come from the same services the REST API uses. Consequential tools are never executed by the model — they produce a proposal that a human with the right permission approves, and every approved action is written to the audit log.

**Tenant isolation is structural, not remembered.** Queries go through scope helpers (`inBusiness`, `ownedRow`) rather than a hand-written `where` clause per call site, and a cross-tenant read returns **404, not 403** — a 403 confirms the record exists. This is the single most-tested property in the suite.

**Money only moves when the gateway says so.** A payment link being created is not a payment, and a payer being redirected back to a success page is not a payment either — that redirect is a browser navigation the payer controls. An invoice settles only on a signed webhook, verified over the raw request bytes with a timing-safe comparison, with replay protection on Stripe and a conditional claim so a redelivered webhook cannot pay an invoice twice.

## Documentation

- [Architecture](docs/architecture.md) — layers, boundaries and why they're drawn where they are
- [Database](docs/database.md) — schema, money representation, tenancy model
- [API](docs/api.md) — endpoint reference and conventions
- [AI](docs/ai.md) — the tool architecture, agents and approval model
- [Security](docs/security.md) — threat model and what is enforced where
- [Deployment](docs/deployment.md) — hosting, webhooks, cost controls
- [Roadmap](docs/roadmap.md) — what is deliberately not built yet

## Project status

Honest accounting of what has and has not been exercised against the real world:

| Area | Status |
| --- | --- |
| Domain model, API, web client | Working, covered by 60 tests |
| Tenant isolation, RBAC, audit trail | Working, tested directly |
| AI assistant on the mock provider | Working — answers from real seeded data, no invented figures |
| AI on the live Anthropic provider | **Code complete, not verified against a real key.** Run `npm run ai:verify` |
| Payment adapters (Paystack, Stripe) | **Code complete, not verified against live gateway credentials.** Signature verification is unit-tested against known vectors |
| Email over SMTP | Code complete, not verified against a live SMTP host |
| Scheduled agents, daily brief | Working; job concurrency tested |

The mock providers are development adapters, not pretend production ones: every
result they return is flagged `simulated`, and the UI says "prepared, not
delivered" rather than implying a send or a payment happened.

## Licence

No licence has been chosen yet. Until one is added, default copyright applies
and the code is readable but not licensed for reuse.
