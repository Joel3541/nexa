import { randomBytes } from 'node:crypto';
import { env } from '@nexa/config';
import { customers, getDb, invoices, paymentLinks, payments } from '@nexa/database';
import {
  PaymentProviderError,
  getPaymentProvider,
  parsePaymentWebhook,
  type PaymentWebhookEvent,
  type RawWebhookRequest,
} from '@nexa/integrations';
import { and, eq, isNull } from 'drizzle-orm';
import { emitActivity, writeAudit } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { recordInvoicePayment } from './invoices.service.js';

/**
 * Hosted checkout: turning an invoice into a link a customer can pay.
 *
 * The invariant this file protects is simple and absolute: **an invoice is
 * marked paid only when the gateway tells us, over a signed webhook, that money
 * actually moved.** Not when the link is created, not when the payer is
 * redirected back to a success page — a redirect is a browser navigation the
 * payer controls, and treating it as proof of payment is how storefronts get
 * robbed. The success URL only shows a friendly message; this code is what
 * settles the invoice.
 */

const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Opaque, unguessable, and not derived from any internal identifier. */
function newReference(): string {
  return `nexa_${randomBytes(12).toString('hex')}`;
}

export interface CheckoutLink {
  reference: string;
  checkoutUrl: string | null;
  provider: string;
  simulated: boolean;
  amountMinor: number;
  currency: string;
  expiresAt: string;
}

export async function createInvoiceCheckout(
  business: { id: string; currency: string; country: string },
  invoiceId: string,
  actor: { userId: string; userName: string },
  now = new Date(),
): Promise<CheckoutLink> {
  const db = await getDb();
  const businessId = business.id;
  const provider = getPaymentProvider();

  const [invoice] = await db.select().from(invoices).where(ownedRow(invoices, invoiceId, businessId)).limit(1);
  if (!invoice) throw notFound('That invoice');

  const balanceMinor = Number(invoice.totalMinor) - Number(invoice.paidMinor);
  if (balanceMinor <= 0) throw badRequest('That invoice is already settled.');
  if (invoice.status === 'void') throw badRequest('That invoice has been voided.');

  const customer = invoice.customerId
    ? (await db.select().from(customers).where(ownedRow(customers, invoice.customerId, businessId)).limit(1))[0]
    : undefined;

  // Currency belongs to the business, not the invoice — a shop bills in one
  // currency, and reading it from anywhere else invites a mismatch between the
  // amount charged and the amount recorded.
  const currency = business.currency;

  const reference = newReference();
  const result = await provider.createPayment({
    amountMinor: balanceMinor,
    currency,
    reference,
    description: `Invoice ${invoice.number}`,
    ...(customer
      ? { customer: { name: customer.name, email: customer.email, phone: customer.phone } }
      : {}),
    metadata: { invoice: invoice.number, businessId },
  });

  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  await db.insert(paymentLinks).values({
    businessId,
    invoiceId: invoice.id,
    reference,
    provider: result.provider,
    providerRef: result.raw?.sessionId ? String(result.raw.sessionId) : null,
    amountMinor: balanceMinor,
    currency,
    status: 'pending',
    checkoutUrl: result.redirectUrl ?? null,
    createdByUserId: actor.userId,
    expiresAt,
  });

  await writeAudit(db, {
    businessId,
    actorUserId: actor.userId,
    actorName: actor.userName,
    action: 'invoice.checkout_created',
    entityType: 'invoice',
    entityId: invoice.id,
    summary: `${actor.userName} created a payment link for invoice ${invoice.number}.`,
    metadata: { provider: result.provider, reference, simulated: result.simulated },
  });

  return {
    reference,
    checkoutUrl: result.redirectUrl ?? null,
    provider: result.provider,
    simulated: result.simulated,
    amountMinor: balanceMinor,
    currency,
    expiresAt: expiresAt.toISOString(),
  };
}

export interface WebhookOutcome {
  handled: boolean;
  reason: string;
}

/**
 * Applies a verified webhook.
 *
 * Returns rather than throws for every "nothing to do" case. A gateway retries
 * anything it does not get a 2xx for, so answering 500 to an event we have
 * already processed — or one for a reference we do not recognise — buys an
 * infinite retry loop and nothing else.
 */
