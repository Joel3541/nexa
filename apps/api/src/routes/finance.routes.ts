import { createExpenseSchema, listExpensesSchema, updateExpenseSchema } from '@nexa/types';
import { Router } from 'express';
import type { Request } from 'express';
import { handler, paginate, param, parse } from '../lib/http.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import {
  createExpense,
  deleteExpense,
  listExpenseCategories,
  listExpenses,
  updateExpense,
} from '../services/expenses.service.js';

export const expensesRouter: Router = Router();

expensesRouter.use(requireAuth, requireBusiness);

const actor = (req: Request) => {
  const auth = getAuth(req);
  return { id: auth.user.id, name: auth.user.fullName };
};

expensesRouter.get(
  '/',
  requirePermission('expenses:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(listExpensesSchema, req.query);
    const { rows, total, totalMinor } = await listExpenses(tenant.business.id, query);
    res.json({ ...paginate(rows, query.page, query.pageSize, total), totalMinor });
  }),
);

expensesRouter.get(
  '/categories',
  requirePermission('expenses:read'),
  handler(async (req, res) => {
    res.json(await listExpenseCategories(getTenant(req).business.id));
  }),
);

expensesRouter.post(
  '/',
  requirePermission('expenses:write'),
  handler(async (req, res) => {
    const input = parse(createExpenseSchema, req.body);
    res.status(201).json(await createExpense(getTenant(req).business.id, input, actor(req)));
  }),
);

expensesRouter.patch(
  '/:id',
  requirePermission('expenses:write'),
  handler(async (req, res) => {
    const input = parse(updateExpenseSchema, req.body);
    res.json(await updateExpense(getTenant(req).business.id, param(req, 'id'), input, actor(req)));
  }),
);

expensesRouter.delete(
  '/:id',
  requirePermission('expenses:write'),
  handler(async (req, res) => {
    await deleteExpense(getTenant(req).business.id, param(req, 'id'), actor(req));
    res.json({ ok: true });
  }),
);
