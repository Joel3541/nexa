# NEXA

**The intelligent operating system for modern small businesses.**

NEXA brings a small business's operational reality — customers, sales, stock, invoices, money — into one system, and puts an AI layer on top that understands it. Not a chatbot bolted onto a dashboard: an assistant that queries the same data the dashboard renders, through typed and permission-checked tools, and asks before it changes anything.

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

**No database server is required.** Local development runs PostgreSQL itself, compiled to WebAssembly and embedded in the API process, persisting to `.pgdata/`. The schema, SQL and migrations are ordinary Postgres; moving to a managed Postgres is a change of two environment variables.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API on `:4000` and web on `:5173` |
| `npm run setup` | Install, migrate, seed |
| `npm run db:reset` | Wipe and rebuild the demo workspace |
| `npm run db:push` | Apply migrations only |
| `npm test` | Full suite (36 tests) against a throwaway database |
| `npm run build` | Type-check and build the web bundle |
| `npm run generate -w @nexa/database` | Regenerate SQL migrations after a schema change |

## What's here

```
apps/
  api/     Express 5 + Zod REST API, services, AI tools, demo seed
  web/     React 19 + Vite + Tailwind 4 client
packages/
  types/         Domain enums, permissions, Zod contracts, API view models
  config/        Validated environment + country/currency/tax registry
  database/      Drizzle schema (32 tables), migrations, driver abstraction
  ai/            Tool contract, registry, agents, orchestrator, providers
  integrations/  Payment and messaging provider interfaces
docs/            Architecture, database, API, AI, security, deployment, roadmap
tests/           Tenant isolation, auth, operations, AI safety, permissions
```

## Documentation

- [Architecture](docs/architecture.md) — layers, boundaries and why they're drawn where they are
- [Database](docs/database.md) — schema, money representation, tenancy model
- [API](docs/api.md) — endpoint reference and conventions
- [AI](docs/ai.md) — the tool architecture, agents and approval model
- [Security](docs/security.md) — threat model and what is enforced where
- [Deployment](docs/deployment.md) — going to production
- [Roadmap](docs/roadmap.md) — what is deliberately not built yet

## Two principles worth knowing up front

**Money is never a float.** Every monetary value is an integer count of minor units (pesewas, cents) in a `bigint` column, formatted only at the edge. There is one function that computes document totals, shared by orders and invoices.

**The AI cannot lie about your numbers.** It has no database access. It selects from a registry of typed tools whose arguments are validated before any handler runs, and whose results come from the same services the REST API uses. Consequential tools are never executed by the model — they produce a proposal that a human with the right permission approves, and every approved action is written to the audit log.
