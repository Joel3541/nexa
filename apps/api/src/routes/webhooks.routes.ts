import { Router } from 'express';
import express from 'express';
import { handler } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { applyPaymentWebhook } from '../services/checkout.service.js';

/**
 * Public webhook endpoints.
 *
 * Mounted *outside* `/api` and *before* the JSON body parser, because
 * signature verification needs the exact bytes the gateway signed. Once
 * `express.json()` has parsed and discarded the raw buffer, the signature can
 * no longer be checked — and an unverifiable payment webhook is worthless.
 *
 * There is no authentication here by design: the signature *is* the
 * authentication. Nothing in this router trusts the request until
 * `applyPaymentWebhook` has verified it.
 */
export const webhookRouter: Router = Router();

webhookRouter.post(
  '/payments',
  // Raw, capped. The parser must run before anything else touches the body.
  express.raw({ type: '*/*', limit: '512kb' }),
  handler(async (req, res) => {
    const outcome = await applyPaymentWebhook({
      body: req.body as Buffer,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    logger.info('payment webhook', { handled: outcome.handled, reason: outcome.reason });

    // Always 200 once the signature verified. A gateway retries anything else,
    // and there is nothing to gain from making it retry an event we have
    // already handled or deliberately ignored.
    res.status(200).json({ received: true, ...outcome });
  }),
);
