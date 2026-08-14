import { randomUUID } from 'node:crypto';
import { env } from '@nexa/config';
import {
  PaymentProviderError,
  type PaymentIntentRequest,
  type PaymentProvider,
  type PaymentResult,
  type RefundRequest,
} from './payment-contract.js';
import { PaystackProvider } from './paystack.js';
import { StripeProvider } from './stripe.js';

/**
 * Payment provider registry.
 *
 * Business logic never imports Stripe or Paystack directly. It depends on the
 * `PaymentProvider` contract, so adding a market's payment rail is a new
 * adapter plus a config value — no changes to orders, invoices or reporting.
 *
 * `MockPaymentProvider` is explicitly a *development* adapter: every result it
 * returns is flagged `simulated: true` and the UI labels it as such. NEXA never
 * claims that money moved when it did not.
 */

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

/**
 * Live adapters. Each factory is only invoked for the configured provider, and
 * each adapter validates its credentials in its constructor — so a workspace on
 * `mock` never trips a check for keys it does not have.
 *
 * There is deliberately no stub adapter: one that silently reported success
 * would let the product claim money moved when it did not.
 */
const REGISTRY: Record<string, () => PaymentProvider> = {
  mock: () => new MockPaymentProvider(),
  paystack: () => new PaystackProvider(),
  stripe: () => new StripeProvider(),
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
