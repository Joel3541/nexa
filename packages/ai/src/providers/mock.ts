import { formatMoney } from '@nexa/config';
import type { AiProvider, StepInput, StepOutput, ToolCallOutcome, ToolCallRequest } from '../provider.js';
import type {
  BusinessSummaryResult,
  CustomersResult,
  ExpensesResult,
  InvoicesResult,
  LowStockResult,
  OverdueInvoicesResult,
  ProposalResult,
  RevenueResult,
  SalesAnalysisResult,
  SegmentAnalysisResult,
} from '../results.js';

/**
 * MockAiProvider — the development AI adapter.
 *
 * This is NOT a canned-response stub. It classifies the question, calls the
 * *real* tools against the *real* database, and composes its answer strictly
 * from those results. Every number it prints came out of Postgres.
 *
 * What it does not do is reason freely — it recognises a fixed set of business
 * intents. That is the honest trade: deterministic and grounded, but narrow.
 * Set AI_PROVIDER=anthropic to swap in open-ended reasoning over the same tools.
 */

interface Ctx {
  currency: string;
  locale: string;
  businessName: string;
  userName: string;
}

interface Intent {
  id: string;
  /** Keyword groups: every group must match at least one keyword. */
  all?: string[][];
  any: string[];
  weight?: number;
  plan: (text: string) => ToolCallRequest[];
  compose: (results: Map<string, ToolCallOutcome>, ctx: Ctx, text: string) => string;
}

let callSeq = 0;
const call = (name: string, input: Record<string, unknown> = {}): ToolCallRequest => ({
  id: `mock_${Date.now().toString(36)}_${(callSeq += 1)}`,
  name,
  input,
});

function money(minor: number, ctx: Ctx): string {
  return formatMoney(minor, ctx.currency, { locale: ctx.locale });
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return `${rounded}%`;
}

function direction(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'flat';
  if (value > 0.5) return 'up';
  if (value < -0.5) return 'down';
  return 'flat';
}

function get<T>(results: Map<string, ToolCallOutcome>, name: string): T | null {
  const outcome = results.get(name);
  if (!outcome || !outcome.ok) return null;
  return outcome.data as T;
}

function list(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join('\n');
}

