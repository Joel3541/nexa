import {
  createInvoiceSchema,
  createOrderSchema,
  listInvoicesSchema,
  listOrdersSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  updateOrderSchema,
} from '@nexa/types';
import { Router } from 'express';
import type { Request } from 'express';
import { handler, paginate, param, parse } from '../lib/http.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import type { TaxContext } from '../services/orders.service.js';
import {
  createOrder,
  getOrder,
  listOrders,
  recordOrderPayment,
  updateOrderStatus,
} from '../services/orders.service.js';
import {
  createInvoice,
  getInvoice,
  listInvoices,
  recordInvoicePayment,
  sendInvoice,
  updateInvoice,
  type InvoiceContext,
} from '../services/invoices.service.js';

export const ordersRouter: Router = Router();
export const invoicesRouter: Router = Router();

ordersRouter.use(requireAuth, requireBusiness);
invoicesRouter.use(requireAuth, requireBusiness);

const actor = (req: Request) => {
  const auth = getAuth(req);
  return { id: auth.user.id, name: auth.user.fullName };
};

/** Tax configuration travels with every document write, never re-read ad hoc. */
function taxContext(req: Request): TaxContext {
  const { settings } = getTenant(req);
  return {
    enabled: settings.taxEnabled,
    rate: Number(settings.taxRate),
    inclusive: settings.taxInclusive,
    label: settings.taxLabel,
  };
}

function invoiceContext(req: Request): InvoiceContext {
  const tenant = getTenant(req);
  return {
    ...taxContext(req),
    currency: tenant.business.currency,
    locale: tenant.business.locale,
    businessName: tenant.business.name,
    dueDays: tenant.settings.invoiceDueDays,
  };
}

/* ------------------------------- Sales ---------------------------------- */

ordersRouter.get(
  '/',
  requirePermission('orders:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(listOrdersSchema, req.query);
    const { rows, total } = await listOrders(tenant.business.id, query);
    res.json(paginate(rows, query.page, query.pageSize, total));
  }),
);

ordersRouter.post(
  '/',
  requirePermission('orders:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(createOrderSchema, req.body);
    res.status(201).json(await createOrder(tenant.business.id, input, actor(req), taxContext(req)));
  }),
);

ordersRouter.get(
  '/:id',
  requirePermission('orders:read'),
  handler(async (req, res) => {
    res.json(await getOrder(getTenant(req).business.id, param(req, 'id')));
  }),
);

ordersRouter.patch(
  '/:id',
  requirePermission('orders:write'),
  handler(async (req, res) => {
    const input = parse(updateOrderSchema, req.body);
    res.json(await updateOrderStatus(getTenant(req).business.id, param(req, 'id'), input, actor(req)));
  }),
);

ordersRouter.post(
  '/:id/payments',
  requirePermission('orders:write'),
  handler(async (req, res) => {
    const input = parse(recordPaymentSchema, req.body);
    res.status(201).json(await recordOrderPayment(getTenant(req).business.id, param(req, 'id'), input, actor(req)));
  }),
);

/* ------------------------------ Invoices --------------------------------- */

invoicesRouter.get(
  '/',
  requirePermission('invoices:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(listInvoicesSchema, req.query);
    const { rows, total } = await listInvoices(tenant.business.id, query);
    res.json(paginate(rows, query.page, query.pageSize, total));
  }),
);

invoicesRouter.post(
  '/',
  requirePermission('invoices:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(createInvoiceSchema, req.body);
    res.status(201).json(await createInvoice(tenant.business.id, input, actor(req), invoiceContext(req)));
  }),
);

invoicesRouter.get(
  '/:id',
  requirePermission('invoices:read'),
  handler(async (req, res) => {
    res.json(await getInvoice(getTenant(req).business.id, param(req, 'id')));
  }),
);

invoicesRouter.patch(
  '/:id',
  requirePermission('invoices:write'),
  handler(async (req, res) => {
    const input = parse(updateInvoiceSchema, req.body);
    res.json(await updateInvoice(getTenant(req).business.id, param(req, 'id'), input, actor(req)));
  }),
);

invoicesRouter.post(
  '/:id/payments',
  requirePermission('invoices:write'),
  handler(async (req, res) => {
    const input = parse(recordPaymentSchema, req.body);
    res.status(201).json(await recordInvoicePayment(getTenant(req).business.id, param(req, 'id'), input, actor(req)));
  }),
);

invoicesRouter.post(
  '/:id/send',
  requirePermission('invoices:send'),
  handler(async (req, res) => {
    const result = await sendInvoice(getTenant(req).business.id, param(req, 'id'), actor(req), invoiceContext(req));
    res.json({
      invoice: result.invoice,
      simulated: result.simulated,
      recipient: result.recipient,
      // The client shows this verbatim; it must not overstate what happened.
      message: result.simulated
        ? `Prepared for ${result.recipient}. No live email provider is configured, so nothing was actually delivered — the message is in your outbox.`
        : `Sent to ${result.recipient}.`,
    });
  }),
);
