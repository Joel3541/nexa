/**
 * Model pricing and cost estimation.
 *
 * Costs are carried as **integer micro-USD** (1 USD = 1,000,000 µUSD) for the
 * same reason money is carried in minor units everywhere else in NEXA: a
 * business's AI spend should never drift because of binary floating point. A
 * single Haiku turn can cost less than a hundredth of a cent, so cents are too
 * coarse a unit to accumulate in — micro-dollars keep a month of turns exact.
 *
 * These rates are Anthropic first-party API list prices per million tokens.
 * They are used for *estimation and budgeting only* — the authoritative figure
 * is always the invoice from the provider. NEXA never presents an estimated
 * cost as a billed amount.
 */

const MICRO_USD_PER_USD = 1_000_000;

export interface ModelRate {
  /** µUSD per input token. */
  input: number;
  /** µUSD per output token. */
  output: number;
  /** µUSD per token written to the prompt cache (1.25x input). */
  cacheWrite: number;
  /** µUSD per token read from the prompt cache (0.1x input). */
  cacheRead: number;
  contextWindow: number;
}

/** Builds a rate from the published per-million-token dollar prices. */
function rate(inputPerM: number, outputPerM: number, contextWindow: number): ModelRate {
  const input = (inputPerM * MICRO_USD_PER_USD) / 1_000_000;
  return {
    input,
    output: (outputPerM * MICRO_USD_PER_USD) / 1_000_000,
    cacheWrite: input * 1.25,
    cacheRead: input * 0.1,
    contextWindow,
  };
}

/**
 * Known models, cheapest first within a tier. An unknown model is not an error:
 * `estimateCost` falls back to the most expensive known rate so that a budget
 * can never be silently overshot by a model we have not priced yet.
 */
export const MODEL_RATES: Record<string, ModelRate> = {
  'claude-haiku-4-5': rate(1, 5, 200_000),
  'claude-sonnet-4-6': rate(3, 15, 1_000_000),
  'claude-sonnet-5': rate(3, 15, 1_000_000),
  'claude-opus-4-6': rate(5, 25, 1_000_000),
  'claude-opus-4-7': rate(5, 25, 1_000_000),
  'claude-opus-4-8': rate(5, 25, 1_000_000),
  'claude-opus-5': rate(5, 25, 1_000_000),
  'claude-fable-5': rate(10, 50, 1_000_000),
};

const FALLBACK_RATE = MODEL_RATES['claude-fable-5']!;

export function getModelRate(model: string): ModelRate {
  return MODEL_RATES[model] ?? FALLBACK_RATE;
}

export function isKnownModel(model: string): boolean {
  return model in MODEL_RATES;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

/**
 * Estimated cost of one turn, in micro-USD.
 *
 * Cache reads and writes are priced separately because they differ by an order
 * of magnitude from ordinary input tokens in both directions — treating them as
 * plain input would overstate a cache-heavy workload's cost roughly tenfold.
 */
export function estimateCostMicros(model: string, usage: TokenUsage): number {
  const r = getModelRate(model);
  const total =
    usage.inputTokens * r.input +
    usage.outputTokens * r.output +
    (usage.cacheWriteTokens ?? 0) * r.cacheWrite +
    (usage.cacheReadTokens ?? 0) * r.cacheRead;
  return Math.round(total);
}

/** Formats micro-USD for display. Sub-cent amounts keep four decimals. */
export function formatMicros(micros: number): string {
  const dollars = micros / MICRO_USD_PER_USD;
  if (dollars === 0) return '$0.00';
  if (Math.abs(dollars) < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

export { MICRO_USD_PER_USD };
