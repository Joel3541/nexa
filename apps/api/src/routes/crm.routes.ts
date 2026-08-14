import {
  addCustomerNoteSchema,
  createCustomerSchema,
  listCustomersSchema,
  updateCustomerSchema,
} from '@nexa/types';
import { Router } from 'express';
import { handler, paginate, param, parse } from '../lib/http.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import {
  addNote,
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerTimeline,
  listCustomers,
  updateCustomer,
} from '../services/customers.service.js';

export const customersRouter: Router = Router();

customersRouter.use(requireAuth, requireBusiness);

const actor = (req: Parameters<typeof getAuth>[0]) => {
  const auth = getAuth(req);
  return { id: auth.user.id, name: auth.user.fullName };
};

customersRouter.get(
  '/',
  requirePermission('customers:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(listCustomersSchema, req.query);
    const { rows, total } = await listCustomers(tenant.business.id, query);
    res.json(paginate(rows, query.page, query.pageSize, total));
  }),
);

customersRouter.post(
  '/',
  requirePermission('customers:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(createCustomerSchema, req.body);
    res.status(201).json(await createCustomer(tenant.business.id, input, actor(req)));
  }),
);

customersRouter.get(
  '/:id',
  requirePermission('customers:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    res.json(await getCustomer(tenant.business.id, param(req, 'id')));
  }),
);

customersRouter.get(
  '/:id/timeline',
  requirePermission('customers:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    res.json(await getCustomerTimeline(tenant.business.id, param(req, 'id')));
  }),
);

customersRouter.patch(
  '/:id',
  requirePermission('customers:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(updateCustomerSchema, req.body);
    res.json(await updateCustomer(tenant.business.id, param(req, 'id'), input, actor(req)));
  }),
);

customersRouter.post(
  '/:id/notes',
  requirePermission('customers:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(addCustomerNoteSchema, req.body);
    await addNote(tenant.business.id, param(req, 'id'), input.body, actor(req));
    res.status(201).json({ ok: true });
  }),
);

customersRouter.delete(
  '/:id',
  requirePermission('customers:delete'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    await deleteCustomer(tenant.business.id, param(req, 'id'), actor(req));
    res.json({ ok: true });
  }),
);
