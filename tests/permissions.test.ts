import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { permissionsForRole, roleHasPermission } from '@nexa/types';
import { TestClient, createWorkspace, money, startTestServer, useTestServer } from './helpers.js';

/**
 * Role-based authorization.
 *
 * The client hides what a role cannot do; these tests prove the server refuses
 * it regardless of what the client sends.
 */
describe('permissions', () => {
  useTestServer();

  /** Adds a member with a given role and returns a client signed in as them. */
  async function addMember(base: string, owner: Awaited<ReturnType<typeof createWorkspace>>, role: string) {
    const email = `member-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = 'MemberPass123';

    const invited = await owner.client.post('/api/business/members', { email, role, fullName: `${role} member` });
    assert.equal(invited.status, 201, `invite failed: ${JSON.stringify(invited.body)}`);

    // Invited users have an unusable password by design, so set one through
    // the reset flow — the same path a real teammate would take.
    const { getDb, verificationTokens, users } = await import('@nexa/database');
    const { eq, desc, and } = await import('drizzle-orm');
    const { generateToken } = await import('../apps/api/src/lib/crypto.js');
    const db = await getDb();

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const { token, hash } = generateToken();
    await db.insert(verificationTokens).values({
      userId: user!.id,
      purpose: 'password_reset',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    void and;
    void desc;

    const client = new TestClient(base);
    const reset = await client.post('/api/auth/reset-password', { token, password });
    assert.equal(reset.status, 200);

    const login = await client.post('/api/auth/login', { email, password });
    assert.equal(login.status, 200);
    client.businessId = owner.businessId;
    return client;
  }

  it('maps roles to permission sets consistently', () => {
    assert.ok(roleHasPermission('owner', 'settings:manage'));
    assert.ok(roleHasPermission('admin', 'ai:approve_actions'));
    assert.ok(!roleHasPermission('manager', 'ai:approve_actions'));
    assert.ok(!roleHasPermission('staff', 'expenses:write'));
    assert.ok(!roleHasPermission('viewer', 'customers:write'));
    assert.ok(roleHasPermission('viewer', 'customers:read'));
    // A viewer must hold no write permission at all.
    assert.ok(permissionsForRole('viewer').every((permission) => !permission.includes(':write')));
  });

  it('lets a viewer read but refuses every write', async () => {
    const base = await startTestServer();
    const owner = await createWorkspace(base, { taxEnabled: false });
    const viewer = await addMember(base, owner, 'viewer');

    await owner.client.post('/api/customers', { name: 'Readable Customer' });

    const read = await viewer.get('/api/customers');
    assert.equal(read.status, 200);
    assert.equal(read.body.total, 1);

    const write = await viewer.post('/api/customers', { name: 'Should Not Exist' });
    assert.equal(write.status, 403);

    const stillOne = await owner.client.get('/api/customers');
    assert.equal(stillOne.body.total, 1, 'the refused write must not have happened');
  });

  it('refuses AI access to a role that does not have it', async () => {
    const base = await startTestServer();
    const owner = await createWorkspace(base, { taxEnabled: false });
    const viewer = await addMember(base, owner, 'viewer');

    const chat = await viewer.post('/api/ai/chat', { message: 'How is my business doing?' });
    assert.equal(chat.status, 403);
  });

  it('lets staff use the AI but not approve its actions', async () => {
    const base = await startTestServer();
    const owner = await createWorkspace(base, { taxEnabled: false });
    const staff = await addMember(base, owner, 'staff');

    const chat = await staff.post('/api/ai/chat', { message: 'What should I focus on today?' });
    assert.equal(chat.status, 200, 'staff should be able to ask questions');

    const proposal = await staff.post('/api/ai/chat', {
      message: 'Create a task to call the supplier tomorrow',
    });
    const pending = proposal.body.message.pendingActions;
    assert.equal(pending.length, 1);

    const approval = await staff.post(`/api/ai/actions/${pending[0].id}/approve`, {});
    assert.equal(approval.status, 403, 'staff must not be able to approve AI actions');
  });

  it('prevents granting a role at or above your own', async () => {
    const base = await startTestServer();
    const owner = await createWorkspace(base, { taxEnabled: false });
    const admin = await addMember(base, owner, 'admin');

    const escalate = await admin.post('/api/business/members', {
      email: `escalated-${Date.now()}@example.test`,
      role: 'owner',
    });
    assert.equal(escalate.status, 403);

    const sideways = await admin.post('/api/business/members', {
      email: `sideways-${Date.now()}@example.test`,
      role: 'admin',
    });
    assert.equal(sideways.status, 403, 'an admin must not be able to mint another admin');
  });

  it('blocks a manager from settings even though they can price products', async () => {
    const base = await startTestServer();
    const owner = await createWorkspace(base, { taxEnabled: false });
    const manager = await addMember(base, owner, 'manager');

    const product = await manager.post('/api/products', {
      name: 'Manager Product',
      kind: 'physical',
      sellingPrice: money(50),
      costPrice: money(20),
      quantity: 5,
      minStock: 1,
    });
    assert.equal(product.status, 201, 'a manager can manage the catalogue');

    const settings = await manager.patch('/api/business/settings', { taxRate: 0 });
    assert.equal(settings.status, 403, 'but not change business settings');
  });
});
