import { campaigns, customers, getDb, messageOutbox } from '@nexa/database';
import { getChannelAdapter, type MessageChannel } from '@nexa/integrations';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAudit } from '../db/records.js';
import { ownedRow } from '../db/scope.js';
import type { Actor } from './customers.service.js';

export interface CampaignView {
  id: string;
  name: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string;
  segment: string | null;
  audienceCount: number;
  sentAt: string | null;
  createdAt: string;
}

export async function listCampaigns(businessId: string, limit = 25): Promise<CampaignView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.businessId, businessId))
    .orderBy(desc(campaigns.createdAt))
    .limit(limit);
  return rows.map(toCampaignView);
}

export async function createCampaign(
  businessId: string,
  input: { name: string; channel: 'email' | 'sms' | 'whatsapp'; subject?: string; body: string; segment?: string; customerIds?: string[] },
  actor: Actor,
): Promise<CampaignView> {
  const db = await getDb();

  const audience = input.customerIds?.length
    ? await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.businessId, businessId), inArray(customers.id, input.customerIds)))
    : [];

  const [row] = await db
    .insert(campaigns)
    .values({
      businessId,
      name: input.name,
      channel: input.channel,
      // Campaigns are never created in a sendable state. Sending is a separate,
      // explicitly authorised action.
      status: 'draft',
      subject: input.subject ?? null,
      body: input.body,
      segment: input.segment ?? null,
      audienceIds: audience.map((customer) => customer.id),
      audienceCount: audience.length,
      createdByUserId: actor.id,
      source: actor.source ?? 'user',
    })
    .returning();

  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    actorType: actor.source ?? 'user',
    action: 'campaign.drafted',
    entityType: 'campaign',
    entityId: row!.id,
    summary: `${actor.name} drafted campaign "${input.name}" for ${audience.length} customers.`,
    metadata: { channel: input.channel, audienceCount: audience.length, segment: input.segment ?? null },
  });

  return toCampaignView(row!);
}

/**
 * Sends a drafted campaign.
 *
 * Requires `campaigns:send`, which the AI never holds on its own — a campaign
 * the assistant drafted still needs a human to press send. Each recipient gets
 * an outbox row recording whether delivery was real or simulated.
 */
export async function sendCampaign(
  businessId: string,
  campaignId: string,
  actor: Actor,
): Promise<{ campaign: CampaignView; delivered: number; simulated: boolean; skipped: number }> {
  const db = await getDb();
  const [campaign] = await db.select().from(campaigns).where(ownedRow(campaigns, campaignId, businessId)).limit(1);
  if (!campaign) throw notFound('That campaign');
  if (campaign.status === 'sent') throw badRequest('That campaign has already been sent.');
  if (campaign.audienceIds.length === 0) throw badRequest('That campaign has no recipients.');

  const recipients = await db
    .select({ id: customers.id, name: customers.name, email: customers.email, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), inArray(customers.id, campaign.audienceIds)));

  const channel = campaign.channel as MessageChannel;
  const adapter = getChannelAdapter(channel);
  let delivered = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const to = channel === 'email' ? recipient.email : recipient.phone;
    if (!to) {
      skipped += 1;
      continue;
    }
    const body = campaign.body.replaceAll('{{name}}', recipient.name.split(' ')[0] ?? recipient.name);
    const result = await adapter.send({ channel, to, subject: campaign.subject, body });
    await db.insert(messageOutbox).values({
      businessId,
      channel,
      provider: adapter.provider,
      recipient: to,
      subject: campaign.subject,
      body,
      status: result.status,
      simulated: result.simulated,
      campaignId,
      customerId: recipient.id,
      sentAt: new Date(),
    });
    if (result.status !== 'failed') delivered += 1;
  }

  const [updated] = await db
    .update(campaigns)
    .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
    .where(ownedRow(campaigns, campaignId, businessId))
    .returning();

  await writeAudit(db, {
    businessId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'campaign.sent',
    entityType: 'campaign',
    entityId: campaignId,
    summary: `${actor.name} sent campaign "${campaign.name}" to ${delivered} recipients${adapter.simulated ? ' (simulated — no live provider configured)' : ''}.`,
    metadata: { delivered, skipped, simulated: adapter.simulated },
  });

  return { campaign: toCampaignView(updated!), delivered, simulated: adapter.simulated, skipped };
}

function toCampaignView(row: typeof campaigns.$inferSelect): CampaignView {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    body: row.body,
    segment: row.segment,
    audienceCount: row.audienceCount,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export { sql };
