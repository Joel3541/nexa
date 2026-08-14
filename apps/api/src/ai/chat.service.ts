import {
  aiActionApprovals,
  aiActions,
  aiConversations,
  aiMessages,
  getDb,
  type Business,
} from '@nexa/database';
import {
  executeApprovedAction,
  getAgent,
  getAiProvider,
  runTurn,
  toolRegistry,
  type AiTurn,
  type ToolContext,
} from '@nexa/ai';
import type { AiActionView, AiChatResponse, AiMessageView, Permission } from '@nexa/types';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { emitActivity, trackUsage, writeAudit } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import { registerTools } from './tools.js';

registerTools();

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_TURNS = 10;

export interface ChatActor {
  userId: string;
  userName: string;
  permissions: Permission[];
}

function buildToolContext(business: Business, actor: ChatActor, now: Date): ToolContext {
  return {
    businessId: business.id,
    businessName: business.name,
    userId: actor.userId,
    userName: actor.userName,
    permissions: actor.permissions,
    currency: business.currency,
    locale: business.locale,
    timezone: business.timezone,
    now,
  };
}

export async function listConversations(businessId: string, userId: string, limit = 20) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.businessId, businessId), eq(aiConversations.userId, userId)))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    agentId: row.agentId,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getConversationMessages(
  businessId: string,
  userId: string,
  conversationId: string,
): Promise<AiMessageView[]> {
  const db = await getDb();
  const [conversation] = await db
    .select()
    .from(aiConversations)
    .where(and(ownedRow(aiConversations, conversationId, businessId), eq(aiConversations.userId, userId)))
    .limit(1);
  if (!conversation) throw notFound('That conversation');

  const rows = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.businessId, businessId), eq(aiMessages.conversationId, conversationId)))
    .orderBy(asc(aiMessages.createdAt));

  const actions = await db
    .select()
    .from(aiActions)
    .where(and(eq(aiActions.businessId, businessId), eq(aiActions.conversationId, conversationId)));

  const actionsByMessage = new Map<string, AiActionView[]>();
  for (const action of actions) {
    if (!action.messageId) continue;
    const bucket = actionsByMessage.get(action.messageId) ?? [];
    bucket.push(toActionView(action));
    actionsByMessage.set(action.messageId, bucket);
  }

  return rows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      agentId: (row.agentId as AiMessageView['agentId']) ?? null,
      toolCalls: (row.toolCalls as AiMessageView['toolCalls']) ?? [],
      pendingActions: actionsByMessage.get(row.id) ?? [],
      citations: [],
      createdAt: row.createdAt.toISOString(),
    }));
}

/**
 * Runs one assistant turn.
 *
 * Persistence order matters: the user message is stored first, so a provider
 * failure still leaves an accurate transcript rather than losing what was asked.
 */
export async function sendMessage(
  business: Business,
  actor: ChatActor,
  input: { conversationId?: string | null; message: string; agentId?: string },
  now = new Date(),
): Promise<AiChatResponse> {
  if (!actor.permissions.includes('ai:use')) {
    throw forbidden('Your role does not include access to the AI assistant.');
  }

  const db = await getDb();
  const agent = getAgent(input.agentId);
  const provider = getAiProvider();

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const [existing] = await db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(and(ownedRow(aiConversations, conversationId, business.id), eq(aiConversations.userId, actor.userId)))
      .limit(1);
    if (!existing) throw notFound('That conversation');
  } else {
    const [created] = await db
      .insert(aiConversations)
      .values({
        businessId: business.id,
        userId: actor.userId,
        agentId: agent.id,
        title: input.message.slice(0, 80),
      })
      .returning();
    conversationId = created!.id;
  }

  await db.insert(aiMessages).values({
    businessId: business.id,
    conversationId,
    role: 'user',
    content: input.message,
  });

  const history = await loadHistory(business.id, conversationId);

  let result: Awaited<ReturnType<typeof runTurn>>;
  try {
    result = await runTurn({
      agent,
      registry: toolRegistry,
      provider,
      context: buildToolContext(business, actor, now),
      history,
      message: input.message,
      businessMeta: { industry: business.industry, country: business.country },
    });
  } catch (error) {
    logger.error('ai turn failed', { error: String(error), businessId: business.id, provider: provider.name });
    throw badRequest('The assistant could not complete that request. Nothing was changed. Please try again.');
  }

  const [assistantMessage] = await db
    .insert(aiMessages)
    .values({
      businessId: business.id,
      conversationId,
      role: 'assistant',
      content: result.text,
      agentId: agent.id,
      toolCalls: result.toolCalls,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      latencyMs: result.latencyMs,
    })
    .returning();

  const pendingActions: AiActionView[] = [];
  for (const proposal of result.proposals) {
    const [action] = await db
      .insert(aiActions)
      .values({
        businessId: business.id,
        conversationId,
        messageId: assistantMessage!.id,
        requestedByUserId: actor.userId,
        agentId: proposal.agentId,
        tool: proposal.tool,
        label: proposal.proposal.label,
        description: proposal.proposal.description,
        payload: proposal.payload,
        preview: proposal.proposal.preview,
        impact: proposal.proposal.impact,
        status: 'proposed',
        expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
      })
      .returning();
    pendingActions.push(toActionView(action!));
  }

  await db
    .update(aiConversations)
    .set({ updatedAt: new Date(), agentId: agent.id })
    .where(eq(aiConversations.id, conversationId));

  await writeAudit(db, {
    businessId: business.id,
    actorUserId: actor.userId,
    actorName: actor.userName,
    action: 'ai.message',
    entityType: 'ai_conversation',
    entityId: conversationId,
    summary: `${actor.userName} asked NEXA AI a question (${agent.name}).`,
    metadata: {
      provider: result.provider,
      model: result.model,
      tools: result.toolCalls.map((call) => call.name),
      proposals: result.proposals.length,
      latencyMs: result.latencyMs,
    },
  });
  await trackUsage(db, {
    businessId: business.id,
    userId: actor.userId,
    name: 'ai_message_sent',
    properties: { agent: agent.id, toolCount: result.toolCalls.length },
  });

  return {
    conversationId,
    provider: result.provider,
    message: {
      id: assistantMessage!.id,
      role: 'assistant',
      content: result.text,
      agentId: agent.id,
      toolCalls: result.toolCalls,
      pendingActions,
      citations: result.citations,
      createdAt: assistantMessage!.createdAt.toISOString(),
    },
  };
}

