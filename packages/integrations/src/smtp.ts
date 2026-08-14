import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@nexa/config';
import type { DeliveryResult, MessageChannelAdapter, OutboundMessage } from './messaging.js';

/**
 * Real email delivery over SMTP.
 *
 * SMTP rather than a vendor SDK on purpose: every transactional provider worth
 * using (Postmark, SES, Resend, Mailgun, Brevo) speaks it, as does a business's
 * own mail server. One adapter therefore covers every market NEXA targets,
 * including places where a US-only vendor is not an option.
 *
 * Nothing here reports success it did not observe. If the server rejects a
 * recipient, that address comes back `failed` with the server's own reason —
 * the outbox row records the truth, and the UI shows it.
 */
export class SmtpAdapter implements MessageChannelAdapter {
  readonly channel = 'email' as const;
  readonly provider = 'smtp';
  readonly simulated = false;

  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 is implicit TLS; 587 connects in the clear and upgrades.
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      // A queued transactional email must never hold a request open.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      // Reuse the connection across a burst — a reminder run sends dozens.
      pool: true,
      maxConnections: 3,
    });
    return this.transporter;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const info = await this.getTransporter().sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject ?? '(no subject)',
        text: message.body,
        html: toHtml(message.body),
      });

      // An address the server explicitly rejected has not been delivered, even
      // though sendMail resolved. Reporting "sent" here would be a lie.
      if (info.rejected.length > 0) {
        return {
          provider: this.provider,
          status: 'failed',
          simulated: false,
          error: `Rejected by the mail server: ${info.rejected.join(', ')}`,
        };
      }

      return {
        provider: this.provider,
        status: 'sent',
        simulated: false,
        providerRef: info.messageId,
      };
    } catch (error) {
      return {
        provider: this.provider,
        status: 'failed',
        simulated: false,
        error: error instanceof Error ? error.message : 'SMTP delivery failed.',
      };
    }
  }

  /** Proves the credentials and the route before the first real send. */
  async verifyConnection(): Promise<void> {
    await this.getTransporter().verify();
  }

  async close(): Promise<void> {
    this.transporter?.close();
    this.transporter = null;
  }
}

/**
 * Minimal text-to-HTML so the message renders in clients that prefer HTML.
 *
 * Escaped first, then linkified. The body can contain a customer's own name or
 * a note they typed; interpolating that into markup unescaped would be a stored
 * XSS in the recipient's mail client.
 */
function toHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const linked = escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" style="color:#4f46e5">${url}</a>`,
  );

  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#1f2433;max-width:560px">` +
    linked
      .split('\n\n')
      .map((paragraph) => `<p style="margin:0 0 14px">${paragraph.replace(/\n/g, '<br>')}</p>`)
      .join('') +
    `</div>`
  );
}
