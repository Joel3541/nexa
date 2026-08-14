# Architecture

## The shape of the system

```
                    ┌──────────────────────────────┐
                    │  Web client (React + Vite)   │
                    │  Renders view models only.   │
                    │  Hides UI by permission,     │
                    │  never enforces it.          │
                    └──────────────┬───────────────┘
                                   │ REST + httpOnly session cookie
                    ┌──────────────▼───────────────┐
                    │  API (Express 5 + Zod)       │
                    │  ─ session + tenancy         │
                    │  ─ authorization             │
                    │  ─ validation                │
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
┌───────▼────────┐   ┌─────────────▼──────────┐   ┌───────────▼──────────┐
│ Domain services│   │ AI tool layer          │   │ Integrations         │
│ orders, invoices│◄──┤ typed, permissioned,   │   │ payments, messaging  │
│ customers, …   │   │ approval-gated wrappers│   │ (provider interfaces)│
└───────┬────────┘   └────────────────────────┘   └──────────────────────┘
        │
┌───────▼────────────────────────────────────────────────────────────────┐
│ Data layer — Drizzle over PostgreSQL                                   │
│ Every business-owned row carries business_id. Money is integer minor   │
│ units. Migrations are versioned SQL.                                   │
└────────────────────────────────────────────────────────────────────────┘
```

The long-term layering the product is aimed at — business data → workflow → agents → integrations → marketplace → financial infrastructure → developer platform — is visible in this structure. What exists today is the bottom three layers, built so the rest can be added without re-cutting the foundations.

## Boundaries that matter

### The AI has no privileged path to data

This is the single most important structural decision. The AI tool layer sits *beside* the API, not beneath it: both call the same domain services. There is no second query path, no "AI read replica", no raw SQL generation.

The consequence is that the assistant and the dashboard cannot disagree. An earlier revision of this codebase computed the business health score in two places with slightly different inputs, and the assistant reported 41/100 while the dashboard showed 46/100 for the same business on the same day. That is fatal to trust in an AI-native product, so both now read from a single `collectSnapshot()` in `dashboard.service.ts`. When you add a metric, add it there.

### Authorization is server-side, always

The web client receives the caller's resolved permission list, and uses it only to hide affordances. Every route re-checks with `requirePermission(...)`, and every AI tool declares the permission it consumes so the assistant can never exceed the rights of the human it works for. `tests/permissions.test.ts` proves the server refuses what the client would have hidden.

### Tenancy is structural, not conventional

`apps/api/src/db/scope.ts` provides `inBusiness()`, `ownedRow()` and `requireOwned()`. Tenant tables are queried *from* the tenant filter rather than having it appended, so omitting it is a type error rather than a silent leak. Cross-tenant reads return **404, not 403** — a 403 would confirm that a record with that id exists somewhere else.

### The API never exposes database rows

Responses are view models declared in `@nexa/types/api.ts`. Adding a column does not change the public contract, and internal fields (password hashes, dedupe keys, raw provider payloads) have no path to a client.

## Package layout and why

| Package | Depends on | Reason it is separate |
| --- | --- | --- |
| `@nexa/types` | zod only | Shared by server and browser. Must stay runtime-agnostic. |
| `@nexa/config` | zod, dotenv | Validated env + the country/currency/tax registry. Its `locale` entry point is pure and browser-safe; the env loader is server-only. |
| `@nexa/database` | drizzle | Schema and driver. Knows nothing about HTTP. |
| `@nexa/ai` | types, config | The tool *contract*, registry, agents, orchestrator and providers. Deliberately contains no database access, which is what lets the API own the implementations. |
| `@nexa/integrations` | config | Payment and messaging interfaces. Business logic depends on these, never on a vendor SDK. |
| `apps/api` | all of the above | Domain services, routes, concrete AI tools, seed. |
| `apps/web` | types, config/locale | Client. Consumes workspace packages as TypeScript source through Vite aliases. |

There is no `packages/ui`: the design system lives in `apps/web/src/components/ui` because there is one consumer. When a second client appears (a mobile app, an embedded widget), extracting it is a move, not a rewrite.

## Request lifecycle

1. `requestId` assigns a correlation id, echoed in the response and every log line.
2. `express.json` + `cookieParser` parse the request.
3. CORS allows exactly one origin (credentials are cookies, so a wildcard is both invalid and unsafe).
4. Security headers.
5. `rateLimit('global')` — fixed-window, swappable store.
6. `loadSession` resolves the session cookie to a user. It never rejects; routes declare their own requirement.
7. `loadTenant` resolves the active business from `x-nexa-business` (falling back to the user's last-used business) **through the membership table**. A business id the caller is not a member of behaves exactly like one that does not exist.
8. Route middleware: `requireAuth` → `requireBusiness` → `requirePermission(...)`.
9. Zod parses input; failures become field-level messages.
10. The service runs, usually in one transaction.
11. The error handler returns `AppError`s verbatim and reduces everything else to a generic message, logging the detail server-side.

## Transactions and consistency

Any write that touches more than one table runs in a transaction. Recording a sale, for example, atomically: reserves an order reference, inserts the order and its items, decrements stock with a matching inventory movement per line, records the payment, recomputes the customer's rollups, emits activity, and writes the audit entry. A failure anywhere leaves nothing behind.

Denormalised customer rollups (`total_spent_minor`, `order_count`, `outstanding_minor`, `last_purchase_at`) are **recomputed from source rows**, not incremented. Recomputation is marginally more expensive and self-heals: a correction anywhere upstream propagates without a repair job.

## Where things are deliberately simple

- **Rate limiting** is in-memory. Correct for one process, and honest that it does not coordinate across instances. `setRateLimitStore()` takes a Redis implementation.
- **Logging** is a 40-line module emitting JSON in production. Swapping in pino or OpenTelemetry replaces one file.
- **The agent scan** runs on dashboard load — idempotent and deduplicated by a stable key. A scheduled worker can call `runAgentScan()` unchanged.
- **Invoice "overdue"** is derived at read time from the due date rather than stored, so nothing is ever stale-labelled because a nightly job did not run.
