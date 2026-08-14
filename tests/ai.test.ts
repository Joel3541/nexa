import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyForTesting } from '@nexa/ai';
import { createWorkspace, money, startTestServer, useTestServer } from './helpers.js';

/**
 * AI safety and grounding.
 *
 * These tests encode the product's central promise: the assistant reports only
 * what the database actually contains, and never changes anything without a
 * human decision.
 */
describe('AI assistant', () => {
  useTestServer();

  async function seedBusiness() {
    const base = await startTestServer();
    const workspace = await createWorkspace(base, { taxEnabled: false });
    const { client } = workspace;

    const customer = await client.post('/api/customers', {
      name: 'Adwoa Mensah',
      email: `adwoa-${Date.now()}@example.test`,
    });
    const product = await client.post('/api/products', {
      name: 'Test Serum',
      kind: 'physical',
      sellingPrice: money(100),
      costPrice: money(40),
      quantity: 30,
      minStock: 5,
    });

    for (let i = 0; i < 3; i += 1) {
      await client.post('/api/orders', {
        items: [{ productId: product.body.id, quantity: 1, discountMinor: 0 }],
        discountMinor: 0,
        customerId: customer.body.id,
        status: 'confirmed',
        payment: { amountMinor: money(100), method: 'cash' },
      });
    }

    // An invoice that is already past due, so "who owes me money" has an answer.
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const invoice = await client.post('/api/invoices', {
      customerId: customer.body.id,
      items: [{ name: 'Overdue Service', quantity: 1, unitPrice: money(250), discountMinor: 0 }],
      discountMinor: 0,
      issueDate: past,
      dueDate: past,
      status: 'sent',
    });

    return { ...workspace, customerId: customer.body.id, productId: product.body.id, invoiceId: invoice.body.id };
  }

  it('answers with figures that match the API, not invented ones', async () => {
    const { client } = await seedBusiness();

    const dashboard = await client.get('/api/dashboard');
    const revenue = dashboard.body.finance.revenue.value as number;

    const chat = await client.post('/api/ai/chat', { message: 'How did my business perform this month?' });
    assert.equal(chat.status, 200);

    const content = chat.body.message.content as string;
    // GH₵300.00 formatted — the exact figure the dashboard reports.
    const expected = (revenue / 100).toFixed(2);
    assert.ok(content.includes(expected), `assistant should quote the real revenue (${expected}); said: ${content}`);
    assert.ok(chat.body.message.toolCalls.length > 0, 'an answer must be backed by tool calls');
    assert.ok(
      chat.body.message.toolCalls.every((call: any) => call.status === 'ok'),
      'no tool call should have failed',
    );
  });

  it('finds overdue money and reports the true count', async () => {
    const { client } = await seedBusiness();

    const chat = await client.post('/api/ai/chat', { message: 'Who owes me money?' });
    const content = chat.body.message.content as string;

    assert.ok(content.includes('250.00'), `should quote the overdue balance; said: ${content}`);
    assert.ok(content.toLowerCase().includes('overdue'));
  });

  it('proposes consequential actions instead of performing them', async () => {
    const { client } = await seedBusiness();

    const before = await client.get('/api/tasks');
    const beforeCount = before.body.total as number;

    const chat = await client.post('/api/ai/chat', {
      message: 'Create a follow-up task for every overdue invoice',
    });

    const pending = chat.body.message.pendingActions;
    assert.equal(pending.length, 1, 'a write tool should produce exactly one proposal');
    assert.equal(pending[0].status, 'proposed');
    assert.ok(pending[0].preview.length > 0, 'the user must see what would happen');

    // The wording must not claim the work is done.
    const content = (chat.body.message.content as string).toLowerCase();
    assert.ok(
      content.includes('approval') || content.includes('has not been created'),
      `the assistant must not imply it acted; said: ${content}`,
    );

    const after = await client.get('/api/tasks');
    assert.equal(after.body.total, beforeCount, 'nothing may be created before approval');
  });

  it('executes only after approval, and records the result', async () => {
    const { client } = await seedBusiness();

    const chat = await client.post('/api/ai/chat', {
      message: 'Create a follow-up task for every overdue invoice',
    });
    const action = chat.body.message.pendingActions[0];

    const before = await client.get('/api/tasks');
    const approved = await client.post(`/api/ai/actions/${action.id}/approve`, {});

    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'executed');

    const after = await client.get('/api/tasks');
    assert.ok(after.body.total > before.body.total, 'approval should actually create the tasks');

    // The created task must be attributed to the AI, not to the human.
    const aiTask = after.body.data.find((task: any) => task.createdBySource === 'ai');
    assert.ok(aiTask, 'AI-created work must be labelled as such');

    // Approving twice must not double-execute.
    const replay = await client.post(`/api/ai/actions/${action.id}/approve`, {});
    assert.equal(replay.status, 400);
  });

  it('changes nothing when an action is rejected', async () => {
    const { client } = await seedBusiness();

    const chat = await client.post('/api/ai/chat', {
      message: 'Create a follow-up task for every overdue invoice',
    });
    const action = chat.body.message.pendingActions[0];

    const before = await client.get('/api/tasks');
    const rejected = await client.post(`/api/ai/actions/${action.id}/reject`, {});

    assert.equal(rejected.body.status, 'rejected');
    const after = await client.get('/api/tasks');
    assert.equal(after.body.total, before.body.total);
  });

  it('writes an audit entry for every AI action it executes', async () => {
    const { client } = await seedBusiness();

    const chat = await client.post('/api/ai/chat', {
      message: 'Create a follow-up task for every overdue invoice',
    });
    await client.post(`/api/ai/actions/${chat.body.message.pendingActions[0].id}/approve`, {});

    const audit = await client.get('/api/audit');
    const executed = audit.body.find((entry: any) => entry.action === 'ai.action_executed');
    assert.ok(executed, 'an approved AI action must appear in the audit log');
    assert.equal(executed.actorType, 'ai');
  });

  it('only advertises tools the caller has permission to use', async () => {
    const { client } = await seedBusiness();
    const agents = await client.get('/api/ai/agents');

    assert.equal(agents.status, 200);
    const chief = agents.body.agents.find((agent: any) => agent.id === 'chief_of_staff');
    assert.ok(chief.tools.length > 0);

    // Every write tool must be flagged as approval-gated in the contract the
    // client renders — this is what the UI promises the user.
    for (const tool of chief.tools) {
      if (tool.kind === 'write') {
        assert.equal(tool.requiresApproval, true, `${tool.name} is a write tool and must require approval`);
      }
    }
  });

  it('says plainly when there is nothing to report rather than inventing a story', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base, { taxEnabled: false });

    const chat = await client.post('/api/ai/chat', { message: 'Who owes me money?' });
    const content = (chat.body.message.content as string).toLowerCase();

    assert.ok(
      content.includes('0.00') || content.includes('nothing') || content.includes('no '),
      `an empty business should get an honest empty answer; said: ${content}`,
    );
  });

  it('routes questions to the intent that matches them', () => {
    assert.equal(classifyForTesting('which customers have not bought in 90 days?'), 'inactive_customers');
    assert.equal(classifyForTesting('who are my top 5 customers?'), 'top_customers');
    assert.equal(classifyForTesting('who owes me money?'), 'owes_money');
    assert.equal(classifyForTesting('why did revenue fall?'), 'why_revenue_changed');
    assert.equal(classifyForTesting('what is running out of stock?'), 'low_stock');
    assert.equal(classifyForTesting('show me my biggest expenses'), 'expenses');
  });
});
