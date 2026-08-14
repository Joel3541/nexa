import { randomUUID } from 'node:crypto';
import { env } from '@nexa/config';

/**
 * Payment provider abstraction.
 *
 * Business logic never imports Stripe/Paystack/Flutterwave directly. It depends
 * on this interface, so adding a market's payment rail is a new adapter plus a
 * config value — no changes to orders, invoices or reporting.
 *
 * The MVP ships only `MockPaymentProvider`. It is explicitly a *development*
 * adapter: every result it returns is flagged `simulated: true` and the UI
 * labels it as such. NEXA never claims that money moved when it did not.
 */

export interface PaymentIntentRequest {
  /** Integer minor units, matching the business currency. */
  amountMinor: number;
  currency: string;
  reference: string;
  description?: string;
  customer?: { name?: string; email?: string | null; phone?: string | null };
  /** Rail hint, e.g. 'mobile_money' | 'card' | 'bank_transfer'. */
  method?: string;
  metadata?: Record<string, string>;
}

export interface PaymentResult {
  id: string;
  provider: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amountMinor: number;
  currency: string;
  reference: string;
  /** Where to send the payer to complete the payment, when applicable. */
  redirectUrl?: string;
  /** True when no real money movement occurred. */
  simulated: boolean;
  raw?: Record<string, unknown>;
  failureReason?: string;
}

export interface RefundRequest {
  paymentId: string;
  amountMinor: number;
  reason?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly simulated: boolean;
  /** Rails this provider can service, used to filter options per country. */
  supportedMethods(country: string): string[];
  createPayment(request: PaymentIntentRequest): Promise<PaymentResult>;
  verifyPayment(paymentId: string): Promise<PaymentResult>;
  refundPayment(request: RefundRequest): Promise<PaymentResult>;
  getPaymentStatus(paymentId: string): Promise<PaymentResult['status']>;
}

/**
 * Deterministic in-memory provider for development and tests.
 * Payments succeed immediately; nothing leaves the process.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly simulated = true;

  private readonly store = new Map<string, PaymentResult>();

  supportedMethods(): string[] {
    return ['cash', 'mobile_money', 'bank_transfer', 'card'];
  }

  async createPayment(request: PaymentIntentRequest): Promise<PaymentResult> {
    const result: PaymentResult = {
      id: `mock_${randomUUID()}`,
      provider: this.name,
      status: 'succeeded',
      amountMinor: request.amountMinor,
      currency: request.currency,
      reference: request.reference,
      simulated: true,
      raw: { note: 'Simulated payment — no funds were moved.' },
    };
    this.store.set(result.id, result);
    return result;
  }

  async verifyPayment(paymentId: string): Promise<PaymentResult> {
    const found = this.store.get(paymentId);
    if (!found) throw new PaymentProviderError('not_found', `Unknown payment ${paymentId}`);
    return found;
  }

  async refundPayment(request: RefundRequest): Promise<PaymentResult> {
    const found = this.store.get(request.paymentId);
    if (!found) throw new PaymentProviderError('not_found', `Unknown payment ${request.paymentId}`);
    const refunded: PaymentResult = { ...found, status: 'refunded', amountMinor: request.amountMinor };
    this.store.set(request.paymentId, refunded);
    return refunded;
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentResult['status']> {
    return (await this.verifyPayment(paymentId)).status;
  }
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/**
 * Adapters for live providers land here. They are intentionally absent rather
 * than stubbed: a stub that silently no-ops would let the product pretend a
 * payment succeeded, which is exactly what we refuse to do.
 */
const REGISTRY: Record<string, () => PaymentProvider> = {
  mock: () => new MockPaymentProvider(),
};

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  const factory = REGISTRY[env.PAYMENT_PROVIDER];
  if (!factory) {
    throw new PaymentProviderError(
      'not_implemented',
      `Payment provider "${env.PAYMENT_PROVIDER}" has no adapter yet. ` +
        `Implement PaymentProvider in packages/integrations/src/payments.ts and register it.`,
    );
  }
  cached = factory();
  return cached;
}

export function resetPaymentProviderForTesting(): void {
  cached = null;
}
