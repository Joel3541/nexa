/**
 * The payment contract, isolated from every implementation of it.
 *
 * Adapters depend on this file; the registry depends on the adapters. Keeping
 * the contract in its own module is what stops that from becoming a cycle —
 * and it means a reader can see the entire surface a new market's payment rail
 * has to satisfy without reading a single adapter.
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

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/** A verified, provider-agnostic webhook event. */
export interface PaymentWebhookEvent {
  provider: string;
  /** Provider's own event name, e.g. 'charge.success'. */
  type: string;
  /** The reference NEXA generated when the payment was created. */
  reference: string | null;
  status: PaymentResult['status'];
  amountMinor: number | null;
  currency: string | null;
  raw: Record<string, unknown>;
}
