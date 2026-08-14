import { appointments, customers, getDb, products, tasks, users } from '@nexa/database';
import type {
  AppointmentView,
  CreateAppointmentInput,
  CreateTaskInput,
  TaskView,
} from '@nexa/types';
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { notFound } from '../lib/errors.js';
import { DAY_MS } from '../lib/dates.js';
import { emitActivity, trackUsage, writeAudit } from '../db/records.js';
import { assertOwned, ownedRow } from '../db/scope.js';
import type { Actor } from './customers.service.js';

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

export async function listTasks(
  businessId: string,
  query: {
    page: number;
    pageSize: number;
    status?: string;
    priority?: string;
    customerId?: string;
    assigneeId?: string;
    dueBefore?: string;
    q?: string;
  },
  now = new Date(),
): Promise<{ rows: TaskView[]; total: number }> {
  const db = await getDb();
  const filters = [eq(tasks.businessId, businessId)];
  if (query.status) filters.push(eq(tasks.status, query.status as 'todo'));
  if (query.priority) filters.push(eq(tasks.priority, query.priority as 'medium'));
  if (query.customerId) filters.push(eq(tasks.customerId, query.customerId));
  if (query.assigneeId) filters.push(eq(tasks.assigneeId, query.assigneeId));
  if (query.dueBefore) filters.push(lte(tasks.dueDate, new Date(query.dueBefore)));
  if (query.q) filters.push(or(ilike(tasks.title, `%${query.q}%`), ilike(tasks.description, `%${query.q}%`))!);
  const where = and(...filters)!;

  const [rows, [countRow]] = await Promise.all([
    db
      .select({ task: tasks, customerName: customers.name, assigneeName: users.fullName })
      .from(tasks)
      .leftJoin(customers, eq(customers.id, tasks.customerId))
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(where)
      // Open work first, then by due date, so the list reads as a work queue.
      .orderBy(
        sql`case when ${tasks.status} = 'completed' then 1 else 0 end`,
        sql`${tasks.dueDate} asc nulls last`,
        desc(tasks.createdAt),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where),
  ]);

  return {
    rows: rows.map((row) => toTaskView(row.task, row.customerName, row.assigneeName, now)),
    total: Number(countRow?.count ?? 0),
  };
}

export async function createTask(businessId: string, input: CreateTaskInput, actor: Actor): Promise<TaskView> {
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    await assertOwned(tx, customers, input.customerId, businessId, 'That customer');

    const [row] = await tx
      .insert(tasks)
      .values({
        businessId,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        customerId: input.customerId ?? null,
        orderId: input.orderId ?? null,
        invoiceId: input.invoiceId ?? null,
        assigneeId: input.assigneeId ?? actor.id,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        recurrence: input.recurrence,
        createdByUserId: actor.id,
        source: actor.source ?? 'user',
      })
      .returning();

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.source ?? 'user',
      action: 'task.created',
      entityType: 'task',
      entityId: row!.id,
      summary: `${actor.name} created task "${input.title}".`,
    });
    await trackUsage(tx, { businessId, userId: actor.id, name: 'task_created', properties: { source: actor.source ?? 'user' } });
    return row!;
  });

  return getTask(businessId, created.id);
}

