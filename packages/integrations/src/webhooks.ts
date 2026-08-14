import { env } from '@nexa/config';
import { PaymentProviderError, type PaymentWebhookEvent } from './payment-contract.js';
import { verifyPaystackSignature } from './paystack.js';
import { verifyStripeSignature } from './stripe.js';

/**
 * Webhook ingestion — the security boundary of the payments integration.
 *
 * A payment webhook is an unauthenticated public endpoint that tells NEXA
 * "this invoice was paid". If it is not cryptographically verified, anyone who
 * learns the URL can settle any invoice for free. Everything in this file
 * exists to make that impossible:
 *
 *  - The signature is checked against the **raw bytes** of the request, before
 *    anything is parsed. Parsing first and re-serialising would silently break
 *    the MAC, and the tempting "fix" is to stop checking it.
 *  - An unverifiable request is rejected outright. There is no "log a warning
 *    and process it anyway" path, because that path is the vulnerability.
 *  - The verified event is normalised to one shape, so the route that applies
 *    it does not branch on provider and cannot get one branch wrong.
 */

export interface RawWebhookRequest {
  /** Exact bytes received, before any JSON parsing. */
  body: Buffer | string;
  headers: Record<string, string | string[] | undefined>;
}

function header(headers: RawWebhookRequest['headers'], name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Verifies and normalises an incoming payment webhook.
 *
 * Throws `PaymentProviderError` when the signature does not check out — the
 * caller should answer 400 and do nothing else.
 */
export function parsePaymentWebhook(request: RawWebhookRequest): PaymentWebhookEvent {
  const secret = env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    throw new PaymentProviderError(
      'configuration',
      'PAYMENT_WEBHOOK_SECRET is not set — refusing to trust an unverified payment webhook.',
    );
  }

  const provider = env.PAYMENT_PROVIDER;
  const raw = typeof request.body === 'string' ? request.body : request.body.toString('utf8');

  if (provider === 'paystack') {
    if (!verifyPaystackSignature(request.body, header(request.headers, 'x-paystack-signature'), secret)) {
      throw new PaymentProviderError('invalid_signature', 'Paystack webhook signature did not verify.');
    }
    return normalisePaystack(JSON.parse(raw) as PaystackEvent);
  }

  if (provider === 'stripe') {
    if (!verifyStripeSignature(request.body, header(request.headers, 'stripe-signature'), secret)) {
      throw new PaymentProviderError('invalid_signature', 'Stripe webhook signature did not verify.');
    }
    return normaliseStripe(JSON.parse(raw) as StripeEvent);
  }

  throw new PaymentProviderError(
    'not_implemented',
    `Provider "${provider}" does not accept webhooks. Set PAYMENT_PROVIDER to a live rail first.`,
  );
}

interface PaystackEvent {
  event: string;
  data: {
    reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
  };
}

function normalisePaystack(event: PaystackEvent): PaymentWebhookEvent {
  const status: PaymentWebhookEvent['status'] =
    event.event === 'charge.success'
      ? 'succeeded'
      : event.event.startsWith('refund')
        ? 'refunded'
        : event.event === 'charge.failed'
          ? 'failed'
          : 'pending';

  return {
    provider: 'paystack',
    type: event.event,
    reference: event.data.reference ?? null,
    status,
    amountMinor: event.data.amount ?? null,
    currency: event.data.currency ?? null,
    raw: event as unknown as Record<string, unknown>,
  };
}

interface StripeEvent {
  type: string;
  data: {
    object: {
      id?: string;
      client_reference_id?: string;
      amount_total?: number;
      amount?: number;
      currency?: string;
      payment_status?: string;
      metadata?: Record<string, string>;
    };
  };
}

function normaliseStripe(event: StripeEvent): PaymentWebhookEvent {
  const object = event.data.object;
  const status: PaymentWebhookEvent['status'] =
    event.type === 'checkout.session.completed' && object.payment_status === 'paid'
      ? 'succeeded'
      : event.type === 'charge.refunded'
        ? 'refunded'
        : event.type.endsWith('.payment_failed') || event.type === 'checkout.session.expired'
          ? 'failed'
          : 'pending';

  return {
    provider: 'stripe',
    type: event.type,
    // `client_reference_id` is where createPayment put NEXA's reference; the
    // metadata copy is the fallback for event types that omit it.
    reference: object.client_reference_id ?? object.metadata?.nexa_reference ?? null,
    status,
    amountMinor: object.amount_total ?? object.amount ?? null,
    currency: object.currency?.toUpperCase() ?? null,
    raw: event as unknown as Record<string, unknown>,
  };
}
