import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TestClient, createWorkspace, money, startTestServer, stopTestServer, useTestServer } from './helpers.js';

/**
 * Tenant isolation.
 *
 * This is the most important test file in the repository. NEXA is a multi-tenant
 * system of record: a single leak between businesses would be fatal to the
 * product's premise. Each case asserts that business B is invisible to A —
 * including that A cannot even learn whether a given record exists.
 */
describe('tenant isolation', () => {
  useTestServer();

  it('never returns another business’s records, and answers 404 rather than 403', async () => {
    const base = await startTestServer();
    const alpha = await createWorkspace(base, { name: 'Alpha Traders' });
    const beta = await createWorkspace(base, { name: 'Beta Salon' });

    // Alpha creates a full set of records.
    const customer = await alpha.client.post('/api/customers', { name: 'Alpha Customer', phone: '+233240000001' });
    assert.equal(customer.status, 201);

    const product = await alpha.client.post('/api/products', {
      name: 'Alpha Product',
      kind: 'physical',
      sellingPrice: money(50),
      costPrice: money(20),
      quantity: 10,
      minStock: 2,
    });
    assert.equal(product.status, 201);

    const order = await alpha.client.post('/api/orders', {
      items: [{ productId: product.body.id, quantity: 1, discountMinor: 0 }],
      discountMinor: 0,
      customerId: customer.body.id,
      status: 'confirmed',
    });
    assert.equal(order.status, 201);

    const invoice = await alpha.client.post('/api/invoices', {
      customerId: customer.body.id,
      items: [{ name: 'Consulting', quantity: 1, unitPrice: money(100), discountMinor: 0 }],
      discountMinor: 0,
      status: 'sent',
    });
    assert.equal(invoice.status, 201);

    const task = await alpha.client.post('/api/tasks', { title: 'Alpha task', priority: 'medium', status: 'todo', recurrence: 'none' });
    assert.equal(task.status, 201);

    // Beta, using its own valid session and its own business header, must not
    // be able to reach any of them by id.
    const targets: Array<[string, string]> = [
      ['customer', `/api/customers/${customer.body.id}`],
      ['product', `/api/products/${product.body.id}`],
      ['order', `/api/orders/${order.body.id}`],
      ['invoice', `/api/invoices/${invoice.body.id}`],
      ['task', `/api/tasks/${task.body.id}`],
    ];

    for (const [label, path] of targets) {
      const response = await beta.client.get(path);
      assert.equal(response.status, 404, `${label} should be 404 for another tenant, got ${response.status}`);
      assert.equal(response.body?.error?.code, 'not_found', `${label} must not reveal existence`);
    }
  });

  it('scopes list endpoints so a tenant only ever sees its own rows', async () => {
    const base = await startTestServer();
    const alpha = await createWorkspace(base, { name: 'List Alpha' });
    const beta = await createWorkspace(base, { name: 'List Beta' });

    await alpha.client.post('/api/customers', { name: 'Only In Alpha' });
    await beta.client.post('/api/customers', { name: 'Only In Beta' });

    const alphaList = await alpha.client.get('/api/customers');
    const betaList = await beta.client.get('/api/customers');

    assert.equal(alphaList.body.total, 1);
    assert.equal(betaList.body.total, 1);
    assert.equal(alphaList.body.data[0].name, 'Only In Alpha');
    assert.equal(betaList.body.data[0].name, 'Only In Beta');

    // Search must be scoped too — it is the easiest place to leak.
    const search = await beta.client.get('/api/search?q=Alpha');
    const names = JSON.stringify(search.body);
    assert.ok(!names.includes('Only In Alpha'), 'search leaked another tenant’s customer');
  });

  it('rejects a forged business header for a business the caller is not a member of', async () => {
    const base = await startTestServer();
    const alpha = await createWorkspace(base, { name: 'Header Alpha' });
    const beta = await createWorkspace(base, { name: 'Header Beta' });

    const customer = await alpha.client.post('/api/customers', { name: 'Alpha Private' });
    assert.equal(customer.status, 201);

    // Beta points the header at Alpha's business id. Membership, not the
    // header, decides the tenant — so this must not resolve to Alpha.
    const forged = await beta.client.get(`/api/customers/${customer.body.id}`, { businessId: alpha.businessId });
    assert.ok(
      forged.status === 403 || forged.status === 404,
      `forged header should be denied, got ${forged.status}`,
    );
    assert.ok(JSON.stringify(forged.body).indexOf('Alpha Private') === -1);

    const forgedList = await beta.client.get('/api/customers', { businessId: alpha.businessId });
    if (forgedList.status === 200) {
      const leaked = JSON.stringify(forgedList.body).includes('Alpha Private');
      assert.ok(!leaked, 'forged business header leaked another tenant’s data');
    }
  });

  it('keeps dashboard and analytics figures scoped to the calling business', async () => {
    const base = await startTestServer();
    const alpha = await createWorkspace(base, { name: 'Figures Alpha', taxEnabled: false });
    const beta = await createWorkspace(base, { name: 'Figures Beta', taxEnabled: false });

    const product = await alpha.client.post('/api/products', {
      name: 'Widget',
      kind: 'physical',
      sellingPrice: money(200),
      costPrice: money(80),
      quantity: 50,
      minStock: 5,
    });

    for (let i = 0; i < 3; i += 1) {
      await alpha.client.post('/api/orders', {
        items: [{ productId: product.body.id, quantity: 1, discountMinor: 0 }],
        discountMinor: 0,
        status: 'confirmed',
      });
    }

    const alphaDashboard = await alpha.client.get('/api/dashboard');
    const betaDashboard = await beta.client.get('/api/dashboard');

    assert.equal(alphaDashboard.body.finance.revenue.value, money(600));
    assert.equal(betaDashboard.body.finance.revenue.value, 0, 'a fresh tenant must see zero, not another tenant’s revenue');
  });

  it('requires authentication for every business endpoint', async () => {
    const base = await startTestServer();
    const anonymous = new TestClient(base);

    for (const path of ['/api/customers', '/api/products', '/api/orders', '/api/invoices', '/api/dashboard', '/api/ai/agents']) {
      const response = await anonymous.get(path);
      assert.equal(response.status, 401, `${path} should require a session`);
    }
  });
});

// Ensures the pool closes even if a test throws before its own hooks run.
process.on('beforeExit', () => {
  void stopTestServer();
});
