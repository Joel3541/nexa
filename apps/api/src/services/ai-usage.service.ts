import { formatMicros, MICRO_USD_PER_USD } from '@nexa/ai';
import { env } from '@nexa/config';
import { aiMessages, getDb } from '@nexa/database';
import { and, eq, gte, sql } from 'drizzle-orm';
import { inBusiness } from '../db/scope.js';
import { AppError } from '../lib/errors.js';

/**
 * AI spend accounting and the monthly guard rail.
 *
 * Two things this is *not*: it is not billing (the provider's invoice is the
 * only authoritative number), and it is not a per-user quota (that is the job
 * of the per-user rate limit on the chat route). It exists so that one runaway
 * tenant — a scripted loop, a pathological conversation — cannot quietly spend
 * an unbounded amount of someone else's money before anybody notices.
 */

export interface AiUsageSummary {
  /** First instant of the current calendar month, UTC. */
  periodStart: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costMicros: number;
  costDisplay: string;
  /** Configured ceiling in micro-USD, or null when uncapped. */
  budgetMicros: number | null;
  /** 0–1 against the budget. null when uncapped. */
  utilisation: number | null;
  exceeded: boolean;
}

/** Start of the current calendar month in UTC. */
export function currentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function budgetMicros(): number | null {
  return env.AI_MONTHLY_BUDGET_CENTS > 0 ? env.AI_MONTHLY_BUDGET_CENTS * 10_000 : null;
}

export async function getUsageSummary(businessId: string, now = new Date()): Promise<AiUsageSummary> {
  const db = await getDb();
  const periodStart = currentPeriodStart(now);

  // Assistant rows only. Every turn writes two rows — the question and the
  // answer — but only the answer carries tokens and cost. Counting both would
  // report double the turns actually billed.
  const [row] = await db
    .select({
      messages: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiMessages.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiMessages.outputTokens}), 0)::int`,
      cacheReadTokens: sql<number>`coalesce(sum(${aiMessages.cacheReadTokens}), 0)::int`,
      costMicros: sql<number>`coalesce(sum(${aiMessages.costMicros}), 0)::bigint`,
    })
    .from(aiMessages)
    .where(
      and(
        inBusiness(aiMessages, businessId),
        eq(aiMessages.role, 'assistant'),
        gte(aiMessages.createdAt, periodStart),
      ),
    );

  // bigint arrives as a string from the driver; a month of AI spend is nowhere
  // near Number.MAX_SAFE_INTEGER, so this is safe to widen.
  const costMicros = Number(row?.costMicros ?? 0);
  const budget = budgetMicros();

  return {
    periodStart: periodStart.toISOString(),
    messages: row?.messages ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    cacheReadTokens: row?.cacheReadTokens ?? 0,
    costMicros,
    costDisplay: formatMicros(costMicros),
    budgetMicros: budget,
    utilisation: budget ? Math.min(1, costMicros / budget) : null,
    exceeded: budget !== null && costMicros >= budget,
  };
}

/**
 * Refuses a turn when the business is already over its monthly ceiling.
 *
 * Checked *before* the request rather than after, because a post-hoc check has
 * already spent the money. The overshoot is therefore bounded by one turn, not
 * by however long it takes someone to look at a dashboard.
 */
export async function assertWithinBudget(businessId: string, now = new Date()): Promise<void> {
  const budget = budgetMicros();
  if (budget === null) return;

  const summary = await getUsageSummary(businessId, now);
  if (!summary.exceeded) return;

  throw new AppError(
    429,
    'ai_budget_exceeded',
    `This workspace has reached its AI budget for the month (${summary.costDisplay} of ${formatMicros(budget)}). ` +
      `Access resets at the start of next month, or an administrator can raise the limit.`,
  );
}

export { MICRO_USD_PER_USD };
