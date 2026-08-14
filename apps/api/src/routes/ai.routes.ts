import { AGENT_LIST, getAiProvider, toolRegistry } from '@nexa/ai';
import { aiChatSchema, aiActionDecisionSchema } from '@nexa/types';
import { Router } from 'express';
import { z } from 'zod';
import { handler, param, parse } from '../lib/http.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  decideAction,
  getConversationMessages,
  listConversations,
  listPendingActions,
  sendMessage,
} from '../ai/chat.service.js';
import { registerTools } from '../ai/tools.js';

registerTools();

export const aiRouter: Router = Router();

aiRouter.use(requireAuth, requireBusiness);

/**
 * Exposes the agent roster and the tools the *current member* may use.
 * The client renders this for transparency: a user can see exactly what the
 * assistant is able to do on their behalf.
 */
aiRouter.get(
  '/agents',
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const provider = getAiProvider();
    res.json({
      provider: provider.name,
      model: provider.model,
      generative: provider.generative,
      agents: AGENT_LIST.map((agent) => ({
        id: agent.id,
        name: agent.name,
        tagline: agent.tagline,
        accent: agent.accent,
        tools: toolRegistry.availableFor(agent, tenant.permissions).map((tool) => ({
          name: tool.name,
          label: tool.label,
          kind: tool.kind,
          requiresApproval: tool.requiresApproval,
          permission: tool.permission,
        })),
      })),
    });
  }),
);

aiRouter.get(
  '/conversations',
  requirePermission('ai:use'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const auth = getAuth(req);
    res.json(await listConversations(tenant.business.id, auth.user.id));
  }),
);

aiRouter.get(
  '/conversations/:id',
  requirePermission('ai:use'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const auth = getAuth(req);
    res.json(await getConversationMessages(tenant.business.id, auth.user.id, param(req, 'id')));
  }),
);

aiRouter.post(
  '/chat',
  requirePermission('ai:use'),
  // AI turns are the most expensive request in the product; cap them per user.
  rateLimit('ai-chat', {
    windowMs: 60 * 1000,
    max: 20,
    key: (req) => req.auth?.user.id ?? 'anonymous',
    message: 'You are sending messages faster than NEXA can think. Give it a moment.',
  }),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const auth = getAuth(req);
    const input = parse(aiChatSchema, req.body);
    res.json(
      await sendMessage(tenant.business, {
        userId: auth.user.id,
        userName: auth.user.fullName,
        permissions: tenant.permissions,
      }, input),
    );
  }),
);

aiRouter.get(
  '/actions',
  requirePermission('ai:use'),
  handler(async (req, res) => {
    res.json(await listPendingActions(getTenant(req).business.id));
  }),
);

aiRouter.post(
  '/actions/:id/approve',
  requirePermission('ai:approve_actions'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const auth = getAuth(req);
    const input = parse(aiActionDecisionSchema, req.body ?? {});
    res.json(
      await decideAction(
        tenant.business,
        { userId: auth.user.id, userName: auth.user.fullName, permissions: tenant.permissions },
        param(req, 'id'),
        'approve',
        input.note,
      ),
    );
  }),
);

aiRouter.post(
  '/actions/:id/reject',
  requirePermission('ai:approve_actions'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const auth = getAuth(req);
    const input = parse(z.object({ note: z.string().max(500).optional() }), req.body ?? {});
    res.json(
      await decideAction(
        tenant.business,
        { userId: auth.user.id, userName: auth.user.fullName, permissions: tenant.permissions },
        param(req, 'id'),
        'reject',
        input.note,
      ),
    );
  }),
);
