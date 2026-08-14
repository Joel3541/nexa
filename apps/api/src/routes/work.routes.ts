import {
  createAppointmentSchema,
  createTaskSchema,
  listAppointmentsSchema,
  listTasksSchema,
  updateAppointmentSchema,
  updateTaskSchema,
} from '@nexa/types';
import { Router } from 'express';
import type { Request } from 'express';
import { handler, paginate, param, parse } from '../lib/http.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import {
  createAppointment,
  createTask,
  deleteAppointment,
  deleteTask,
  getAppointment,
  getTask,
  listAppointments,
  listTasks,
  updateAppointment,
  updateTask,
} from '../services/work.service.js';

export const tasksRouter: Router = Router();
export const appointmentsRouter: Router = Router();

tasksRouter.use(requireAuth, requireBusiness);
appointmentsRouter.use(requireAuth, requireBusiness);

const actor = (req: Request) => {
  const auth = getAuth(req);
  return { id: auth.user.id, name: auth.user.fullName };
};

tasksRouter.get(
  '/',
  requirePermission('tasks:read'),
  handler(async (req, res) => {
    const query = parse(listTasksSchema, req.query);
    const { rows, total } = await listTasks(getTenant(req).business.id, query);
    res.json(paginate(rows, query.page, query.pageSize, total));
  }),
);

tasksRouter.post(
  '/',
  requirePermission('tasks:write'),
  handler(async (req, res) => {
    const input = parse(createTaskSchema, req.body);
    res.status(201).json(await createTask(getTenant(req).business.id, input, actor(req)));
  }),
);

tasksRouter.get(
  '/:id',
  requirePermission('tasks:read'),
  handler(async (req, res) => {
    res.json(await getTask(getTenant(req).business.id, param(req, 'id')));
  }),
);

tasksRouter.patch(
  '/:id',
  requirePermission('tasks:write'),
  handler(async (req, res) => {
    const input = parse(updateTaskSchema, req.body);
    res.json(await updateTask(getTenant(req).business.id, param(req, 'id'), input, actor(req)));
  }),
);

tasksRouter.delete(
  '/:id',
  requirePermission('tasks:write'),
  handler(async (req, res) => {
    await deleteTask(getTenant(req).business.id, param(req, 'id'), actor(req));
    res.json({ ok: true });
  }),
);

appointmentsRouter.get(
  '/',
  requirePermission('appointments:read'),
  handler(async (req, res) => {
    const query = parse(listAppointmentsSchema, req.query);
    const { rows, total } = await listAppointments(getTenant(req).business.id, query);
    res.json(paginate(rows, query.page, query.pageSize, total));
  }),
);

appointmentsRouter.post(
  '/',
  requirePermission('appointments:write'),
  handler(async (req, res) => {
    const input = parse(createAppointmentSchema, req.body);
    res.status(201).json(await createAppointment(getTenant(req).business.id, input, actor(req)));
  }),
);

appointmentsRouter.get(
  '/:id',
  requirePermission('appointments:read'),
  handler(async (req, res) => {
    res.json(await getAppointment(getTenant(req).business.id, param(req, 'id')));
  }),
);

appointmentsRouter.patch(
  '/:id',
  requirePermission('appointments:write'),
  handler(async (req, res) => {
    const input = parse(updateAppointmentSchema, req.body);
    res.json(await updateAppointment(getTenant(req).business.id, param(req, 'id'), input, actor(req)));
  }),
);

appointmentsRouter.delete(
  '/:id',
  requirePermission('appointments:write'),
  handler(async (req, res) => {
    await deleteAppointment(getTenant(req).business.id, param(req, 'id'), actor(req));
    res.json({ ok: true });
  }),
);
