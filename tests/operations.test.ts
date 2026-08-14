import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkspace, money, startTestServer, useTestServer } from './helpers.js';

/**
 * Core business flows: the arithmetic and side effects a business owner is
 * trusting NEXA to get right.
 */
describe('core business operations', () => {
  useTestServer();

  it('records a sale, decrements stock and writes an inventory movement', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const product = await client.post('/api/products', {
      name: 'Shea Butter',
      kind: 'physical',
      sellingPrice: money(65),
      costPrice: money(28),
      quantity: 20,
      minStock: 5,
    });
    assert.equal(product.status, 201);

    const order = await client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 3, discountMinor: 0 }],
      discountMinor: 0,
      status: 'confirmed',
    });

    assert.equal(order.status, 201);
    assert.equal(order.body.subtotalMinor, money(195));
    assert.equal(order.body.totalMinor, money(195));
    assert.equal(order.body.costMinor, money(84));
    assert.equal(order.body.profitMinor, money(195) - money(84));

    const after = await client.get(`/api/products/${product.body.id}`);
    assert.equal(after.body.quantity, 17, 'stock must fall by the quantity sold');

    const movements = await client.get(`/api/products/${product.body.id}/movements`);
    const sale = movements.body.find((m: any) => m.reason === 'sale');
    assert.ok(sale, 'a sale must leave an inventory movement explaining the change');
    assert.equal(sale.quantityDelta, -3);
    assert.equal(sale.balanceAfter, 17);
  });

  it('refuses to oversell stock it does not have', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const product = await client.post('/api/products', {
      name: 'Limited Serum',
      kind: 'physical',
      sellingPrice: money(100),
      costPrice: money(40),
      quantity: 2,
      minStock: 0,
    });

    const order = await client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 5, discountMinor: 0 }],
      discountMinor: 0,
      status: 'confirmed',
    });

    assert.equal(order.status, 409);

    const unchanged = await client.get(`/api/products/${product.body.id}`);
    assert.equal(unchanged.body.quantity, 2, 'a rejected sale must not touch stock');
  });

  it('extracts tax from tax-inclusive prices rather than adding it', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base);

    // GH defaults to 15% VAT, inclusive.
    await client.patch('/api/business/settings', { taxEnabled: true, taxRate: 15, taxInclusive: true });

    const product = await client.post('/api/products', {
      name: 'Inclusive Item',
      kind: 'physical',
      sellingPrice: money(115),
      costPrice: money(50),
      quantity: 10,
      minStock: 0,
    });

    const order = await client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 1, discountMinor: 0 }],
      discountMinor: 0,
      status: 'confirmed',
    });

    // 115 inclusive of 15% => tax = 115 * 15/115 = 15, total stays 115.
    assert.equal(order.body.totalMinor, money(115), 'inclusive tax must not inflate the total');
    assert.equal(order.body.taxMinor, money(15));
  });

  it('adds tax on top when the market prices tax-exclusive', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { country: 'US' });

    await client.patch('/api/business/settings', { taxEnabled: true, taxRate: 10, taxInclusive: false });

    const product = await client.post('/api/products', {
      name: 'Exclusive Item',
      kind: 'physical',
      sellingPrice: money(100),
      costPrice: money(40),
      quantity: 10,
      minStock: 0,
    });

    const order = await client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 1, discountMinor: 0 }],
      discountMinor: 0,
      status: 'confirmed',
    });

    assert.equal(order.body.taxMinor, money(10));
    assert.equal(order.body.totalMinor, money(110));
  });

  it('tracks invoice balances and settles them through payments', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const customer = await client.post('/api/customers', { name: 'Invoice Customer', email: `inv-${Date.now()}@example.test` });

    const invoice = await client.post('/api/invoices', {
      customerId: customer.body.id,
      items: [{ name: 'Service', quantity: 2, unitPrice: money(150), discountMinor: 0 }],
      discountMinor: 0,
      status: 'sent',
    });

    assert.equal(invoice.status, 201);
    assert.equal(invoice.body.totalMinor, money(300));
    assert.equal(invoice.body.balanceMinor, money(300));

    const partial = await client.post(`/api/invoices/${invoice.body.id}/payments`, {
      amountMinor: money(100),
      method: 'mobile_money',
    });
    assert.equal(partial.body.status, 'partial');
    assert.equal(partial.body.balanceMinor, money(200));

    // Overpaying must be rejected, not silently accepted.
    const overpay = await client.post(`/api/invoices/${invoice.body.id}/payments`, {
      amountMinor: money(500),
      method: 'cash',
    });
    assert.equal(overpay.status, 400);

    const settle = await client.post(`/api/invoices/${invoice.body.id}/payments`, {
      amountMinor: money(200),
      method: 'cash',
    });
    assert.equal(settle.body.status, 'paid');
    assert.equal(settle.body.balanceMinor, 0);

    // The customer rollup must agree with the ledger.
    const updatedCustomer = await client.get(`/api/customers/${customer.body.id}`);
    assert.equal(updatedCustomer.body.outstandingMinor, 0);
  });

  it('keeps customer rollups consistent with orders', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const customer = await client.post('/api/customers', { name: 'Rollup Customer' });
    const product = await client.post('/api/products', {
      name: 'Rollup Product',
      kind: 'physical',
      sellingPrice: money(40),
      costPrice: money(15),
      quantity: 100,
      minStock: 0,
    });

    for (let i = 0; i < 4; i += 1) {
      const order = await client.post('/api/orders', {
        items: [{ productId: product.body.id, quantity: 2, discountMinor: 0 }],
        discountMinor: 0,
        customerId: customer.body.id,
        status: 'confirmed',
        payment: { amountMinor: money(80), method: 'cash' },
      });
      assert.equal(order.status, 201);
    }

    const updated = await client.get(`/api/customers/${customer.body.id}`);
    assert.equal(updated.body.orderCount, 4);
    assert.equal(updated.body.totalSpentMinor, money(320));
    assert.equal(updated.body.averageOrderMinor, money(80));
    assert.equal(updated.body.outstandingMinor, 0);
    assert.ok(updated.body.segments.includes('repeat'));
  });

  it('reports dashboard revenue that equals the sum of its orders', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const product = await client.post('/api/products', {
      name: 'Dashboard Product',
      kind: 'physical',
      sellingPrice: money(25),
      costPrice: money(10),
      quantity: 200,
      minStock: 0,
    });

    let expected = 0;
    for (const quantity of [1, 2, 3, 4]) {
      await client.post('/api/orders', {
        items: [{ productId: product.body.id, quantity, discountMinor: 0 }],
        discountMinor: 0,
        status: 'confirmed',
      });
      expected += money(25) * quantity;
    }

    await client.post('/api/expenses', { amountMinor: money(60), paymentMethod: 'cash', categoryName: 'Transport' });

    const dashboard = await client.get('/api/dashboard');
    assert.equal(dashboard.body.finance.revenue.value, expected);
    assert.equal(dashboard.body.finance.expenses.value, money(60));
    // Profit = revenue − tax − cost of goods − expenses.
    const cost = money(10) * (1 + 2 + 3 + 4);
    assert.equal(dashboard.body.finance.profit.value, expected - cost - money(60));
  });

  it('returns stock to the shelf when a sale is cancelled', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const product = await client.post('/api/products', {
      name: 'Cancellable',
      kind: 'physical',
      sellingPrice: money(30),
      costPrice: money(10),
      quantity: 10,
      minStock: 0,
    });

    const order = await client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 4, discountMinor: 0 }],
      discountMinor: 0,
      status: 'confirmed',
    });

    assert.equal((await client.get(`/api/products/${product.body.id}`)).body.quantity, 6);

    await client.patch(`/api/orders/${order.body.id}`, { status: 'cancelled' });

    const restored = await client.get(`/api/products/${product.body.id}`);
    assert.equal(restored.body.quantity, 10, 'cancelling must return the stock');

    const dashboard = await client.get('/api/dashboard');
    assert.equal(dashboard.body.finance.revenue.value, 0, 'cancelled orders must not count as revenue');
  });

  it('flags low stock and projects cover only when there is sales history', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const product = await client.post('/api/products', {
      name: 'Low Stock Item',
      kind: 'physical',
      sellingPrice: money(20),
      costPrice: money(8),
      quantity: 6,
      minStock: 10,
    });

    const lowStock = await client.get('/api/products/low-stock');
    assert.equal(lowStock.body.length, 1);
    assert.equal(lowStock.body[0].name, 'Low Stock Item');
    assert.equal(
      lowStock.body[0].daysOfStockRemaining,
      null,
      'with no sales, NEXA must decline to project rather than guess',
    );

    await client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 3, discountMinor: 0 }],
      discountMinor: 0,
      status: 'confirmed',
    });

    const withHistory = await client.get('/api/products/low-stock');
    assert.ok(withHistory.body[0].daysOfStockRemaining !== null, 'a projection should appear once demand exists');
    assert.ok(['high', 'medium', 'low'].includes(withHistory.body[0].stockConfidence));
  });

  it('archives rather than deletes a product that appears in past sales', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const product = await client.post('/api/products', {
      name: 'Historic Product',
      kind: 'physical',
      sellingPrice: money(15),
      costPrice: money(5),
      quantity: 10,
      minStock: 0,
    });

    await client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 1, discountMinor: 0 }],
      discountMinor: 0,
      status: 'confirmed',
    });

    await client.delete(`/api/products/${product.body.id}`);

    const stillThere = await client.get(`/api/products/${product.body.id}`);
    assert.equal(stillThere.status, 200, 'sold products must survive so history stays intact');
    assert.equal(stillThere.body.active, false, 'but they should be archived');
  });
});
