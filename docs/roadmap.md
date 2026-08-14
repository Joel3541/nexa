# Roadmap

The MVP answers one question: *does a business owner find NEXA useful enough to open every day?* Everything below is either deliberately deferred or architecturally prepared but not built.

## Built

Authentication and sessions · multi-tenant workspaces with roles · business onboarding with per-country currency, tax and payment rails · dashboard with an explainable health score · the NEXA Morning Brief · CRM with derived segments and per-customer timelines · products and services · inventory with a full movement ledger and velocity-based stock projections · point of sale · invoicing with a print-ready document · expenses · tasks with recurrence · appointments · analytics · global search · command palette · activity feed · monitoring agents · the AI tool layer with 16 tools and an approval workflow · audit log · 36 tests.

## Architecturally prepared, not built

These have interfaces or schema in place and need an implementation, not a redesign.

**Live payments.** `PaymentProvider` in `packages/integrations` defines `createPayment` / `verifyPayment` / `refundPayment` / `getPaymentStatus`. Only the mock exists. Stripe, Paystack, Flutterwave and mobile money are adapters plus a config value. Adapters are absent rather than stubbed on purpose: a stub that silently no-ops would let the product pretend a payment succeeded.

**Real messaging.** `MessageChannelAdapter` covers email, SMS, WhatsApp and push. The console adapter marks everything `simulated: true` and the UI says so. Add an SMTP/Twilio/Meta adapter and the flag flips to real delivery with no call-site changes.

**Team invitations.** Members can be added and roles enforced, but there is no invitation email flow — an invited user must go through password reset.

**Recurring invoices**, **appointment reminders** and **calendar sync** — `appointments.external_calendar_id` exists for the last one.

**Subscriptions and billing.** The `subscriptions` table and plan enum exist; there is no billing integration or plan gating.

## Next milestones

### 1 — Close the loop on money (highest value)
Wire one real payment provider end to end, and one real email provider. The product's sharpest insight today is "GH₵3,745 is overdue" — being able to *send* the reminder and *take* the payment from inside NEXA turns an observation into collected cash. This is also where the payment-processing revenue line begins.

### 2 — Make the assistant open-ended
Ship `AI_PROVIDER=anthropic` as the default with proper cost controls. The tool layer, permissions and approval flow are already built and tested; the mock is a narrow-but-honest stand-in. Add streaming so long answers feel immediate.

### 3 — Proactive agents
Move `runAgentScan` from dashboard-load to a scheduled worker, and let it push notifications. This is the step from "NEXA answers when asked" to "NEXA tells you before you ask": *three customers buy Product A every 30 days; Maria is due — prepare a reminder?* The dedupe-key mechanism already makes repeated scans safe.

### 4 — Team and workflow depth
Invitation emails, task assignment and handoff, approval chains for larger businesses, per-member activity.

### 5 — Integrations
WhatsApp Business as a first-class channel (in these markets it is where the orders actually arrive), accounting export, e-commerce sync.

## Longer term

**Marketplace.** Businesses discover accountants, designers, marketers, suppliers, logistics and financing. Needs the business graph to be rich first — a marketplace on thin data is a directory.

**Financial infrastructure.** Payment processing, working capital, expense cards, insurance — through licensed and regulated partners where required. NEXA's transaction history is genuinely useful underwriting data for businesses that are otherwise invisible to lenders, which is the strongest long-term position in the plan.

**Developer platform and agent marketplace.** A public API over the business graph, then third-party agents. The tool contract in `packages/ai` is already the right shape for this: a third-party agent would register tools against the same registry with the same permission and approval semantics.

## The knowledge graph

The long-term moat is a structured understanding of `customer → purchases → product → supplier → margin → campaign → payment → revenue`. That graph is **not** built. What is built is the normalised, fully-linked relational schema that makes it derivable rather than requiring a migration. Every order line references its product; every payment references its order or invoice; every inventory movement references its cause. The edges exist; the traversal layer does not yet.

## Known limitations

- The mock AI provider recognises a fixed set of intents. Genuinely novel questions fall back to a business summary.
- Rate limiting is per-process.
- No CSRF token (see [security.md](security.md) for why `SameSite` + strict CORS covers current usage, and when that stops being true).
- Email verification is issued but not enforced.
- Invoice PDF export is browser print rather than server-side rendering — good enough to hand to a customer, not good enough to attach programmatically.
- Customer and product pickers load up to 200 records in one request. A business past that size needs type-ahead selection rather than a dropdown.
- Analytics use UTC day boundaries. Each business carries a timezone; period calculation does not use it yet, which will shift figures for businesses far from UTC.
- The web client has no offline mode, which matters for the intermittent connectivity common in the target markets.
