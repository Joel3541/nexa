# Security

NEXA holds a business's customer list, revenue and receivables. The threat that matters most is not an exotic exploit — it is one business seeing another's data, or a staff member doing something their role should not permit.

## Authentication

**Passwords** are hashed with scrypt (memory-hard, Node standard library) using a per-user random salt, stored in a versioned format `scrypt$1$salt$hash` so parameters can be raised later and old hashes upgraded on next login. Verification uses `timingSafeEqual`.

scrypt was chosen over bcrypt/argon2 deliberately: no native compilation step, so the project installs and runs identically on every platform and in CI. If you standardise on argon2id, `hashPassword`/`verifyPassword` in `apps/api/src/lib/crypto.ts` are the only two functions to change, and the version prefix lets both coexist during migration.

**Sessions** are opaque random tokens in an `httpOnly`, `SameSite=Lax` cookie, `Secure` in production. Only the SHA-256 digest is stored, so a database dump yields no working sessions. Sessions are revocable server-side; a password change or reset revokes all of them.

**No user enumeration.** Wrong password and unknown email return the same status and the same wording, and the unknown-email path still performs a hash to keep timing comparable. Password reset always responds identically whether or not the address is registered. Both are asserted in `tests/auth.test.ts`.

**Brute-force resistance.** Failed logins increment a counter; eight failures lock the account for fifteen minutes. Auth endpoints are additionally rate-limited on a composite of client IP *and* submitted email, so one attacker cannot lock out an account by spraying from many addresses, and a single address cannot walk many accounts.

## Tenancy

The hard boundary. Enforced in three places:

1. **Membership resolution.** `loadTenant` resolves the active business through `business_members`. A business id the caller is not a member of does not resolve — the header is a hint, not an authority.
2. **Query scoping.** `apps/api/src/db/scope.ts` provides the only sanctioned way to read a tenant table. Queries are built *from* the tenant filter rather than appending it.
3. **404, not 403.** Cross-tenant reads return "not found". A 403 would confirm that a record with that id exists under another business.

`tests/tenancy.test.ts` covers direct id access across five entity types, list scoping, search scoping, forged business headers, and dashboard figure isolation.

## Authorization

Five roles — owner, admin, manager, staff, viewer — mapped to explicit permission strings in `packages/types/src/permissions.ts`. Enforced by `requirePermission(...)` on every route. The client receives the resolved list only to hide affordances.

**Privilege escalation is blocked** by rank: you cannot grant a role at or above your own. An admin cannot mint another admin, and the owner's membership cannot be edited through the members endpoint.

**The AI inherits the caller's rights.** Each tool declares the permission it consumes; the orchestrator filters the advertised tool list by the acting member's permissions and re-checks at execution. Approving an AI action requires `ai:approve_actions` and is re-checked against the *approver's* role at execution time, not the requester's.

## Input handling

Every request body and query string is parsed by a Zod schema before reaching a service. Failures become field-level messages, never raw validation dumps. All database access is parameterised through Drizzle; no user input is concatenated into SQL, and the AI cannot generate SQL at all.

## Transport and headers

- CORS allows exactly one origin (`WEB_ORIGIN`). Credentials are cookies, so a wildcard would be both invalid and unsafe.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`.
- `x-powered-by` disabled.
- `trust proxy` is set, so rate limiting keys on the real client IP behind a load balancer.

## Secrets and configuration

No secret is ever sent to the browser. `@nexa/config` validates the whole environment at boot and **refuses to start** on an invalid configuration rather than failing at request time. In production it additionally rejects the development `AUTH_SECRET` default and `COOKIE_SECURE=false`.

The logger redacts `password`, `token`, `authorization`, `cookie`, `apiKey`, `secret` and `passwordHash` from any structured context, recursively.

## Audit

`audit_logs` is append-only and covers registration, sign-in and failed sign-in, password changes, every domain mutation, member and permission changes, and every AI action — proposal, decision and execution result, with the payload. Entries carry actor identity, actor type (`user` / `ai` / `system`), IP and user agent. Admins can read the log in Settings.

## Error handling

Known `AppError`s are returned verbatim; their messages are written for business owners. Everything else is logged in full server-side with a request id, and reduced to a generic message for the client. Stack traces and database structure never reach a response.

## What is not done yet

Stated plainly, because a security document that only lists strengths is not useful:

- **No CSRF token.** Protection currently rests on `SameSite=Lax` plus a strict CORS allowlist, which covers the realistic cases for a cookie-authenticated JSON API. A double-submit token should be added before exposing state-changing endpoints to third-party origins.
- **No 2FA.** The schema supports adding it to `users` without migration pain, but it is not built.
- **Rate limiting is per-process.** Correct for one instance; multi-instance deployments need the Redis store (`setRateLimitStore`).
- **Email verification is not enforced.** Tokens are issued and the endpoint works, but no route currently requires a verified address.
- **No field-level encryption.** Customer PII is protected by database-level controls, not application-level encryption.
- **No automated dependency scanning** is wired into CI.
