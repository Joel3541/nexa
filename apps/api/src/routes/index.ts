import { Router } from 'express';
import { aiRouter } from './ai.routes.js';
import { authRouter } from './auth.routes.js';
import { businessRouter } from './business.routes.js';
import { productsRouter } from './catalog.routes.js';
import { customersRouter } from './crm.routes.js';
import { expensesRouter } from './finance.routes.js';
import { insightsRouter } from './insights.routes.js';
import { invoicesRouter, ordersRouter } from './sales.routes.js';
import { appointmentsRouter, tasksRouter } from './work.routes.js';

/**
 * API surface, organised by domain boundary rather than by table.
 * Nothing here exposes a database row directly — every response is a view model
 * defined in @nexa/types.
 */
export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/business', businessRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/expenses', expensesRouter);
apiRouter.use('/tasks', tasksRouter);
apiRouter.use('/appointments', appointmentsRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/', insightsRouter);