export async function applyPaymentWebhook(request: RawWebhookRequest, now = new Date()): Promise<WebhookOutcome> {
  let event: PaymentWebhookEvent;
  try {
    event = parsePaymentWebhook(request);
  } catch (error) {
    // The one case that must NOT be acknowledged: a request we cannot prove
    // came from the gateway.
    if (error instanceof PaymentProviderError) throw badRequest(error.message);
    throw error;
  }

  if (!event.reference) return { handled: false, reason: 'Event carried no reference.' };

  const db = await getDb();
  const [link] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.reference, event.reference))
    .limit(1);

  if (!link) {
    logger.warn('payment webhook for unknown reference', { reference: event.reference, type: event.type });
    return { handled: false, reason: 'Unknown reference.' };
  }

  if (link.settledAt) {
    // Redelivery. Already recorded; acknowledging is the correct response.
    return { handled: false, reason: 'Already settled.' };
  }

  if (event.status !== 'succeeded') {
    await db
      .update(paymentLinks)
      .set({
        status: event.status,
        updatedAt: now,
        failureReason: event.status === 'failed' ? `Gateway reported ${event.type}.` : null,
      })
      .where(eq(paymentLinks.id, link.id));
    return { handled: true, reason: `Recorded status ${event.status}.` };
  }

  // The gateway's amount is authoritative — a payer may have been charged a
  // different amount than the link was created for (partial payment, currency
  // conversion). Record what actually arrived, not what we expected.
  const amountMinor = event.amountMinor ?? Number(link.amountMinor);

  // Claim the link *before* recording the money. Two concurrent redeliveries
  // race here; the conditional update means exactly one of them wins, and the
  // loser sees zero rows changed and stops. Doing this after the insert would
  // leave a window in which both deliveries record a payment.
  const claimed = await db
    .update(paymentLinks)
    .set({ status: 'succeeded', settledAt: now, updatedAt: now })
    .where(and(eq(paymentLinks.id, link.id), isNull(paymentLinks.settledAt)))
    .returning({ id: paymentLinks.id });

  if (claimed.length === 0) return { handled: false, reason: 'Already settled by a concurrent delivery.' };

  if (link.invoiceId) {
    // Reuse the same path a human "record payment" click takes: it updates the
    // invoice status, recomputes customer rollups, writes the customer timeline
    // entry and the audit row. Re-implementing that here would drift from it.
    await recordInvoicePayment(
      link.businessId,
      link.invoiceId,
      {
        amountMinor,
        method: 'card',
        reference: link.reference,
        note: `Paid online via ${link.provider}.`,
        receivedAt: now.toISOString(),
      },
      { id: null, name: link.provider, source: 'system' },
    );
  } else {
    await db.insert(payments).values({
      businessId: link.businessId,
      orderId: link.orderId,
      amountMinor,
      method: 'card',
      reference: link.reference,
      provider: link.provider,
      providerRef: event.reference,
      note: `Paid online via ${link.provider}.`,
      receivedAt: now,
    });
  }

  await emitActivity(db, {
    businessId: link.businessId,
    type: 'payment.received',
    severity: 'success',
    source: 'system',
    title: 'Online payment received',
    description: `${link.provider} confirmed a payment of ${amountMinor} ${link.currency} (minor units).`,
    entityType: 'payment_link',
    entityId: link.id,
  });

  await writeAudit(db, {
    businessId: link.businessId,
    actorUserId: null,
    actorName: link.provider,
    actorType: 'system',
    action: 'payment.webhook_settled',
    entityType: 'invoice',
    entityId: link.invoiceId ?? link.id,
    summary: `${link.provider} confirmed payment for reference ${link.reference}.`,
    metadata: { type: event.type, amountMinor, currency: link.currency },
  });

  return { handled: true, reason: 'Payment recorded.' };
}

/** Payment rails a business can offer, given its country and configuration. */
export function availableMethods(country: string): { provider: string; simulated: boolean; methods: string[] } {
  const provider = getPaymentProvider();
  return {
    provider: provider.name,
    simulated: provider.simulated,
    methods: provider.supportedMethods(country),
  };
}

export function checkoutConfigured(): boolean {
  return env.PAYMENT_PROVIDER !== 'mock';
}

export async function listCheckoutLinks(businessId: string, invoiceId: string) {
  const db = await getDb();
  return db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.businessId, businessId), eq(paymentLinks.invoiceId, invoiceId)));
}
