/**
 * `npm run email:verify [recipient@example.com]` — prove SMTP works.
 *
 * Deliberately usable **while `EMAIL_PROVIDER` is still `console`**. That is the
 * whole point: switching the provider is the step that can take the site down
 * (the config refuses to boot with `smtp` and no host), so the credentials need
 * to be provable *before* the switch rather than after. This constructs an SMTP
 * adapter directly from the SMTP_* settings and ignores EMAIL_PROVIDER.
 *
 * Two levels of proof:
 *
 *   npm run email:verify                     — handshake and authenticate only
 *   npm run email:verify you@example.com     — actually deliver a message
 *
 * The second is the one that matters. A successful handshake proves the
 * credentials; it does not prove the sender address is authorised, and an
 * unverified `from` domain is rejected at send time, not at login.
 *
 * Never prints the API key.
 */

import { env } from '@nexa/config';
import { SmtpAdapter } from '@nexa/integrations';

const PASS = '  [32mPASS[0m';
const FAIL = '  [31mFAIL[0m';
const INFO = '  [36m····[0m';
const WARN = '  [33mWARN[0m';

/** Enough to identify which credential is loaded, never enough to use it. */
function fingerprint(secret: string): string {
  if (secret.length < 8) return '(too short to be a valid key)';
  return `${secret.slice(0, 4)}…${secret.slice(-4)} (${secret.length} chars)`;
}

async function main() {
  const recipient = process.argv[2];

  console.log('\n[1mNEXA — SMTP verification[0m\n');
  console.log('[1m1. Configuration[0m');

  if (!env.SMTP_HOST) {
    console.log(`${FAIL} SMTP_HOST is not set.`);
    console.log('\nSet SMTP_HOST, SMTP_USER and SMTP_PASSWORD, then run this again.');
    console.log('For Resend: host smtp.resend.com, user "resend", password your re_… API key.\n');
    process.exit(1);
  }

  console.log(`${PASS} SMTP_HOST ${env.SMTP_HOST}:${env.SMTP_PORT} (implicit TLS: ${env.SMTP_SECURE})`);

  if (env.SMTP_HOST === 'smtp.resend.com' && env.SMTP_USER !== 'resend') {
    console.log(
      `${FAIL} SMTP_USER is "${env.SMTP_USER}" — Resend requires the literal string "resend", not an email address.`,
    );
    process.exit(1);
  }
  console.log(`${PASS} SMTP_USER ${env.SMTP_USER || '(none — only valid for an open relay)'}`);

  if (!env.SMTP_PASSWORD) {
    console.log(`${FAIL} SMTP_PASSWORD is empty.`);
    process.exit(1);
  }
  console.log(`${PASS} SMTP_PASSWORD ${fingerprint(env.SMTP_PASSWORD)}`);

  if (!env.EMAIL_FROM || env.EMAIL_FROM.endsWith('@example.com')) {
    console.log(`${WARN} EMAIL_FROM is "${env.EMAIL_FROM}" — not a real sending address.`);
    console.log(`${INFO} Resend accepts onboarding@resend.dev without a verified domain.`);
  } else {
    console.log(`${PASS} EMAIL_FROM ${env.EMAIL_FROM}`);
  }

  // Port sanity: mismatching implicit TLS and port is a hang, not an error.
  const implicitTlsPorts = new Set([465, 2465]);
  if (implicitTlsPorts.has(env.SMTP_PORT) && !env.SMTP_SECURE) {
    console.log(`${WARN} Port ${env.SMTP_PORT} expects implicit TLS — set SMTP_SECURE=true or the connection will hang.`);
  }
  if (!implicitTlsPorts.has(env.SMTP_PORT) && env.SMTP_SECURE) {
    console.log(`${WARN} SMTP_SECURE=true on port ${env.SMTP_PORT}, which expects STARTTLS. Try SMTP_SECURE=false.`);
  }

  const adapter = new SmtpAdapter();

  /* 2. Handshake ---------------------------------------------------------- */
  console.log('\n[1m2. Connecting[0m');
  try {
    await adapter.verifyConnection();
    console.log(`${PASS} authenticated with ${env.SMTP_HOST}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${FAIL} ${message}`);
    if (/auth/i.test(message)) {
      console.log(`${INFO} For Resend, the password is the API key itself and the username is "resend".`);
    }
    if (/ETIMEDOUT|ECONNREFUSED/i.test(message)) {
      console.log(`${INFO} Outbound SMTP may be blocked on this network. Port 587 is blocked less often than 465.`);
    }
    await adapter.close();
    process.exit(1);
  }

  /* 3. Real delivery ------------------------------------------------------ */
  if (!recipient) {
    console.log('\n[33mHandshake only.[0m The credentials work, but this has not proved that');
    console.log('a message actually arrives — an unverified sender domain is rejected at');
    console.log('send time, not at login. Run it again with an address you can check:\n');
    console.log('  npm run email:verify you@example.com\n');
    await adapter.close();
    process.exit(0);
  }

  console.log('\n[1m3. Sending a real message[0m');
  const result = await adapter.send({
    channel: 'email',
    to: recipient,
    subject: 'NEXA SMTP test',
    body:
      'This is a test from NEXA.\n\n' +
      'If you are reading it, outbound email works: password resets, email ' +
      'verification and invoice delivery will all reach their recipients.\n\n' +
      `Sent from ${env.SMTP_HOST} as ${env.EMAIL_FROM}.`,
  });

  if (result.status === 'sent') {
    console.log(`${PASS} accepted for delivery to ${recipient}`);
    if (result.providerRef) console.log(`${INFO} message id ${result.providerRef}`);
    console.log('\n[32m[1mSMTP is working.[0m Check the inbox — including spam — to confirm arrival.');
    console.log('Then set EMAIL_PROVIDER=smtp to switch the product over.\n');
    await adapter.close();
    process.exit(0);
  }

  console.log(`${FAIL} ${result.error ?? 'the server did not accept the message'}`);
  if (/domain|from|sender|verif/i.test(result.error ?? '')) {
    console.log(`${INFO} The sender domain is probably not verified. Try EMAIL_FROM=onboarding@resend.dev.`);
  }
  await adapter.close();
  process.exit(1);
}

main().catch(async (error) => {
  console.error('\nVerification crashed:', error);
  process.exit(1);
});
