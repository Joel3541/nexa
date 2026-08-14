import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt (memory-hard, in the Node standard library).
 *
 * Chosen over bcrypt/argon2 deliberately: no native compilation step, so the
 * project installs and runs identically on every platform and in CI. Stored
 * format is versioned — `scrypt$1$salt$hash` — so parameters can be raised
 * later and old hashes upgraded transparently on next login.
 */
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH);
  return `scrypt$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2]!, 'base64');
  const expected = Buffer.from(parts[3]!, 'base64');
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length);
  // Constant-time comparison — never a plain `===` on secret material.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Opaque session/verification token. Only the SHA-256 digest is stored. */
export function generateToken(): { token: string; hash: string } {
  const token = `${randomUUID().replace(/-/g, '')}${randomBytes(16).toString('hex')}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Unicode combining diacritical marks block. */
const COMBINING_START = 0x300;
const COMBINING_END = 0x36f;

function stripDiacritics(value: string): string {
  let out = '';
  for (const char of value.normalize('NFKD')) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= COMBINING_START && code <= COMBINING_END) continue;
    out += char;
  }
  return out;
}

export function slugify(value: string): string {
  return stripDiacritics(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
