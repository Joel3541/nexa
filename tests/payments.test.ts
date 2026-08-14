import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { verifyPaystackSignature, verifyStripeSignature } from '@nexa/integrations';

/**
 * Payment webhook signature verification.
 *
 * This is the security boundary of the whole payments integration. A payment
 * webhook is an unauthenticated public endpoint that says "this invoice was
 * paid" — if the signature check is wrong in any direction, anyone who finds
 * the URL can settle invoices for free.
 *
 * These tests exist to make each individual failure mode impossible to
 * reintroduce, because every one of them is a silent vulnerability rather than
 * a visible bug: the happy path keeps working either way.
 */
describe('payment webhook signatures', () => {
  const secret = 'sk_test_secret_value';
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'nexa_abc', amount: 5000 } });

  describe('paystack', () => {
    const sign = (payload: string) => createHmac('sha512', secret).update(payload).digest('hex');

    it('accepts a correctly signed body', () => {
      assert.equal(verifyPaystackSignature(body, sign(body), secret), true);
    });

    it('rejects a body that was altered after signing', () => {
      const signature = sign(body);
      const tampered = body.replace('5000', '500000');
      assert.equal(verifyPaystackSignature(tampered, signature, secret), false);
    });

    it('rejects a signature made with a different secret', () => {
      const forged = createHmac('sha512', 'attacker-guess').update(body).digest('hex');
      assert.equal(verifyPaystackSignature(body, forged, secret), false);
    });

    it('rejects an absent signature rather than treating it as optional', () => {
      assert.equal(verifyPaystackSignature(body, '', secret), false);
    });

    it('rejects a truncated signature instead of throwing', () => {
      // timingSafeEqual throws on a length mismatch; the guard must catch that
      // before it becomes a 500 that a gateway then retries forever.
      assert.equal(verifyPaystackSignature(body, sign(body).slice(0, 20), secret), false);
    });

    it('verifies the exact bytes, not the parsed object', () => {
      const signature = sign(body);
      // Same data, different serialisation — this is what happens if the body
      // is parsed and re-stringified before verification.
      const reserialised = JSON.stringify(JSON.parse(body), null, 2);
      assert.equal(verifyPaystackSignature(reserialised, signature, secret), false);
    });
  });

  describe('stripe', () => {
    const nowMs = 1_800_000_000_000;
    const timestamp = Math.floor(nowMs / 1000);
    const sign = (ts: number, payload: string) =>
      createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');

    it('accepts a correctly signed, current request', () => {
      const header = `t=${timestamp},v1=${sign(timestamp, body)}`;
      assert.equal(verifyStripeSignature(body, header, secret, 300, nowMs), true);
    });

    it('accepts when any one of several v1 signatures matches', () => {
      // Stripe sends multiple signatures while an endpoint secret is rolling.
      const header = `t=${timestamp},v1=${'0'.repeat(64)},v1=${sign(timestamp, body)}`;
      assert.equal(verifyStripeSignature(body, header, secret, 300, nowMs), true);
    });

    it('rejects a replayed request that is older than the tolerance', () => {
      const old = timestamp - 10_000;
      const header = `t=${old},v1=${sign(old, body)}`;
      // Correctly signed, but captured last week — must not settle an invoice.
      assert.equal(verifyStripeSignature(body, header, secret, 300, nowMs), false);
    });

    it('rejects a signature computed without the timestamp prefix', () => {
      const naive = createHmac('sha256', secret).update(body).digest('hex');
      const header = `t=${timestamp},v1=${naive}`;
      assert.equal(verifyStripeSignature(body, header, secret, 300, nowMs), false);
    });

    it('rejects a header with no v1 entry', () => {
      assert.equal(verifyStripeSignature(body, `t=${timestamp}`, secret, 300, nowMs), false);
    });

    it('rejects a malformed header rather than throwing', () => {
      assert.equal(verifyStripeSignature(body, 'garbage', secret, 300, nowMs), false);
      assert.equal(verifyStripeSignature(body, '', secret, 300, nowMs), false);
    });
  });
});
