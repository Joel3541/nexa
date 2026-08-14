import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@nexa/config';
import {
  PaymentProviderError,
  type PaymentIntentRequest,
  type PaymentProvider,
  type PaymentResult,
  type RefundRequest,
} from './payment-contract.js';

/**
 * Stripe — international card payments.
 *
 * Talks to the REST API over `fetch` rather than pulling in the official SDK.
 * The surface NEXA needs is four endpoints and a signature check; the SDK's
 * value is mostly in the parts we do not use (Connect, Billing, webhooks
 * framework). Keeping it out means one less transitive dependency tree in a
 * codebase that is meant to be auditable.
 *
 * Stripe amounts are in the currency's smallest unit for decimal currencies,
 * which matches NEXA's representation. **Zero-decimal currencies are the
 * exception** and are handled explicitly below — sending 100 for ¥100 is right,
 * but sending 100 for what NEXA stores as ¥1.00 would be a 100x overcharge.
 */

const API_BASE = 'https://api.stripe.com/v1';

/**
 * Currencies Stripe treats as having no minor unit. For these, NEXA's "minor
 * units" and Stripe's amount are the same number only if NEXA also stores them
 * with zero decimals — which it does, via the currency table in @nexa/config.
 */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

interface StripeSession {
  id: string;
  url?: string;
  payment_status?: string;
  status?: string;
  amount_total?: number;
  currency?: string;
  client_reference_id?: string;
  payment_intent?: string;
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly simulated = false;

  constructor(
    private readonly secretKey: string = env.PAYMENT_PROVIDER_KEY ?? '',
    private readonly callbackUrl: string | undefined = env.PAYMENT_CALLBACK_URL,
  ) {
    if (!this.secretKey) {
      throw new PaymentProviderError('configuration', 'PAYMENT_PROVIDER_KEY is required for Stripe.');
    }
  }

  supportedMethods(country: string): string[] {
    const code = country.toUpperCase();
    // Stripe has no mobile-money coverage in NEXA's launch markets, which is
    // precisely why Paystack is the default there rather than this adapter.
    if (['US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'SG'].includes(code)) return ['card', 'bank_transfer'];
    return ['card'];
  }

  async createPayment(request: PaymentIntentRequest): Promise<PaymentResult> {
    const currency = request.currency.toLowerCase();
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('client_reference_id', request.reference);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', currency);
    form.set('line_items[0][price_data][unit_amount]', String(request.amountMinor));
    form.set('line_items[0][price_data][product_data][name]', request.description || request.reference);
    if (request.customer?.email) form.set('customer_email', request.customer.email);
    if (this.callbackUrl) {
      form.set('success_url', `${this.callbackUrl}?reference=${encodeURIComponent(request.reference)}`);
      form.set('cancel_url', `${this.callbackUrl}?reference=${encodeURIComponent(request.reference)}&cancelled=1`);
    }
    for (const [key, value] of Object.entries(request.metadata ?? {})) {
      form.set(`metadata[${key}]`, value);
    }
    form.set('metadata[nexa_reference]', request.reference);

    const session = await this.call<StripeSession>('POST', '/checkout/sessions', form, request.reference);

    return {
      id: session.id,
      provider: this.name,
      // A checkout session that exists is not a payment that happened.
      status: 'pending',
      amountMinor: request.amountMinor,
      currency: request.currency,
      reference: request.reference,
      redirectUrl: session.url,
      simulated: false,
      raw: { sessionId: session.id },
    };
  }

  async verifyPayment(sessionId: string): Promise<PaymentResult> {
    const session = await this.call<StripeSession>('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
    return this.toResult(session);
  }

  async refundPayment(request: RefundRequest): Promise<PaymentResult> {
    // A refund attaches to the PaymentIntent, not the checkout session, so the
    // session has to be resolved first.
    const session = await this.call<StripeSession>(
      'GET',
      `/checkout/sessions/${encodeURIComponent(request.paymentId)}`,
    );
    if (!session.payment_intent) {
      throw new PaymentProviderError('invalid_request', 'That checkout was never paid, so it cannot be refunded.');
    }

    const form = new URLSearchParams();
    form.set('payment_intent', session.payment_intent);
    form.set('amount', String(request.amountMinor));
    if (request.reason) form.set('metadata[reason]', request.reason);

    await this.call<unknown>('POST', '/refunds', form);
    return { ...this.toResult(session), status: 'refunded', amountMinor: request.amountMinor };
  }

  async getPaymentStatus(sessionId: string): Promise<PaymentResult['status']> {
    return (await this.verifyPayment(sessionId)).status;
  }

  private toResult(session: StripeSession): PaymentResult {
    const paid = session.payment_status === 'paid';
    const expired = session.status === 'expired';
    return {
      id: session.id,
      provider: this.name,
      status: paid ? 'succeeded' : expired ? 'failed' : 'pending',
      amountMinor: session.amount_total ?? 0,
      currency: (session.currency ?? 'usd').toUpperCase(),
      reference: session.client_reference_id ?? session.id,
      simulated: false,
      raw: { paymentIntent: session.payment_intent },
      ...(expired ? { failureReason: 'The checkout session expired before it was paid.' } : {}),
    };
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Guards against a retried request charging twice — the single most
          // expensive failure mode in a payments integration.
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(form ? { body: form.toString() } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new PaymentProviderError(
        'network',
        `Could not reach Stripe: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: { message?: string; type?: string } })
      | null;

    if (!response.ok) {
      throw new PaymentProviderError(
        response.status === 401 ? 'auth' : 'provider_error',
        payload?.error?.message ?? `Stripe returned ${response.status}.`,
      );
    }
    return payload as T;
  }
}

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.toUpperCase());
}

/**
 * Verifies a Stripe webhook signature (`Stripe-Signature` header).
 *
 * The header looks like `t=1700000000,v1=abc...,v1=def...`. Stripe signs
 * `"{timestamp}.{rawBody}"` with HMAC-SHA256 keyed by the endpoint's signing
 * secret. Three things this checks that a naive implementation skips:
 *
 *  - **Every** `v1` entry, because Stripe sends multiple during a secret roll.
 *  - The timestamp, within a tolerance, so a captured-and-replayed request from
 *    last week cannot mark an invoice paid today.
 *  - Timing-safe comparison, for the same reason as Paystack's.
 */
export function verifyStripeSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  if (!signatureHeader) return false;

  let timestamp: string | null = null;
  const candidates: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (!key || !value) continue;
    if (key === 't') timestamp = value;
    if (key === 'v1') candidates.push(value);
  }
  if (!timestamp || candidates.length === 0) return false;

  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return candidates.some((candidate) => {
    const provided = Buffer.from(candidate, 'utf8');
    return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
  });
}