function daysAgo(days: number | null): string {
  if (days === null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** Extracts a day count from phrases like "90 days", "60+ days", "3 months". */
function extractDays(text: string, fallback: number): number {
  const monthMatch = /(\d{1,2})\s*month/.exec(text);
  if (monthMatch?.[1]) return Number(monthMatch[1]) * 30;
  const dayMatch = /(\d{1,3})\s*\+?\s*day/.exec(text);
  if (dayMatch?.[1]) return Number(dayMatch[1]);
  return fallback;
}

/**
 * Turns "create a task to call John tomorrow" into "Call John tomorrow".
 * Deterministic and lossy — the production provider phrases this properly.
 */
function extractTaskTitle(text: string): string {
  const cleaned = text
    .replace(/^(please\s+)?(can you\s+)?(create|add|make|set up|set)\s+(a\s+|an\s+)?(new\s+)?(task|reminder|to-?do)\s*/i, '')
    .replace(/^(to|for|that says|saying|called|named)\s+/i, '')
    .replace(/^me\s+to\s+/i, '')
    .trim();
  const title = (cleaned || text).replace(/\s+/g, ' ').slice(0, 200);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function extractLimit(text: string, fallback: number): number {
  const match = /\btop\s+(\d{1,3})\b/.exec(text) ?? /\b(\d{1,3})\s+(?:best|biggest|largest)\b/.exec(text);
  return match?.[1] ? Math.min(Number(match[1]), 50) : fallback;
}

/* -------------------------------------------------------------------------- */
/* Intents                                                                     */
/* -------------------------------------------------------------------------- */

const INTENTS: Intent[] = [
  {
    id: 'overdue_follow_up_tasks',
    all: [['task', 'follow up', 'follow-up', 'chase', 'remind']],
    any: ['overdue', 'unpaid', 'owe', 'owes', 'outstanding'],
    weight: 3,
    plan: () => [call('get_overdue_invoices', { limit: 25 }), call('create_task', { forEachOverdueInvoice: true })],
    compose: (results, ctx) => {
      const overdue = get<OverdueInvoicesResult>(results, 'get_overdue_invoices');
      const proposal = get<ProposalResult>(results, 'create_task');
      if (!overdue || overdue.count === 0) {
        return 'Good news — you have no overdue invoices right now, so there is nothing to chase.';
      }
      const lines = overdue.invoices
        .slice(0, 6)
        .map((inv) => `${inv.customerName} — ${inv.number}, ${money(inv.balanceMinor, ctx)}, ${inv.daysOverdue} days overdue`);
      return [
        `You have ${overdue.count} overdue ${plural(overdue.count, 'invoice')} worth ${money(overdue.totalOverdueMinor, ctx)}. The oldest is ${overdue.oldestDays} days past due.`,
        '',
        list(lines),
        overdue.count > 6 ? `\n…and ${overdue.count - 6} more.` : '',
        '',
        proposal
          ? `I have prepared ${proposal.itemCount ?? overdue.count} follow-up ${plural(proposal.itemCount ?? overdue.count, 'task')} — one per overdue invoice — for your approval. Nothing has been created yet.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    id: 'create_task',
    all: [['create', 'add', 'make', 'set', 'remind']],
    any: ['task', 'to-do', 'todo', 'reminder'],
    weight: 2,
    plan: (text) => [call('create_task', { title: extractTaskTitle(text), priority: 'medium' })],
    compose: (results) => {
      const proposal = get<ProposalResult>(results, 'create_task');
      if (!proposal) return 'I could not prepare that task. Tell me the title and when it should be done.';
      return `${proposal.actionLabel}.\n\n${proposal.detail}\n\nI have prepared this task for your approval — it has not been created yet.`;
    },
  },
  {
    id: 'campaign',
    any: ['campaign', 'reactivation', 'win back', 'win-back', 'promotion', 'blast', 'newsletter', 'market to'],
    weight: 2,
    plan: (text) => [
      call('get_customers', { segment: 'inactive', inactiveDays: extractDays(text, 60), limit: 50 }),
      call('analyze_customer_segments', {}),
      call('create_campaign_draft', { segment: 'inactive', inactiveDays: extractDays(text, 60) }),
    ],
    compose: (results, ctx) => {
      const customers = get<CustomersResult>(results, 'get_customers');
      const proposal = get<ProposalResult>(results, 'create_campaign_draft');
      if (!customers || customers.count === 0) {
        return 'I could not find a group of inactive customers to build a campaign around — everyone has bought recently.';
      }
      const top = customers.customers
        .slice(0, 5)
        .map((c) => `${c.name} — ${money(c.totalSpentMinor, ctx)} lifetime, last bought ${daysAgo(c.daysSinceLastPurchase)}`);
      return [
        `I found ${customers.count} inactive ${plural(customers.count, 'customer')} who together spent ${money(customers.combinedSpendMinor, ctx)} with you historically. That is the revenue at risk.`,
        '',
        'Highest value in that group:',
        list(top),
        '',
        proposal
          ? `${proposal.detail}\n\nThe draft is ready for your review and approval. Nothing will be sent until you approve it.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    id: 'inactive_customers',
    any: ["haven't bought", 'have not bought', 'inactive', 'lapsed', 'stopped buying', 'not purchased', "haven't purchased", 'dormant', 'gone quiet'],
    weight: 2,
    plan: (text) => [call('get_customers', { segment: 'inactive', inactiveDays: extractDays(text, 60), limit: 25 })],
    compose: (results, ctx, text) => {
      const customers = get<CustomersResult>(results, 'get_customers');
      if (!customers) return 'I could not retrieve your customer list just now.';
      const days = extractDays(text, 60);
      if (customers.count === 0) return `Every customer has purchased within the last ${days} days. Nothing lapsing.`;
      const rows = customers.customers
        .slice(0, 10)
        .map((c) => `${c.name}${c.phone ? ` (${c.phone})` : ''} — ${money(c.totalSpentMinor, ctx)} across ${c.orderCount} ${plural(c.orderCount, 'order')}, last ${daysAgo(c.daysSinceLastPurchase)}`);
      return [
        `${customers.count} ${plural(customers.count, 'customer')} ${customers.count === 1 ? 'has' : 'have'} not purchased in over ${days} days. Their combined lifetime spend is ${money(customers.combinedSpendMinor, ctx)}.`,
        '',
        list(rows),
        customers.count > 10 ? `\n…and ${customers.count - 10} more.` : '',
        '',
        'Want me to draft a reactivation campaign for this group?',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    id: 'owes_money',
    any: ['owe', 'owes', 'owing', 'debt', 'unpaid', 'overdue', 'outstanding', 'receivable', 'not paid', 'collect'],
    weight: 1,
    plan: () => [call('get_overdue_invoices', { limit: 25 }), call('get_invoices', { status: 'unpaid', limit: 25 })],
    compose: (results, ctx) => {
      const overdue = get<OverdueInvoicesResult>(results, 'get_overdue_invoices');
      const invoices = get<InvoicesResult>(results, 'get_invoices');
      if (!overdue && !invoices) return 'I could not retrieve your invoices just now.';
      const parts: string[] = [];
      if (invoices) {
        parts.push(
          `You are owed ${money(invoices.outstandingMinor, ctx)} in total across ${invoices.count} open ${plural(invoices.count, 'invoice')}.`,
        );
      }
      if (overdue && overdue.count > 0) {
        parts.push(
          `${money(overdue.totalOverdueMinor, ctx)} of that is already overdue — ${overdue.count} ${plural(overdue.count, 'invoice')}, oldest ${overdue.oldestDays} days past due.`,
          '',
          list(
            overdue.invoices
              .slice(0, 8)
              .map((inv) => `${inv.customerName} — ${inv.number}, ${money(inv.balanceMinor, ctx)}, ${inv.daysOverdue} days late`),
          ),
          '',
          'Shall I prepare a follow-up task for each of these?',
        );
      } else if (overdue) {
        parts.push('Nothing is overdue yet — every open invoice is still within terms.');
      }
      return parts.filter(Boolean).join('\n');
    },
  },
  {
    id: 'why_revenue_changed',
    all: [['why', 'reason', 'explain', 'what happened', 'cause']],
    any: ['revenue', 'sales', 'income', 'turnover', 'down', 'fell', 'drop', 'dropped', 'lower', 'decline', 'up', 'rose'],
    weight: 3,
    plan: () => [
      call('get_revenue', { period: 'last_30_days', compare: true }),
      call('analyze_sales', { period: 'last_30_days' }),
      call('analyze_customer_segments', {}),
    ],
    compose: (results, ctx) => {
      const revenue = get<RevenueResult>(results, 'get_revenue');
      const sales = get<SalesAnalysisResult>(results, 'analyze_sales');
      const segments = get<SegmentAnalysisResult>(results, 'analyze_customer_segments');
      if (!revenue) return 'I could not retrieve revenue figures just now.';
      const dir = direction(revenue.changePercent);
      const parts: string[] = [
        `Revenue over the last 30 days is ${money(revenue.totalMinor, ctx)}, ${dir === 'flat' ? 'roughly level with' : `${pct(revenue.changePercent)} ${dir} on`} the previous 30 days (${money(revenue.previousTotalMinor, ctx)}).`,
      ];
      if (sales) {
        const orderShift =
          revenue.orderCount !== revenue.previousOrderCount
            ? `Order count moved from ${revenue.previousOrderCount} to ${revenue.orderCount}, with an average order of ${money(revenue.averageOrderMinor, ctx)}.`
            : `Order count held at ${revenue.orderCount}, average order ${money(revenue.averageOrderMinor, ctx)}.`;
        parts.push('', orderShift);

        const repeatDelta = sales.repeatRevenueMinor - sales.previousRepeatRevenueMinor;
        if (sales.previousRepeatRevenueMinor > 0) {
          const repeatPct = (repeatDelta / sales.previousRepeatRevenueMinor) * 100;
          parts.push(
            `Returning-customer revenue is ${money(sales.repeatRevenueMinor, ctx)} versus ${money(sales.previousRepeatRevenueMinor, ctx)} before — ${pct(repeatPct)} ${direction(repeatPct)}. New-customer revenue is ${money(sales.newCustomerRevenueMinor, ctx)}.`,
          );
        }
        if (sales.decliningProducts.length > 0) {
          parts.push(
            '',
            'Products pulling the number down:',
            list(
              sales.decliningProducts
                .slice(0, 4)
                .map((p) => `${p.name} — ${p.unitsSold} sold vs ${p.previousUnitsSold} previously (${pct(p.changePercent)} down)`),
            ),
          );
        }
        if (sales.risingProducts.length > 0) {
          parts.push(
            '',
            'Holding it up:',
            list(
              sales.risingProducts
                .slice(0, 3)
                .map((p) => `${p.name} — ${p.unitsSold} sold vs ${p.previousUnitsSold} previously`),
            ),
          );
        }
      }
      if (segments && segments.inactive.count > 0) {
        parts.push(
          '',
          `${segments.inactive.count} customers have gone quiet, representing ${money(segments.inactive.valueAtRiskMinor, ctx)} of historic spend. That is the single biggest lever you have this month.`,
        );
      }
      return parts.join('\n');
    },
  },
  {
    id: 'focus_today',
    any: ['focus', 'today', 'priority', 'priorities', 'what should i', 'most important', 'attention', 'right now'],
    weight: 1,
    plan: () => [
      call('get_business_summary', {}),
      call('get_overdue_invoices', { limit: 10 }),
      call('get_low_stock_products', { limit: 10 }),
    ],
    compose: (results, ctx) => {
      const summary = get<BusinessSummaryResult>(results, 'get_business_summary');
      const overdue = get<OverdueInvoicesResult>(results, 'get_overdue_invoices');
      const lowStock = get<LowStockResult>(results, 'get_low_stock_products');
      if (!summary) return 'I could not load your business summary just now.';

      const items: Array<{ weight: number; text: string }> = [];
      if (overdue && overdue.count > 0) {
        items.push({
          weight: overdue.totalOverdueMinor,
          text: `Collect ${money(overdue.totalOverdueMinor, ctx)} sitting in ${overdue.count} overdue ${plural(overdue.count, 'invoice')} — the oldest is ${overdue.oldestDays} days past due. This is cash you have already earned.`,
        });
      }
      if (lowStock && lowStock.count > 0) {
        const urgent = lowStock.products.filter((p) => p.daysRemaining !== null && p.daysRemaining <= 10);
        if (urgent.length > 0) {
          const worst = urgent[0]!;
          items.push({
            weight: 500_00,
            text: `Reorder stock. ${worst.name} has ${worst.quantity} left and, at ${worst.dailyVelocity.toFixed(1)} units/day over the last 30 days, is projected to run out in about ${worst.daysRemaining} days (${worst.confidence} confidence).${urgent.length > 1 ? ` ${urgent.length - 1} other ${plural(urgent.length - 1, 'product')} are in the same position.` : ''}`,
          });
        }
      }
      if (summary.openTaskCount > 0) {
        items.push({ weight: 100_00, text: `Clear ${summary.openTaskCount} open ${plural(summary.openTaskCount, 'task')}.` });
      }
      if (summary.upcomingAppointmentCount > 0) {
        items.push({
          weight: 90_00,
          text: `You have ${summary.upcomingAppointmentCount} upcoming ${plural(summary.upcomingAppointmentCount, 'appointment')} to prepare for.`,
        });
      }
      items.sort((a, b) => b.weight - a.weight);

      const header = `${summary.periodLabel}: ${money(summary.revenueMinor, ctx)} revenue, ${money(summary.expensesMinor, ctx)} expenses, ${money(summary.profitMinor, ctx)} profit. Business health is ${summary.healthScore}/100 (${summary.healthGrade.replace('_', ' ')}).`;
      if (items.length === 0) {
        return `${header}\n\nNothing is on fire. No overdue invoices, no stock risks, no open tasks. Spend the day on growth instead of admin.`;
      }
      return [
        header,
        '',
        'In priority order:',
        items
          .slice(0, 3)
          .map((item, index) => `${index + 1}. ${item.text}`)
          .join('\n'),
        '',
        // Repeat the first item verbatim — lowercasing it mangles currency
        // symbols and proper nouns.
        `Start there: ${items[0]!.text.split('.')[0]!}.`,
      ].join('\n');
    },
  },
  {
    id: 'low_stock',
    any: ['stock', 'inventory', 'run out', 'running out', 'reorder', 'restock', 'out of stock', 'low on'],
    weight: 1,
    plan: () => [call('get_low_stock_products', { limit: 20 })],
    compose: (results, ctx) => {
      const lowStock = get<LowStockResult>(results, 'get_low_stock_products');
      if (!lowStock) return 'I could not retrieve inventory just now.';
      if (lowStock.count === 0) return 'No products are below their minimum stock level, and nothing is projected to run out soon.';
      const rows = lowStock.products.map((p) => {
        const projection =
          p.daysRemaining === null
            ? 'no recent sales, so no run-out projection'
            : `~${p.daysRemaining} days of cover left (${p.confidence} confidence, ${p.projectionBasis})`;
        return `${p.name} — ${p.quantity} in stock, minimum ${p.minStock}. Sold ${p.unitsSold30d} in 30 days → ${projection}`;
      });
      return [
        `${lowStock.count} ${plural(lowStock.count, 'product')} ${lowStock.count === 1 ? 'needs' : 'need'} attention:`,
        '',
        list(rows),
        '',
        'Projections assume the last 30 days of demand continues. They are estimates, not guarantees.',
      ].join('\n');
    },
  },
  {
    id: 'top_customers',
    all: [['customer', 'customers', 'client', 'clients', 'buyer', 'buyers']],
    any: ['best', 'top', 'biggest', 'most valuable', 'vip', 'highest', 'loyal'],
    weight: 3,
    plan: (text) => [call('get_customers', { sort: 'spend', limit: extractLimit(text, 10) })],
    compose: (results, ctx) => {
      const customers = get<CustomersResult>(results, 'get_customers');
      if (!customers || customers.count === 0) return 'You do not have any customers with recorded purchases yet.';
      const rows = customers.customers.map(
        (c, i) =>
          `${i + 1}. ${c.name} — ${money(c.totalSpentMinor, ctx)} across ${c.orderCount} ${plural(c.orderCount, 'order')}, last purchase ${daysAgo(c.daysSinceLastPurchase)}${c.outstandingMinor > 0 ? `, owes ${money(c.outstandingMinor, ctx)}` : ''}`,
      );
      const share =
        customers.totalCount > 0 ? Math.round((customers.count / customers.totalCount) * 100) : 0;
      return [
        `Your top ${customers.count} customers by lifetime spend. Together they account for ${money(customers.combinedSpendMinor, ctx)} — from ${share}% of your customer base.`,
        '',
        rows.join('\n'),
      ].join('\n');
    },
  },
  {
    id: 'top_products',
    all: [['product', 'products', 'item', 'items', 'service', 'services', 'selling', 'sell', 'sells']],
    any: ['best', 'top', 'fastest', 'most', 'popular', 'biggest', 'profitable'],
    weight: 3,
    plan: () => [call('analyze_sales', { period: 'last_30_days' })],
    compose: (results, ctx) => {
      const sales = get<SalesAnalysisResult>(results, 'analyze_sales');
      if (!sales || sales.topProducts.length === 0) return 'No sales are recorded in the last 30 days, so there is nothing to rank.';
      const rows = sales.topProducts.map(
        (p, i) => `${i + 1}. ${p.name} — ${p.unitsSold} sold, ${money(p.revenueMinor, ctx)} revenue, ${money(p.profitMinor, ctx)} profit`,
      );
      return [
        `Over the last 30 days you sold ${money(sales.totalRevenueMinor, ctx)} at ${money(sales.totalProfitMinor, ctx)} gross profit${sales.marginPercent !== null ? ` (${pct(sales.marginPercent)} margin)` : ''}.`,
        '',
        rows.join('\n'),
        sales.risingProducts.length > 0
          ? `\nGaining momentum: ${sales.risingProducts.slice(0, 3).map((p) => `${p.name} (${p.previousUnitsSold} → ${p.unitsSold} units)`).join(', ')}.`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    id: 'expenses',
    any: ['expense', 'expenses', 'spending', 'spend', 'cost', 'costs', 'outgoing', 'paying for', 'bills'],
    weight: 1,
    plan: () => [call('get_expenses', { period: 'last_30_days', compare: true })],
    compose: (results, ctx) => {
      const expenses = get<ExpensesResult>(results, 'get_expenses');
      if (!expenses) return 'I could not retrieve expenses just now.';
      if (expenses.totalMinor === 0) return 'No expenses are recorded for the last 30 days.';
      const cats = expenses.byCategory
        .slice(0, 6)
        .map((c) => `${c.category} — ${money(c.amountMinor, ctx)} (${Math.round(c.share)}%)`);
      const largest = expenses.largest
        .slice(0, 3)
        .map((e) => `${e.vendor ?? e.description ?? 'Unlabelled'} — ${money(e.amountMinor, ctx)} on ${new Date(e.spentAt).toLocaleDateString(ctx.locale)}`);
      return [
        `You spent ${money(expenses.totalMinor, ctx)} in the last 30 days, ${pct(expenses.changePercent)} ${direction(expenses.changePercent)} on the previous period (${money(expenses.previousTotalMinor, ctx)}).`,
        '',
        'By category:',
        list(cats),
        '',
        'Largest single expenses:',
        list(largest),
      ].join('\n');
    },
  },
  {
    id: 'performance',
    any: [
      'how did',
      'how is',
      'performance',
      'perform',
      'doing',
      'summary',
      'overview',
      'this month',
      'last month',
      'this week',
      'business',
      'profit',
      'revenue',
      'sales',
      'health',
    ],
    weight: 0,
    plan: () => [call('get_business_summary', {}), call('get_revenue', { period: 'last_30_days', compare: true })],
    compose: (results, ctx) => {
      const summary = get<BusinessSummaryResult>(results, 'get_business_summary');
      const revenue = get<RevenueResult>(results, 'get_revenue');
      if (!summary) return 'I could not load your business summary just now.';
      const parts = [
        `${summary.periodLabel} for ${ctx.businessName}:`,
        '',
        list([
          `Revenue ${money(summary.revenueMinor, ctx)}${summary.revenueChangePercent !== null ? ` — ${pct(summary.revenueChangePercent)} ${direction(summary.revenueChangePercent)} on the previous period` : ''}`,
          `Expenses ${money(summary.expensesMinor, ctx)}`,
          `Profit ${money(summary.profitMinor, ctx)}`,
          `${summary.orderCount} ${plural(summary.orderCount, 'order')}, average ${money(summary.averageOrderMinor, ctx)}`,
          `${summary.newCustomerCount} new ${plural(summary.newCustomerCount, 'customer')}, ${summary.activeCustomerCount} active`,
        ]),
      ];
      if (revenue?.bestDay) {
        parts.push('', `Your strongest day was ${new Date(revenue.bestDay.date).toLocaleDateString(ctx.locale)} at ${money(revenue.bestDay.value, ctx)}.`);
      }
      const flags: string[] = [];
      if (summary.overdueInvoiceCount > 0) {
        flags.push(`${money(summary.overdueMinor, ctx)} is overdue across ${summary.overdueInvoiceCount} ${plural(summary.overdueInvoiceCount, 'invoice')}`);
      }
      if (summary.lowStockCount > 0) flags.push(`${summary.lowStockCount} ${plural(summary.lowStockCount, 'product')} below minimum stock`);
      if (flags.length > 0) parts.push('', `Needs attention: ${flags.join('; ')}.`);
      parts.push('', `Business health: ${summary.healthScore}/100 (${summary.healthGrade.replace('_', ' ')}).`);
      return parts.join('\n');
    },
  },
];

function plural(count: number, word: string): string {
  if (count === 1) return word;
  if (word.endsWith('y')) return `${word.slice(0, -1)}ies`;
  if (word.endsWith('s') || word.endsWith('sh') || word.endsWith('ch')) return `${word}es`;
  return `${word}s`;
}

function scoreIntent(intent: Intent, text: string): number {
  if (intent.all) {
    for (const group of intent.all) {
      if (!group.some((keyword) => text.includes(keyword))) return -1;
    }
  }
  const hits = intent.any.filter((keyword) => text.includes(keyword)).length;
  // An `all` match alone is not enough. Without this, "which customers have not
  // bought in 90 days" satisfied the top-customers gate on the word "customers"
  // and outscored the lapsed-customer intent it actually meant.
  if (hits === 0) return -1;
  return hits * 2 + (intent.weight ?? 0) * 3 + (intent.all ? 2 : 0);
}

function selectIntent(text: string): Intent {
  const normalised = text.toLowerCase();
  let best: Intent = INTENTS[INTENTS.length - 1]!;
  let bestScore = -1;
  for (const intent of INTENTS) {
    const score = scoreIntent(intent, normalised);
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  return bestScore <= 0 ? INTENTS[INTENTS.length - 1]! : best;
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;
  readonly model = 'nexa-development-adapter';
  readonly generative = false;

  async step(input: StepInput): Promise<StepOutput> {
    const lastUser = [...input.turns].reverse().find((turn) => turn.role === 'user');
    const question = lastUser && lastUser.role === 'user' ? lastUser.content : '';
    const intent = selectIntent(question);

    const toolResults = input.turns.filter((turn) => turn.role === 'tool_results');
    if (toolResults.length === 0) {
      const allowed = new Set(input.tools.map((tool) => tool.name));
      const planned = intent.plan(question.toLowerCase()).filter((toolCall) => allowed.has(toolCall.name));
      if (planned.length > 0) {
        return { type: 'tool_calls', toolCalls: planned };
      }
      return {
        type: 'final',
        text:
          'I do not have permission to look at the data needed to answer that. ' +
          'Ask an owner or admin to grant the relevant access, and I will be able to help.',
      };
    }

    const collected = new Map<string, ToolCallOutcome>();
    for (const turn of toolResults) {
      if (turn.role !== 'tool_results') continue;
      for (const result of turn.results) collected.set(result.name, result);
    }

    const failures = [...collected.values()].filter((result) => !result.ok);
    if (failures.length === collected.size) {
      return {
        type: 'final',
        text: `I could not retrieve that data: ${failures.map((f) => f.summary).join('; ')}. Nothing has been changed.`,
      };
    }

    return { type: 'final', text: intent.compose(collected, input.context, question.toLowerCase()) };
  }
}

/** Exported for tests: which intent a question maps to. */
export function classifyForTesting(text: string): string {
  return selectIntent(text).id;
}
