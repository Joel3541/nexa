# The AI layer

The premise of NEXA is that an AI which genuinely knows a business is more valuable than one that writes fluent text about business in general. Everything here follows from that.

## The tool architecture

The model has no database access. It cannot write SQL, cannot reach a service directly, and cannot invoke anything that is not in the registry. What it *can* do is choose a tool name and produce arguments.

A tool is declared in `apps/api/src/ai/tools.ts`:

```ts
defineTool({
  name: 'get_overdue_invoices',
  label: 'Overdue invoices',
  description: 'Invoices past their due date with an outstanding balance, ordered by how late they are.',
  schema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  kind: 'read',
  permission: 'invoices:read',   // checked against the acting member's role
  requiresApproval: false,
  execute: async (input, ctx) => ({ summary, data, citations }),
});
```

Five things are true of every tool by construction:

1. **Arguments are validated by Zod before any handler runs.** A malformed or hostile tool call fails at the boundary with a message the model can act on.
2. **It declares the permission it consumes.** The orchestrator checks that permission against the acting member's role, so an assistant working for a staff member cannot see what that person cannot see.
3. **It belongs to specific agents.** An agent's tool list and the caller's permissions are both filtered before the model is even told what exists.
4. **Its results come from the same services the REST API uses.** There is no second data path, so the assistant cannot contradict the dashboard.
5. **If it is consequential, it cannot execute inline.** `requiresApproval: true` means the orchestrator calls `propose()` instead of `execute()`, and the model is told only that a proposal was prepared.

### Registered tools

**Read** (execute automatically): `get_business_summary`, `get_revenue`, `get_expenses`, `get_customers`, `get_customer`, `get_orders`, `get_inventory`, `get_low_stock_products`, `get_invoices`, `get_overdue_invoices`, `analyze_sales`, `analyze_customer_segments`

**Write** (proposed for approval): `create_task`, `create_customer`, `create_invoice_draft`, `create_campaign_draft`

## Agents

Agents are scoped roles, not autonomous processes. Each carries its own remit, system prompt and — critically — its own allowed tool list. They share a model today; the boundary that matters is the tool surface.

| Agent | Remit |
| --- | --- |
| Chief of Staff | Widest view; prioritises what the owner needs today |
| Sales | Revenue opportunities, momentum, stalled orders |
| Customer | Lapsing regulars, one-time buyers, relationships going quiet |
| Finance | Receivables, overdue balances, margin and cost anomalies |
| Inventory | Stock against real sales velocity, with stated confidence |
| Marketing | Campaigns built from real segments; drafts only |

Adding an agent is a new entry in `packages/ai/src/agents.ts` plus, optionally, new tools.

The same agents run as **monitoring scans** (`runAgentScan`) that look at real data and may raise an activity card. They cannot change a record. Cards are deduplicated by a stable key so a daily scan does not spam the feed.

## The orchestration loop

`packages/ai/src/orchestrator.ts` drives a bounded loop:

```
model → tool calls → validate → permission check → execute (read) / propose (write)
      → results back to model → … (max 4 iterations) → final answer
```

Invariants the loop enforces regardless of what the model asks for:

- A tool the acting member lacks permission for is never executed.
- Arguments are parsed by the tool's schema before the handler sees them.
- A `requiresApproval` tool is **never** executed here.
- The loop is bounded, so a model cannot spin. If it exhausts the bound, the response says so rather than inventing a conclusion.

## The approval model

A consequential tool call produces an `ai_actions` row in `proposed` state, carrying the validated payload, a human-readable label and description, an impact rating, and a **preview** — the actual records that would be affected.

The user sees a card that says, in effect: *here is what I would do, here are the first eight of the twenty-eight things it would touch, nothing has happened yet.* Approving requires the `ai:approve_actions` permission, which is re-checked at execution time against the approver's own role. Rejecting changes nothing. Approving twice is refused. Every executed action writes an audit entry with `actor_type = 'ai'`.

The assistant's language is constrained to match: the system prompt forbids claiming an action was performed, and the deterministic provider's copy says "I have prepared this for your approval — it has not been created yet."

## Providers

Set with `AI_PROVIDER`.

### `mock` — the development adapter (default)

Not a canned-response stub. It classifies the question against a set of business intents, calls the **real tools against the real database**, and composes its answer strictly from those results. Every number it prints came out of Postgres.

What it does not do is reason freely — it recognises a fixed set of intents. That is the honest trade: grounded and deterministic, but narrow. It exists so the product is fully demonstrable, and testable, with no API key and no per-request cost.

### `anthropic` — production

Gives the model the tool specs the acting member is permitted to use, and nothing else. Runs the same orchestration loop with the same invariants. Requires `AI_API_KEY`; the config layer refuses to boot without it.

Switching is a single environment variable. No application code changes.

## The daily brief

`buildBrief()` in `dashboard.service.ts` composes the NEXA Morning Brief. Every sentence is templated from a retrieved metric — there is **no generative step**, which is exactly why the response reports `aiGenerated: false`. The UI says "Assembled from your records — every figure is retrieved, never estimated."

The brief is allowed to be quiet. If nothing needs attention it says so, rather than manufacturing urgency. Its single recommendation is chosen by financial impact, not by what is easiest to render.

## Honesty rules

These are in the base system prompt for every agent, and mirrored in the deterministic provider's composers:

1. Never invent a number. Every figure must come from a tool result in this conversation. If no tool can retrieve it, say so.
2. Never claim to have performed an action. Say "I have prepared this for your approval."
3. Label projections as projections and state the assumption. Stock-out estimates carry a confidence rating derived from how many distinct selling days back the velocity estimate — and when there is no sales history, the tool returns `null` rather than a guess.
4. Prefer specifics: name the customer, the invoice, the amount.
5. End with one concrete next action when warranted, not a menu.
6. Be brief. This is read on a phone between customers.

## Adding a tool

1. Define it with `defineTool()` in `apps/api/src/ai/tools.ts`, wrapping an existing service.
2. Choose the `permission` it consumes — the narrowest that fits.
3. If it changes anything, set `requiresApproval: true` and implement `propose()` with a preview a non-technical user can evaluate.
4. Add its name to the relevant agents' tool lists.
5. Add it to `ALL_TOOLS`.
6. If the mock provider should reach it, add an intent in `packages/ai/src/providers/mock.ts`.

The registry rejects a `requiresApproval` tool with no `propose()` at registration time, so that mistake cannot ship.
