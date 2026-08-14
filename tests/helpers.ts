import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { after, before } from 'node:test';
import { databaseDir } from '@nexa/config';
import { closeDb, runMigrations } from '@nexa/database';
import { createApp } from '../apps/api/src/app.js';
import type { Server } from 'node:http';

/**
 * Test harness.
 *
 * Boots the *real* Express app against a throwaway PGlite database on an
 * ephemeral port. Nothing is mocked: requests go through the same middleware
 * chain, the same auth, the same tenancy scoping and the same SQL as
 * production. A test that passes here exercises the shipped code path.
 */

let server: Server | null = null;
let baseUrl = '';

export async function startTestServer(): Promise<string> {
  if (server) return baseUrl;
  // Each run starts from an empty database so tests never depend on order.
  rmSync(databaseDir(), { recursive: true, force: true });
  await runMigrations();
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  await closeDb();
}

/** Registers lifecycle hooks for a test file. */
export function useTestServer(): void {
  before(async () => {
    await startTestServer();
  });
  after(async () => {
    await stopTestServer();
  });
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * A client bound to one signed-in user. Holds its own cookie jar and active
 * business, which is what makes cross-tenant tests meaningful.
 */
export class TestClient {
  private cookie = '';
  businessId: string | null = null;

  constructor(private readonly base: string) {}

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    options: { businessId?: string | null } = {},
  ): Promise<ApiResponse<T>> {
    const businessId = options.businessId !== undefined ? options.businessId : this.businessId;
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(businessId ? { 'x-nexa-business': businessId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      if (raw.startsWith('nexa_session=')) {
        const value = raw.split(';')[0]!;
        this.cookie = value.endsWith('nexa_session=') ? '' : value;
      }
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  get = <T = any>(path: string, options?: { businessId?: string | null }) =>
    this.request<T>('GET', path, undefined, options);
  post = <T = any>(path: string, body?: unknown, options?: { businessId?: string | null }) =>
    this.request<T>('POST', path, body, options);
  patch = <T = any>(path: string, body?: unknown, options?: { businessId?: string | null }) =>
    this.request<T>('PATCH', path, body, options);
  delete = <T = any>(path: string, options?: { businessId?: string | null }) =>
    this.request<T>('DELETE', path, undefined, options);
}

let counter = 0;

/** Creates a signed-up user with a fully provisioned business. */
export async function createWorkspace(
  base: string,
  overrides: { name?: string; country?: string; taxEnabled?: boolean } = {},
): Promise<{ client: TestClient; businessId: string; email: string; password: string }> {
  counter += 1;
  const email = `owner${counter}-${Date.now()}@example.test`;
  const password = 'TestPassword123';
  const client = new TestClient(base);

  const registered = await client.post('/api/auth/register', {
    fullName: `Owner ${counter}`,
    email,
    password,
  });
  if (registered.status !== 201) throw new Error(`register failed: ${JSON.stringify(registered.body)}`);

  const created = await client.post('/api/business', {
    name: overrides.name ?? `Test Business ${counter}`,
    industry: 'Retail & Trading',
    country: overrides.country ?? 'GH',
  });
  if (created.status !== 201) throw new Error(`business create failed: ${JSON.stringify(created.body)}`);

  client.businessId = created.body.business.id as string;

  if (overrides.taxEnabled === false) {
    await client.patch('/api/business/settings', { taxEnabled: false });
  }

  return { client, businessId: client.businessId, email, password };
}

export const money = (major: number) => Math.round(major * 100);
