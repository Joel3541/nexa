import { adjustInventorySchema, createProductSchema, listProductsSchema, updateProductSchema } from '@nexa/types';
import { Router } from 'express';
import { handler, paginate, param, parse } from '../lib/http.js';
import { requireAuth, requireBusiness, requirePermission } from '../middleware/auth.js';
import { getAuth, getTenant } from '../middleware/context.js';
import {
  adjustInventory,
  createProduct,
  deleteProduct,
  getProduct,
  inventoryValuation,
  listCategories,
  listMovements,
  listProducts,
  lowStockProducts,
  updateProduct,
} from '../services/products.service.js';

export const productsRouter: Router = Router();

productsRouter.use(requireAuth, requireBusiness);

const actor = (req: Parameters<typeof getAuth>[0]) => {
  const auth = getAuth(req);
  return { id: auth.user.id, name: auth.user.fullName };
};

productsRouter.get(
  '/',
  requirePermission('products:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const query = parse(listProductsSchema, req.query);
    const { rows, total } = await listProducts(tenant.business.id, query, tenant.settings.lowStockThreshold);
    res.json(paginate(rows, query.page, query.pageSize, total));
  }),
);

productsRouter.get(
  '/categories',
  requirePermission('products:read'),
  handler(async (req, res) => {
    res.json(await listCategories(getTenant(req).business.id));
  }),
);

productsRouter.get(
  '/low-stock',
  requirePermission('inventory:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    res.json(await lowStockProducts(tenant.business.id, tenant.settings.lowStockThreshold, 50));
  }),
);

productsRouter.get(
  '/valuation',
  requirePermission('inventory:read'),
  handler(async (req, res) => {
    res.json(await inventoryValuation(getTenant(req).business.id));
  }),
);

productsRouter.post(
  '/',
  requirePermission('products:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(createProductSchema, req.body);
    res.status(201).json(await createProduct(tenant.business.id, input, actor(req), tenant.settings.lowStockThreshold));
  }),
);

productsRouter.get(
  '/:id',
  requirePermission('products:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    res.json(await getProduct(tenant.business.id, param(req, 'id'), tenant.settings.lowStockThreshold));
  }),
);

productsRouter.patch(
  '/:id',
  requirePermission('products:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(updateProductSchema, req.body);
    res.json(await updateProduct(tenant.business.id, param(req, 'id'), input, actor(req), tenant.settings.lowStockThreshold));
  }),
);

productsRouter.delete(
  '/:id',
  requirePermission('products:delete'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    await deleteProduct(tenant.business.id, param(req, 'id'), actor(req));
    res.json({ ok: true });
  }),
);

productsRouter.get(
  '/:id/movements',
  requirePermission('inventory:read'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    res.json(await listMovements(tenant.business.id, param(req, 'id')));
  }),
);

productsRouter.post(
  '/:id/adjust',
  requirePermission('inventory:write'),
  handler(async (req, res) => {
    const tenant = getTenant(req);
    const input = parse(adjustInventorySchema, req.body);
    res.json(
      await adjustInventory(
        tenant.business.id,
        param(req, 'id'),
        { quantityDelta: input.quantityDelta, reason: input.reason, unitCost: input.unitCost, note: input.note },
        actor(req),
        tenant.settings.lowStockThreshold,
      ),
    );
  }),
);