async function loadHistory(businessId: string, conversationId: string): Promise<AiTurn[]> {
  const db = await getDb();
  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(and(eq(aiMessages.businessId, businessId), eq(aiMessages.conversationId, conversationId)))
    .orderBy(desc(aiMessages.createdAt))
    .limit(HISTORY_TURNS + 1);

  // Drop the message just inserted for this turn — runTurn appends it itself.
  return rows
    .slice(1)
    .reverse()
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) =>
      row.role === 'user'
        ? ({ role: 'user', content: row.content } as const)
        : ({ role: 'assistant', content: row.content } as const),
    );
}

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export async function listPendingActions(businessId: string, limit = 20): Promise<AiActionView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(aiActions)
    .where(and(eq(aiActions.businessId, businessId), inArray(aiActions.status, ['proposed'])))
    .orderBy(desc(aiActions.createdAt))
    .limit(limit);
  return rows.map(toActionView);
}

/**
 * Approves and executes a proposed action.
 *
 * The permission check happens again here, at execution time, against the
 * approver's own role — approval by a user who lacks the underlying permission
 * is refused even though the proposal exists.
 */
export async function decideAction(
  business: Business,
  actor: ChatActor,
  actionId: string,
  decision: 'approve' | 'reject',
  note: string | undefined,
  now = new Date(),
): Promise<AiActionView> {
  const db = await getDb();
  const [action] = await db.select().from(aiActions).where(ownedRow(aiActions, actionId, business.id)).limit(1);
  if (!action) throw notFound('That action');
  if (action.status !== 'proposed') throw badRequest(`That action has already been ${action.status}.`);
  if (action.expiresAt && action.expiresAt.getTime() < now.getTime()) {
    await db.update(aiActions).set({ status: 'expired', updatedAt: now }).where(eq(aiActions.id, actionId));
    throw badRequest('That action expired. Ask the assistant to prepare it again.');
  }
  if (!actor.permissions.includes('ai:approve_actions')) {
    throw forbidden('Your role cannot approve AI actions.');
  }

  await db.insert(aiActionApprovals).values({
    businessId: business.id,
    actionId,
    decidedByUserId: actor.userId,
    decision,
    note: note ?? null,
  });

  if (decision === 'reject') {
    const [updated] = await db
      .update(aiActions)
      .set({ status: 'rejected', updatedAt: now, result: note ?? null })
      .where(eq(aiActions.id, actionId))
      .returning();
    await writeAudit(db, {
      businessId: business.id,
      actorUserId: actor.userId,
      actorName: actor.userName,
      action: 'ai.action_rejected',
      entityType: 'ai_action',
      entityId: actionId,
      summary: `${actor.userName} rejected the AI action "${action.label}".`,
    });
    return toActionView(updated!);
  }

  const outcome = await executeApprovedAction({
    registry: toolRegistry,
    toolName: action.tool,
    payload: action.payload,
    context: buildToolContext(business, actor, now),
  });

  const [updated] = await db
    .update(aiActions)
    .set({
      status: outcome.ok ? 'executed' : 'failed',
      result: outcome.summary,
      updatedAt: now,
    })
    .where(eq(aiActions.id, actionId))
    .returning();

  await writeAudit(db, {
    businessId: business.id,
    actorUserId: actor.userId,
    actorName: actor.userName,
    actorType: 'ai',
    action: outcome.ok ? 'ai.action_executed' : 'ai.action_failed',
    entityType: 'ai_action',
    entityId: actionId,
    summary: `${actor.userName} approved "${action.label}". ${outcome.summary}`,
    metadata: { tool: action.tool, payload: action.payload },
  });

  if (outcome.ok) {
    await emitActivity(db, {
      businessId: business.id,
      type: 'ai.action_executed',
      severity: 'success',
      source: 'ai',
      title: action.label,
      description: outcome.summary,
      entityType: 'ai_action',
      entityId: actionId,
      actorUserId: actor.userId,
    });
    await trackUsage(db, {
      businessId: business.id,
      userId: actor.userId,
      name: 'ai_action_approved',
      properties: { tool: action.tool },
    });
  }

  return toActionView(updated!);
}

function toActionView(action: typeof aiActions.$inferSelect): AiActionView {
  return {
    id: action.id,
    tool: action.tool,
    label: action.label,
    description: action.description,
    status: action.status,
    payload: action.payload,
    preview: action.preview,
    impact: action.impact as AiActionView['impact'],
    requestedAt: action.createdAt.toISOString(),
    decidedAt: action.status === 'proposed' ? null : action.updatedAt.toISOString(),
    result: action.result,
  };
}