export async function getTask(businessId: string, taskId: string, now = new Date()): Promise<TaskView> {
  const db = await getDb();
  const [row] = await db
    .select({ task: tasks, customerName: customers.name, assigneeName: users.fullName })
    .from(tasks)
    .leftJoin(customers, eq(customers.id, tasks.customerId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(ownedRow(tasks, taskId, businessId))
    .limit(1);
  if (!row) throw notFound('That task');
  return toTaskView(row.task, row.customerName, row.assigneeName, now);
}

export async function updateTask(
  businessId: string,
  taskId: string,
  input: Partial<CreateTaskInput>,
  actor: Actor,
): Promise<TaskView> {
  const db = await getDb();
  const [existing] = await db.select().from(tasks).where(ownedRow(tasks, taskId, businessId)).limit(1);
  if (!existing) throw notFound('That task');

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['title', 'description', 'priority', 'recurrence', 'assigneeId', 'customerId'] as const) {
      if (input[key] !== undefined) patch[key] = input[key] ?? null;
    }
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.completedAt = input.status === 'completed' ? new Date() : null;
    }

    await tx.update(tasks).set(patch).where(ownedRow(tasks, taskId, businessId));

    // A completed recurring task immediately schedules its next occurrence,
    // so a routine never silently falls off the list.
    if (input.status === 'completed' && existing.recurrence !== 'none' && existing.dueDate) {
      const interval = { daily: 1, weekly: 7, monthly: 30 }[existing.recurrence] ?? 0;
      if (interval > 0) {
        await tx.insert(tasks).values({
          businessId,
          title: existing.title,
          description: existing.description,
          priority: existing.priority,
          customerId: existing.customerId,
          assigneeId: existing.assigneeId,
          dueDate: new Date(existing.dueDate.getTime() + interval * DAY_MS),
          recurrence: existing.recurrence,
          createdByUserId: actor.id,
          source: 'system',
        });
      }
    }

    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: 'task.updated',
      entityType: 'task',
      entityId: taskId,
      summary: `${actor.name} updated task "${existing.title}"${input.status ? ` (${input.status})` : ''}.`,
    });
  });

  return getTask(businessId, taskId);
}

export async function deleteTask(businessId: string, taskId: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select().from(tasks).where(ownedRow(tasks, taskId, businessId)).limit(1);
  if (!existing) throw notFound('That task');
  await db.delete(tasks).where(ownedRow(tasks, taskId, businessId));
  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'task.deleted',
    entityType: 'task',
    entityId: taskId,
    summary: `${actor.name} deleted task "${existing.title}".`,
  });
}

export function toTaskView(
  task: typeof tasks.$inferSelect,
  customerName: string | null,
  assigneeName: string | null,
  now: Date,
): TaskView {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    customerId: task.customerId,
    customerName,
    orderId: task.orderId,
    invoiceId: task.invoiceId,
    assigneeId: task.assigneeId,
    assigneeName,
    dueDate: task.dueDate?.toISOString() ?? null,
    isOverdue: task.status !== 'completed' && task.dueDate !== null && task.dueDate.getTime() < now.getTime(),
    recurrence: task.recurrence,
    createdBySource: task.source,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Appointments                                                                */
/* -------------------------------------------------------------------------- */

export async function listAppointments(
  businessId: string,
  query: { page: number; pageSize: number; status?: string; customerId?: string; from?: string; to?: string },
): Promise<{ rows: AppointmentView[]; total: number }> {
  const db = await getDb();
  const filters = [eq(appointments.businessId, businessId)];
  if (query.status) filters.push(eq(appointments.status, query.status as 'scheduled'));
  if (query.customerId) filters.push(eq(appointments.customerId, query.customerId));
  if (query.from) filters.push(gte(appointments.startsAt, new Date(query.from)));
  if (query.to) filters.push(lte(appointments.startsAt, new Date(query.to)));
  const where = and(...filters)!;

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        appointment: appointments,
        customerName: customers.name,
        productName: products.name,
        staffName: users.fullName,
      })
      .from(appointments)
      .leftJoin(customers, eq(customers.id, appointments.customerId))
      .leftJoin(products, eq(products.id, appointments.productId))
      .leftJoin(users, eq(users.id, appointments.staffId))
      .where(where)
      .orderBy(asc(appointments.startsAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(appointments).where(where),
  ]);

  return {
    rows: rows.map((row) => toAppointmentView(row.appointment, row.customerName, row.productName, row.staffName)),
    total: Number(countRow?.count ?? 0),
  };
}

