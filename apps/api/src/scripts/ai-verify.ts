/**
 * `npm run ai:verify` — end-to-end check of the live Anthropic integration.
 *
 * Run this after putting a real key in `.env`. It answers the only question
 * that matters before switching a workspace over: *will a real turn, with real
 * tools, against real business data, actually work — and what will it cost?*
 *
 * It never prints the API key, and it never writes anything. Every tool it
 * exercises is read-only; consequential tools are excluded by construction
 * because this runs the same orchestrator the product does, and that
 * orchestrator turns them into proposals rather than executing them.
 */

import { performance } from 'node:perf_hooks';
import {
  AiProviderError,
  AnthropicAiProvider,
  formatMicros,
  getAgent,
  isKnownModel,
  runTurn,
  toolRegistry,
  type StepUsage,
} from '@nexa/ai';
import { env } from '@nexa/config';
import { businesses, getDb, users } from '@nexa/database';
import { permissionsForRole } from '@nexa/types';
import { registerTools } from '../ai/tools.js';

registerTools();

const PASS = '  [32mPASS[0m';
const FAIL = '  [31mFAIL[0m';
const INFO = '  [36m····[0m';
const WARN = '  [33mWARN[0m';

let failures = 0;

function pass(label: string, detail?: string) {
  console.log(`${PASS} ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label: string, detail?: string) {
  failures += 1;
  console.log(`${FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label: string, detail?: string) {
  console.log(`${WARN} ${label}${detail ? ` — ${detail}` : ''}`);
}
function info(detail: string) {
  console.log(`${INFO} ${detail}`);
}

/** Shows enough of a key to confirm *which* key is loaded, never enough to use it. */
function fingerprint(key: string): string {
  if (key.length < 12) return '(too short to be valid)';
  return `${key.slice(0, 7)}…${key.slice(-4)} (${key.length} chars)`;
}

function reportUsage(usage: StepUsage) {
  info(
    `tokens: ${usage.inputTokens} in / ${usage.outputTokens} out` +
      (usage.cacheReadTokens ? ` / ${usage.cacheReadTokens} cache-read` : '') +
      (usage.cacheWriteTokens ? ` / ${usage.cacheWriteTokens} cache-write` : ''),
  );
  info(`estimated cost: ${formatMicros(usage.costMicros)}`);
}

async function main() {
  console.log('\n[1mNEXA — Anthropic provider verification[0m\n');

  /* 1. Configuration ------------------------------------------------------ */
  console.log('[1m1. Configuration[0m');

  if (env.AI_PROVIDER !== 'anthropic') {
    warn(
      `AI_PROVIDER is "${env.AI_PROVIDER}"`,
      'the app is still using the mock provider. Set AI_PROVIDER=anthropic in .env to switch it over.',
    );
  } else {
    pass('AI_PROVIDER', 'anthropic');
  }

  const apiKey = env.AI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    fail('AI_API_KEY', 'not set. Add AI_API_KEY=sk-ant-… to .env and run this again.');
    console.log('\nNothing else can be checked without a key.\n');
    process.exit(1);
  }
  pass('AI_API_KEY', fingerprint(apiKey));

  if (isKnownModel(env.AI_MODEL)) {
    pass('AI_MODEL', env.AI_MODEL);
  } else {
    warn('AI_MODEL', `"${env.AI_MODEL}" is not in the local pricing table; cost will be over-estimated.`);
  }
  info(`effort=${env.AI_EFFORT}  thinking=${env.AI_THINKING}  max_tokens=${env.AI_MAX_TOKENS}`);
  info(
    env.AI_MONTHLY_BUDGET_CENTS > 0
      ? `monthly budget: ${formatMicros(env.AI_MONTHLY_BUDGET_CENTS * 10_000)} per business`
      : 'monthly budget: uncapped (set AI_MONTHLY_BUDGET_CENTS to add a ceiling)',
  );

  const provider = new AnthropicAiProvider(apiKey);

  /* 2. Credentials and model reachability --------------------------------- */
  console.log('\n[1m2. Reaching the API[0m');

  const started = performance.now();
  try {
    const probe = await provider.step({
      system: 'You are a connectivity probe. Reply with the single word: ready',
      turns: [{ role: 'user', content: 'Reply with one word.' }],
      tools: [],
      context: { currency: 'GHS', locale: 'en-GH', businessName: 'NEXA', userName: 'verifier' },
    });
    const elapsed = Math.round(performance.now() - started);
    if (probe.type !== 'final') {
      fail('round trip', 'the model asked for a tool when none were offered');
    } else {
      pass('round trip', `${elapsed}ms — model replied "${probe.text.slice(0, 40)}"`);
      if (probe.usage) reportUsage(probe.usage);
    }
  } catch (error) {
    if (error instanceof AiProviderError) {
      fail(`round trip (${error.kind})`, error.message);
      if (error.kind === 'auth') {
        console.log('\nThe key was rejected. Check it at console.anthropic.com and update .env.\n');
        process.exit(1);
      }
    } else {
      fail('round trip', String(error));
    }
  }

  /* 3. Tool use against real business data -------------------------------- */
  console.log('\n[1m3. Tool use against live data[0m');

  const db = await getDb();
  const [business] = await db.select().from(businesses).limit(1);
  if (!business) {
    warn('no business found', 'run `npm run db:seed` first to exercise tools against real data.');
  } else {
    const [owner] = await db.select().from(users).limit(1);
    const agent = getAgent('chief_of_staff');
    const permissions = [...permissionsForRole('owner')];
    const specs = toolRegistry.specsFor(agent, permissions);
    info(`agent "${agent.name}" has ${specs.length} tools available`);

    try {
      const result = await runTurn({
        agent,
        registry: toolRegistry,
        provider,
        context: {
          businessId: business.id,
          businessName: business.name,
          userId: owner?.id ?? 'verifier',
          userName: owner?.fullName ?? 'Verifier',
          permissions,
          currency: business.currency,
          locale: business.locale,
          timezone: business.timezone,
          now: new Date(),
        },
        history: [],
        message: 'How is the business doing this month? Use the tools — do not guess any numbers.',
        businessMeta: { industry: business.industry, country: business.country },
      });

      if (result.toolCalls.length === 0) {
        warn('tool use', 'the model answered without calling a tool. Verify the answer is not invented.');
      } else {
        pass('tool use', `${result.toolCalls.length} call(s): ${result.toolCalls.map((c) => c.name).join(', ')}`);
        const failed = result.toolCalls.filter((c) => c.status === 'error');
        if (failed.length > 0) fail('tool execution', failed.map((c) => `${c.name}: ${c.summary}`).join('; '));
      }

      if (result.proposals.length > 0) {
        pass('approval gate', `${result.proposals.length} consequential action(s) held for approval, not executed`);
      }

      pass('answer composed', `${result.latencyMs}ms`);
      reportUsage(result.usage);
      console.log('\n[2m--- model answer ---[0m');
      console.log(result.text.trim());
      console.log('[2m--------------------[0m');
    } catch (error) {
      fail('tool use', error instanceof AiProviderError ? error.message : String(error));
    }
  }

  /* 4. Verdict ------------------------------------------------------------ */
  console.log('');
  if (failures === 0) {
    console.log('[32m[1mAll checks passed.[0m The Anthropic provider is wired correctly.\n');
    if (env.AI_PROVIDER !== 'anthropic') {
      console.log('Set AI_PROVIDER=anthropic in .env to use it for real traffic.\n');
    }
    process.exit(0);
  }
  console.log(`[31m[1m${failures} check(s) failed.[0m\n`);
  process.exit(1);
}

main().catch((error) => {
  console.error('\nVerification crashed:', error);
  process.exit(1);
});
