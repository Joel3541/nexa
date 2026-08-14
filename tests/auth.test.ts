import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TestClient, createWorkspace, startTestServer, useTestServer } from './helpers.js';

describe('authentication', () => {
  useTestServer();

  it('registers a user, starts a session, and reports no business until onboarding', async () => {
    const base = await startTestServer();
    const client = new TestClient(base);

    const registered = await client.post('/api/auth/register', {
      fullName: 'Nana Owusu',
      email: `nana-${Date.now()}@example.test`,
      password: 'StrongPass123',
    });

    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.fullName, 'Nana Owusu');
    assert.equal(registered.body.business, null, 'a new user has no business until onboarding');
    assert.equal(registered.body.permissions.length, 0);
    // The password must never come back, in any form.
    assert.ok(!JSON.stringify(registered.body).toLowerCase().includes('password'));
  });

  it('rejects a weak password with a field-level message', async () => {
    const base = await startTestServer();
    const client = new TestClient(base);
    const response = await client.post('/api/auth/register', {
      fullName: 'Weak Password',
      email: `weak-${Date.now()}@example.test`,
      password: 'short',
    });

    assert.equal(response.status, 400);
    assert.ok(response.body.error.fields?.password, 'should point at the password field');
  });

  it('refuses a duplicate email', async () => {
    const base = await startTestServer();
    const email = `dupe-${Date.now()}@example.test`;
    const first = new TestClient(base);
    const second = new TestClient(base);

    await first.post('/api/auth/register', { fullName: 'First', email, password: 'StrongPass123' });
    const duplicate = await second.post('/api/auth/register', { fullName: 'Second', email, password: 'StrongPass123' });

    assert.equal(duplicate.status, 409);
  });

  it('signs in with the right password and refuses the wrong one, without revealing which was wrong', async () => {
    const base = await startTestServer();
    const email = `login-${Date.now()}@example.test`;
    const client = new TestClient(base);
    await client.post('/api/auth/register', { fullName: 'Login User', email, password: 'StrongPass123' });

    const wrongPassword = await new TestClient(base).post('/api/auth/login', { email, password: 'WrongPass123' });
    const unknownEmail = await new TestClient(base).post('/api/auth/login', {
      email: `nobody-${Date.now()}@example.test`,
      password: 'StrongPass123',
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    // Identical wording: the response must not disclose whether the account exists.
    assert.equal(wrongPassword.body.error.message, unknownEmail.body.error.message);

    const success = await new TestClient(base).post('/api/auth/login', { email, password: 'StrongPass123' });
    assert.equal(success.status, 200);
    assert.equal(success.body.user.email, email);
  });

  it('ends the session on logout', async () => {
    const base = await startTestServer();
    const { client } = await createWorkspace(base);

    const before = await client.get('/api/customers');
    assert.equal(before.status, 200);

    await client.post('/api/auth/logout');

    const after = await client.get('/api/customers');
    assert.equal(after.status, 401, 'the session must be revoked server-side, not just cleared client-side');
  });

  it('does not disclose whether an address is registered on password reset', async () => {
    const base = await startTestServer();
    const email = `reset-${Date.now()}@example.test`;
    const client = new TestClient(base);
    await client.post('/api/auth/register', { fullName: 'Reset User', email, password: 'StrongPass123' });

    const known = await new TestClient(base).post('/api/auth/forgot-password', { email });
    const unknown = await new TestClient(base).post('/api/auth/forgot-password', {
      email: `ghost-${Date.now()}@example.test`,
    });

    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(known.body, unknown.body);
  });
});
