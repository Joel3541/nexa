import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addUsage,
  emptyUsage,
  estimateCostMicros,
  formatMicros,
  getModelRate,
  isKnownModel,
  MICRO_USD_PER_USD,
} from '@nexa/ai';
import { createWorkspace, startTestServer, useTestServer } from './helpers.js';

/**
 * AI cost accounting.
 *
 * A business owner deciding whether to leave the assistant switched on needs to
 * trust the number it reports. These tests pin the arithmetic and the reporting
 * surface — an over- or under-count here would be invisible until an invoice
 * arrived and contradicted the dashboard.
 */
describe('AI cost accounting', () => {
  useTestServer();

  it('prices a turn from published per-million-token rates', () => {
    // Opus 5 is $5/MTok in, $25/MTok out.
    const cost = estimateCostMicros('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 });
    assert.equal(cost, 5 * MICRO_USD_PER_USD);

    const out = estimateCostMicros('claude-opus-5', { inputTokens: 0, outputTokens: 1_000_000 });
    assert.equal(out, 25 * MICRO_USD_PER_USD);
  });

  it('charges cache reads at a tenth of input and writes at 1.25x', () => {
    const rate = getModelRate('claude-opus-5');
    const read = estimateCostMicros('claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    const write = estimateCostMicros('claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    assert.equal(read, Math.round(1_000_000 * rate.input * 0.1));
    assert.equal(write, Math.round(1_000_000 * rate.input * 1.25));
    // The whole point of caching: a cached prefix must be far cheaper to re-send.
    assert.ok(read * 10 <= write);
  });

  it('over-estimates rather than under-estimates an unpriced model', () => {
    assert.equal(isKnownModel('some-future-model'), false);
    const unknown = estimateCostMicros('some-future-model', { inputTokens: 1000, outputTokens: 1000 });
    const cheapest = estimateCostMicros('claude-haiku-4-5', { inputTokens: 1000, outputTokens: 1000 });
    // A budget guard that guesses low on an unknown model is worse than useless.
    assert.ok(unknown > cheapest);
  });

  it('sums usage across every round trip in a turn, not just the last', () => {
    let total = emptyUsage();
    total = addUsage(total, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 1000,
    });
    total = addUsage(total, {
      inputTokens: 300,
      outputTokens: 50,
      cacheReadTokens: 90,
      cacheWriteTokens: 0,
      costMicros: 2500,
    });
    total = addUsage(total, undefined);

    assert.equal(total.inputTokens, 400);
    assert.equal(total.outputTokens, 70);
    assert.equal(total.cacheReadTokens, 90);
    assert.equal(total.costMicros, 3500);
  });

  it('keeps sub-cent amounts legible instead of rounding them to zero', () => {
    // A single cheap turn costs well under a cent. "$0.00" would tell an owner
    // nothing about whether usage is growing.
    assert.equal(formatMicros(0), '$0.00');
    assert.equal(formatMicros(1200), '$0.0012');
    assert.equal(formatMicros(2_500_000), '$2.50');
  });

  it('reports month-to-date usage scoped to the calling business', async () => {
    const base = await startTestServer();
    const a = await createWorkspace(base);
    const b = await createWorkspace(base);

    await a.client.post('/api/ai/chat', { message: 'How is the business doing?' });
    await a.client.post('/api/ai/chat', { message: 'What is overdue?' });

    const usageA = await a.client.get('/api/ai/usage');
    const usageB = await b.client.get('/api/ai/usage');

    assert.equal(usageA.status, 200);
    assert.equal(usageA.body.messages, 2, 'each turn should be counted once');
    assert.equal(usageB.body.messages, 0, "another business's turns must not appear here");
    assert.equal(typeof usageA.body.costDisplay, 'string');
    assert.equal(usageA.body.periodStart.slice(8, 10), '01', 'the period starts on the first of the month');
  });

  it('reports no ceiling when none is configured', async () => {
    const base = await startTestServer();
    const workspace = await createWorkspace(base);
    const usage = await workspace.client.get('/api/ai/usage');
    // The test environment leaves AI_MONTHLY_BUDGET_CENTS at 0.
    assert.equal(usage.body.budgetMicros, null);
    assert.equal(usage.body.utilisation, null);
    assert.equal(usage.body.exceeded, false);
  });
});