export async function createAppointment(
  businessId: string,
  input: CreateAppointmentInput,
  actor: Actor,
): Promise<AppointmentView> {
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    await assertOwned(tx, customers, input.customerId, businessId, 'That customer');
    await assertOwned(tx, products, input.productId, businessId, 'That service');

    const [row] = await tx
      .insert(appointments)
      .values({
        businessId,
        title: input.title,
        customerId: input.customerId ?? null,
        productId: input.productId ?? null,
        staffId: input.staffId ?? actor.id,
        startsAt: new Date(input.startsAt),
        durationMinutes: input.durationMinutes,
        status: input.status,
        location: input.location ?? null,
        notes: input.notes ?? null,
        createdByUserId: actor.id,
      })
      .returning();

    await emitActivity(tx, {
      businessId,
      type: 'appointment.created',
      title: `Appointment booked: ${input.title}`,
      description: new Date(input.startsAt).toISOString(),
      entityType: 'appointment',
      entityId: row!.id,
      source: actor.source ?? 'user',
      actionLabel: 'View',
      actionHref: '/app/appointments',
    });
    await writeAudit(tx, {
      businessId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: 'appointment.created',
      entityType: 'appointment',
      entityId: row!.id,
      summary: `${actor.name} booked "${input.title}".`,
    });
    await trackUsage(tx, { businessId, userId: actor.id, name: 'appointment_created' });
    return row!;
  });

  return getAppointment(businessId, created.id);
}

export async function getAppointment(businessId: string, appointmentId: string): Promise<AppointmentView> {
  const db = await getDb();
  const [row] = await db
    .select({
      appointment: appointments,
      customerName: customers.name,
      productName: products.name,
      staffName: users.fullName,
    })
    .from(appointments)
    .leftJoin(customers, eq(customers.id, appointments.customerId))
    .leftJoin(products, eq(products.id, appointments.productId))
    .leftJoin(users, eq(users.id, appointments.staffId))
    .where(ownedRow(appointments, appointmentId, businessId))
    .limit(1);
  if (!row) throw notFound('That appointment');
  return toAppointmentView(row.appointment, row.customerName, row.productName, row.staffName);
}

export async function updateAppointment(
  businessId: string,
  appointmentId: string,
  input: Partial<CreateAppointmentInput>,
  actor: Actor,
): Promise<AppointmentView> {
  const db = await getDb();
  const [existing] = await db.select().from(appointments).where(ownedRow(appointments, appointmentId, businessId)).limit(1);
  if (!existing) throw notFound('That appointment');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ['title', 'status', 'location', 'notes', 'customerId', 'productId', 'staffId', 'durationMinutes'] as const) {
    if (input[key] !== undefined) patch[key] = input[key] ?? null;
  }
  if (input.startsAt !== undefined) patch.startsAt = new Date(input.startsAt);

  await db.update(appointments).set(patch).where(ownedRow(appointments, appointmentId, businessId));
  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'appointment.updated',
    entityType: 'appointment',
    entityId: appointmentId,
    summary: `${actor.name} updated appointment "${existing.title}".`,
  });

  return getAppointment(businessId, appointmentId);
}

export async function deleteAppointment(businessId: string, appointmentId: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select().from(appointments).where(ownedRow(appointments, appointmentId, businessId)).limit(1);
  if (!existing) throw notFound('That appointment');
  await db.delete(appointments).where(ownedRow(appointments, appointmentId, businessId));
  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'appointment.deleted',
    entityType: 'appointment',
    entityId: appointmentId,
    summary: `${actor.name} cancelled appointment "${existing.title}".`,
  });
}

export function toAppointmentView(
  appointment: typeof appointments.$inferSelect,
  customerName: string | null,
  productName: string | null,
  staffName: string | null,
): AppointmentView {
  return {
    id: appointment.id,
    title: appointment.title,
    customerId: appointment.customerId,
    customerName,
    productId: appointment.productId,
    productName,
    staffId: appointment.staffId,
    staffName,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: new Date(appointment.startsAt.getTime() + appointment.durationMinutes * 60_000).toISOString(),
    durationMinutes: appointment.durationMinutes,
    status: appointment.status,
    location: appointment.location,
    notes: appointment.notes,
    createdAt: appointment.createdAt.toISOString(),
  };
}
