# API reference

Base path `/api`. JSON in, JSON out. Authentication is an `httpOnly` session cookie; the active workspace travels in the `x-nexa-business` header.

## Conventions

**Money** crosses the wire as an integer count of minor units. `12500` in a GHS business is GH₵125.00.

**Errors** are uniform:

```json
{ "error": { "code": "bad_request", "message": "Please check the highlighted fields.",
             "fields": { "email": "Already used by another customer" },
             "requestId": "b3f1…" } }
```

`fields` is present on validation failures and maps directly onto form inputs. `message` is written for a business owner, not a developer.

**Pagination** wraps list responses:

```json
{ "data": [...], "page": 1, "pageSize": 25, "total": 128, "totalPages": 6 }
```

**Status codes**: 200 ok · 201 created · 400 validation · 401 no session · 403 role refused · 404 not found *(also returned for another tenant's records)* · 409 conflict · 429 rate limited · 500 server error.

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | Creates user + session. Returns the session context. |
| POST | `/auth/login` | Returns the session context. |
| POST | `/auth/logout` | Revokes the session server-side. |
| GET | `/auth/session` | Bootstrap payload; returns nulls when signed out. |
| POST | `/auth/forgot-password` | Always 200, regardless of whether the address exists. |
| POST | `/auth/reset-password` | Consumes the token; revokes all sessions. |
| POST | `/auth/verify-email` | Consumes an email verification token. |
| PATCH | `/auth/profile` | Name, phone, avatar, timezone. |
| POST | `/auth/change-password` | Revokes all sessions; the client must re-authenticate. |

## Business

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/business/reference` | — (countries, currencies, industries, goals) |
| POST | `/business` | any authenticated user (onboarding) |
| GET | `/business` | `business:read` |
| PATCH | `/business` | `business:update` |
| PATCH | `/business/settings` | `settings:manage` |
| POST | `/business/switch/:businessId` | membership |
| GET | `/business/members` | `members:read` |
| POST | `/business/members` | `members:manage` |
| PATCH | `/business/members/:memberId` | `members:manage` |

## Customers

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/customers` | `customers:read` |
| POST | `/customers` | `customers:write` |
| GET | `/customers/:id` | `customers:read` |
| GET | `/customers/:id/timeline` | `customers:read` |
| PATCH | `/customers/:id` | `customers:write` |
| POST | `/customers/:id/notes` | `customers:write` |
| DELETE | `/customers/:id` | `customers:delete` |

Query: `page`, `pageSize`, `q`, `status`, `tag`, `segment` (`vip` `new` `inactive` `high_value` `owes_money` `repeat`), `sort` (`name` `recent` `spend` `orders` `last_purchase`).

Segments are derived from rollups, never stored, so they are always current.

## Products and inventory

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/products` | `products:read` |
| GET | `/products/categories` | `products:read` |
| GET | `/products/low-stock` | `inventory:read` |
| GET | `/products/valuation` | `inventory:read` |
| POST | `/products` | `products:write` |
| GET | `/products/:id` | `products:read` |
| PATCH | `/products/:id` | `products:write` |
| DELETE | `/products/:id` | `products:delete` — archives if the product appears in past sales |
| GET | `/products/:id/movements` | `inventory:read` |
| POST | `/products/:id/adjust` | `inventory:write` |

`ProductView` includes `unitsSold30d`, `daysOfStockRemaining` and `stockConfidence`. `daysOfStockRemaining` is `null` when there is no recent sales history — the API declines to project rather than guessing.

## Sales

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/orders` | `orders:read` |
| POST | `/orders` | `orders:write` |
| GET | `/orders/:id` | `orders:read` |
| PATCH | `/orders/:id` | `orders:write` — cancelling returns stock |
| POST | `/orders/:id/payments` | `orders:write` |

`POST /orders` atomically writes the order and items, decrements stock with a movement per line, records any payment, recomputes customer rollups, emits activity and writes an audit entry. Overselling a tracked product returns 409 and changes nothing.

## Invoices

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/invoices` | `invoices:read` |
| POST | `/invoices` | `invoices:write` |
| GET | `/invoices/:id` | `invoices:read` |
| PATCH | `/invoices/:id` | `invoices:write` |
| POST | `/invoices/:id/payments` | `invoices:write` |
| POST | `/invoices/:id/send` | `invoices:send` |

`?overdueOnly=1` or `?status=overdue` filters on the due date and orders oldest-first, so a capped page contains the *most* overdue invoices.

`POST /invoices/:id/send` returns `{ simulated, recipient, message }`. When no live email provider is configured, `simulated` is `true` and `message` says the invoice was prepared, not delivered. Clients should render `message` verbatim.

## Expenses, tasks, appointments

| Method | Path | Permission |
| --- | --- | --- |
| GET/POST | `/expenses` | `expenses:read` / `expenses:write` |
| GET | `/expenses/categories` | `expenses:read` |
| PATCH/DELETE | `/expenses/:id` | `expenses:write` |
| GET/POST | `/tasks` | `tasks:read` / `tasks:write` |
| GET/PATCH/DELETE | `/tasks/:id` | `tasks:read` / `tasks:write` |
| GET/POST | `/appointments` | `appointments:read` / `appointments:write` |
| GET/PATCH/DELETE | `/appointments/:id` | `appointments:read` / `appointments:write` |

Completing a recurring task immediately schedules its next occurrence.

## Insights

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/dashboard` | `analytics:read` — `?period=today\|last_7_days\|last_30_days\|this_month\|last_month\|last_90_days\|this_year` |
| GET | `/analytics` | `analytics:read` — `?from&to&granularity=day\|week\|month` |
| GET | `/search` | any member — `?q&limit` |
| GET | `/activity` | any member |
| POST | `/activity/read` | any member — `{ id }` or `{ id: null }` for all |
| GET | `/notifications` | any member |
| POST | `/notifications/read` | any member |
| GET/POST | `/campaigns` | `campaigns:read` |
| POST | `/campaigns/:id/send` | `campaigns:send` |
| GET | `/audit` | `audit:read` |

`GET /dashboard` also triggers an idempotent agent scan. It returns finance metrics with period-over-period deltas, the health score with its factor breakdown, the daily brief, a dense daily series, top products and customers, low stock, overdue invoices and upcoming work.

## AI

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/ai/agents` | member — agents and the tools *this caller* may use |
| GET | `/ai/conversations` | `ai:use` |
| GET | `/ai/conversations/:id` | `ai:use` |
| POST | `/ai/chat` | `ai:use` — rate limited to 20/min per user |
| GET | `/ai/actions` | `ai:use` — pending proposals |
| POST | `/ai/actions/:id/approve` | `ai:approve_actions` |
| POST | `/ai/actions/:id/reject` | `ai:approve_actions` |

`POST /ai/chat` returns the assistant message with its `toolCalls` trace (name, summary, duration, status) and any `pendingActions`. A pending action carries a preview of what would happen and has changed nothing.

## Health

`GET /health` — unauthenticated liveness probe.
