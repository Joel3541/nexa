import { env } from '@nexa/config';
import { SmtpAdapter } from './smtp.js';

/**
 * Outbound communication abstraction (email / SMS / WhatsApp / push).
 *
 * The development adapter writes to the server log and returns
 * `simulated: true`. Callers persist that flag, so the product can honestly
 * tell a user "prepared, not delivered" instead of implying a real send.
 */

export type MessageChannel = 'email' | 'sms' | 'whatsapp' | 'push';

export interface OutboundMessage {
  channel: MessageChannel;
  to: string;
  subject?: string | null;
  body: string;
  /** Free-form context persisted alongside the outbox row. */
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  provider: string;
  status: 'sent' | 'queued' | 'failed';
  simulated: boolean;
  providerRef?: string;
  error?: string;
}

export interface MessageChannelAdapter {
  readonly channel: MessageChannel;
  readonly provider: string;
  readonly simulated: boolean;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}

class ConsoleAdapter implements MessageChannelAdapter {
  readonly simulated = true;
  readonly provider = 'console';

  constructor(readonly channel: MessageChannel) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const header = `[nexa:${this.channel}] → ${message.to}`;
    const subject = message.subject ? ` | ${message.subject}` : '';
    // Development visibility only. Nothing leaves the machine.
    console.log(`${header}${subject}\n${indent(message.body)}\n`);
    return { provider: this.provider, status: 'sent', simulated: true };
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * Adapters are memoised because a real transport owns a connection pool.
 * Building one per message would open a fresh TCP+TLS handshake for every
 * reminder in a batch.
 */
const instances = new Map<MessageChannel, MessageChannelAdapter>();

const ADAPTERS: Record<MessageChannel, () => MessageChannelAdapter> = {
  email: () => {
    if (env.EMAIL_PROVIDER === 'console') return new ConsoleAdapter('email');
    if (env.EMAIL_PROVIDER === 'smtp') return new SmtpAdapter();
    throw notImplemented('email', env.EMAIL_PROVIDER);
  },
  sms: () => {
    if (env.SMS_PROVIDER === 'console') return new ConsoleAdapter('sms');
    throw notImplemented('sms', env.SMS_PROVIDER);
  },
  whatsapp: () => {
    if (env.WHATSAPP_PROVIDER === 'console') return new ConsoleAdapter('whatsapp');
    throw notImplemented('whatsapp', env.WHATSAPP_PROVIDER);
  },
  push: () => new ConsoleAdapter('push'),
};

function notImplemented(channel: string, provider: string): Error {
  return new Error(
    `No adapter registered for ${channel} provider "${provider}". ` +
      `Implement MessageChannelAdapter in packages/integrations/src/messaging.ts.`,
  );
}

export function getChannelAdapter(channel: MessageChannel): MessageChannelAdapter {
  const existing = instances.get(channel);
  if (existing) return existing;
  const adapter = ADAPTERS[channel]();
  instances.set(channel, adapter);
  return adapter;
}

export function resetChannelAdaptersForTesting(): void {
  instances.clear();
}

/** True when no channel is wired to a real provider — surfaced in the UI. */
export function isSimulatedEnvironment(): boolean {
  return (
    env.EMAIL_PROVIDER === 'console' && env.SMS_PROVIDER === 'console' && env.WHATSAPP_PROVIDER === 'console'
  );
}
