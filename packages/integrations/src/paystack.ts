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
 * Paystack — the primary live rail for NEXA's launch markets.
 *
 * Chosen first (ahead of Stripe) because it settles in GHS, NGN, ZAR and KES
 * and, critically, supports **mobile money** — which is how most Ghanaian
 * customers actually pay. A card-only rail would be the wrong default here even
 * though it is the obvious one from a Western vantage point.
 *
 * Paystack denominates in the currency's minor unit (pesewas for GHS, kobo for
 * NGN), which is the same representation NEXA uses internally, so no scaling
 * conversion is needed — and none is done, deliberately: a units conversion is
 * exactly where money bugs live.
 */

const API_BASE = 'https://api.paystack.co';

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

interface PaystackTransaction {
  id: number;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  gateway_response?: string;
  authorization_url?: string;
  access_code?: string;
}

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack';
  readonly simulated = false;

  constructor(
    private readonly secretKey: string = env.PAYMENT_PROVIDER_KEY ?? '',
    private readonly callbackUrl: string | undefined = env.PAYMENT_CALLBACK_URL,
  ) {
    if (!this.secretKey) {
      throw new PaymentProviderError('configuration', 'PAYMENT_PROVIDER_KEY is required for Paystack.');
    }
  }

  /**
   * Rails available in a given market.
   *
   * Country-aware because offering a Ghanaian shop "iDEAL" or a Kenyan shop
   * "EFT" would be noise, and offering a card-only list in Ghana would miss the
   * dominant payment method entirely.
   */
  supportedMethods(country: string): string[] {
    const code = country.toUpperCase();
    if (code === 'GH') return ['mobile_money', 'card', 'bank_transfer'];
    if (code === 'NG') return ['card', 'bank_transfer', 'ussd', 'mobile_money'];
    if (code === 'KE') return ['mobile_money', 'card'];
    if (code === 'ZA') return ['card', 'eft'];
    return ['card'];
  }

  async createPayment(request: PaymentIntentRequest): Promise<PaymentResult> {
    if (!request.customer?.email) {
      // Paystack requires an email to key the transaction. Failing here with a
      // clear reason beats a 400 from the gateway with no context.
      throw new PaymentProviderError(
        'invalid_request',
        'Paystack needs a customer email address to start a payment. Add one to the customer record first.',
      );
    }

    const data = await this.call<PaystackTransaction>('POST', '/transaction/initialize', {
      email: request.customer.email,
      amount: request.amountMinor,
      currency: request.currency,
      reference: request.reference,
      ...(this.callbackUrl ? { callback_url: this.callbackUrl } : {}),
      ...(request.method ? { channels: toChannels(request.method) } : {}),
      metadata: {
        ...request.metadata,
        description: request.description ?? null,
        customer_name: request.customer?.name ?? null,
      },
    });

    return {
      id: request.reference,
      provider: this.name,
      // Initialisation only creates the checkout. Money has not moved until the
      // webhook (or an explicit verify) says so — reporting 'succeeded' here
      // would mark invoices paid that nobody has paid.
      status: 'pending',
      amountMinor: request.amountMinor,
      currency: request.currency,
      reference: request.reference,
      redirectUrl: data.authorization_url,
      simulated: false,
      raw: { access_code: data.access_code },
    };
  }

  async verifyPayment(reference: string): Promise<PaymentResult> {
    const data = await this.call<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    return this.toResult(data);
  }

  async refundPayment(request: RefundRequest): Promise<PaymentResult> {
    const data = await this.call<{ transaction: PaystackTransaction }>('POST', '/refund', {
      transaction: request.paymentId,
      amount: request.amountMinor,
      ...(request.reason ? { customer_note: request.reason } : {}),
    });
    return { ...this.toResult(data.transaction), status: 'refunded', amountMinor: request.amountMinor };
  }

  async getPaymentStatus(reference: string): Promise<PaymentResult['status']> {
    return (await this.verifyPayment(reference)).status;
  }

  private toResult(tx: PaystackTransaction): PaymentResult {
    return {
      id: tx.reference,
      provider: this.name,
      status: mapStatus(tx.status),
      amountMinor: tx.amount,
      currency: tx.currency,
      reference: tx.reference,
      simulated: false,
      raw: { paystackId: tx.id, gatewayResponse: tx.gateway_response },
      ...(mapStatus(tx.status) === 'failed' && tx.gateway_response
        ? { failureReason: tx.gateway_response }
        : {}),
    };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new PaymentProviderError(
        'network',
        `Could not reach Paystack: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as PaystackEnvelope<T> | null;

    if (!response.ok || !payload?.status) {
      throw new PaymentProviderError(
        response.status === 401 ? 'auth' : 'provider_error',
        payload?.message ?? `Paystack returned ${response.status}.`,
      );
    }
    return payload.data;
  }
}

function mapStatus(status: string): PaymentResult['status'] {
  switch (status) {
    case 'success':
      return 'succeeded';
    case 'failed':
    case 'reversed':
      return 'failed';
    case 'refunded' as string:
      return 'refunded';
    default:
      // 'ongoing', 'pending', 'abandoned', 'queued' — all still in flight.
      return 'pending';
  }
}

/** Maps NEXA's rail vocabulary onto Paystack's `channels` parameter. */
function toChannels(method: string): string[] {
  switch (method) {
    case 'mobile_money':
      return ['mobile_money'];
    case 'card':
      return ['card'];
    case 'bank_transfer':
      return ['bank', 'bank_transfer'];
    case 'ussd':
      return ['ussd'];
    default:
      return ['card', 'mobile_money', 'bank'];
  }
}

/**
 * Verifies a Paystack webhook signature.
 *
 * Paystack signs the **raw request body** with HMAC-SHA512 keyed by the secret
 * key. Two properties this implementation depends on:
 *
 *  - The body must be the exact bytes received. Re-serialising parsed JSON
 *    changes key order and whitespace, and the MAC will never match.
 *  - Comparison is timing-safe. A plain `===` leaks, byte by byte, how much of
 *    a guessed signature was correct — which is enough to forge one.
 */
export function verifyPaystackSignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const provided = Buffer.from(signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}
