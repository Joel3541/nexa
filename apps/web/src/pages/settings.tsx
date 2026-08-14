import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditLogView } from '@nexa/types';
import { PageHeader, Tabs } from '@/components/ui/data';
import { Skeleton, useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { dateTime, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

type Tab = 'business' | 'invoicing' | 'team' | 'audit';

export default function SettingsPage() {
  const { session, can, refresh } = useSession();
  const [tab, setTab] = useState<Tab>('business');

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'business', label: 'Business' },
    { id: 'invoicing', label: 'Invoicing & tax' },
    { id: 'team', label: 'Team' },
    ...(can('audit:read') ? [{ id: 'audit' as Tab, label: 'Audit log' }] : []),
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle={session?.business?.name} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'business' && <BusinessTab onSaved={refresh} />}
      {tab === 'invoicing' && <InvoicingTab onSaved={refresh} />}
      {tab === 'team' && <TeamTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}

function BusinessTab({ onSaved }: { onSaved: () => void }) {
  const { session, can } = useSession();
  const toast = useToast();
  const business = session?.business;
  const [form, setForm] = useState({
    name: business?.name ?? '',
    phone: business?.phone ?? '',
    email: business?.email ?? '',
    website: business?.website ?? '',
    addressLine1: business?.addressLine1 ?? '',
    city: business?.city ?? '',
    description: business?.description ?? '',
  });

  const save = useMutation({
    mutationFn: () => api.patch('/business', form),
    onSuccess: () => {
      toast.success('Saved');
      onSaved();
    },
    onError: (error) => toast.error('Could not save', error instanceof ApiRequestError ? error.message : undefined),
  });

  const disabled = !can('business:update');

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Business details" subtitle="These appear on your invoices and receipts." />
      <div className="space-y-4">
        <Field label="Business name" htmlFor="name">
          <Input id="name" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} disabled={disabled} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} disabled={disabled} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} disabled={disabled} />
          </Field>
          <Field label="Address" htmlFor="address">
            <Input id="address" value={form.addressLine1} onChange={(e) => setForm((c) => ({ ...c, addressLine1: e.target.value }))} disabled={disabled} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" value={form.city} onChange={(e) => setForm((c) => ({ ...c, city: e.target.value }))} disabled={disabled} />
          </Field>
          <Field label="Website" htmlFor="website">
            <Input id="website" value={form.website} onChange={(e) => setForm((c) => ({ ...c, website: e.target.value }))} disabled={disabled} />
          </Field>
          <Field label="Country" htmlFor="country" hint="Currency and tax follow the country">
            <Input id="country" value={`${business?.country} · ${business?.currency}`} disabled />
          </Field>
        </div>
        <Field label="Description" htmlFor="description">
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
            disabled={disabled}
          />
        </Field>
        {!disabled && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
              Save changes
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function InvoicingTab({ onSaved }: { onSaved: () => void }) {
  const { session, can } = useSession();
  const toast = useToast();
  const settings = session?.settings;
  const [form, setForm] = useState({
    taxEnabled: settings?.taxEnabled ?? false,
    taxRate: settings?.taxRate ?? 0,
    taxLabel: settings?.taxLabel ?? 'VAT',
    taxInclusive: settings?.taxInclusive ?? true,
    invoicePrefix: settings?.invoicePrefix ?? 'INV',
    invoiceDueDays: settings?.invoiceDueDays ?? 14,
    invoiceNotes: settings?.invoiceNotes ?? '',
    invoiceFooter: settings?.invoiceFooter ?? '',
    lowStockThreshold: settings?.lowStockThreshold ?? 5,
  });

  const save = useMutation({
    mutationFn: () => api.patch('/business/settings', form),
    onSuccess: () => {
      toast.success('Saved');
      onSaved();
    },
    onError: (error) => toast.error('Could not save', error instanceof ApiRequestError ? error.message : undefined),
  });

  const disabled = !can('settings:manage');

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardHeader title="Tax" subtitle="How tax is calculated on sales and invoices." />
        <div className="space-y-4">
          <Checkbox
            checked={form.taxEnabled}
            disabled={disabled}
            onChange={(e) => setForm((c) => ({ ...c, taxEnabled: e.target.checked }))}
            label="Charge tax on sales and invoices"
          />
          {form.taxEnabled && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Label" htmlFor="taxLabel">
                <Input id="taxLabel" value={form.taxLabel} onChange={(e) => setForm((c) => ({ ...c, taxLabel: e.target.value }))} disabled={disabled} />
              </Field>
              <Field label="Rate (%)" htmlFor="taxRate">
                <Input
                  id="taxRate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="tnum"
                  value={form.taxRate}
                  onChange={(e) => setForm((c) => ({ ...c, taxRate: Number(e.target.value) }))}
                  disabled={disabled}
                />
              </Field>
              <Field label="Pricing" htmlFor="taxInclusive">
                <Select
                  id="taxInclusive"
                  value={form.taxInclusive ? 'inclusive' : 'exclusive'}
                  onChange={(e) => setForm((c) => ({ ...c, taxInclusive: e.target.value === 'inclusive' }))}
                  disabled={disabled}
                >
                  <option value="inclusive">Tax included in price</option>
                  <option value="exclusive">Tax added to price</option>
                </Select>
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Invoices" />
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Number prefix" htmlFor="prefix" hint="e.g. INV-1001">
              <Input id="prefix" value={form.invoicePrefix} onChange={(e) => setForm((c) => ({ ...c, invoicePrefix: e.target.value }))} disabled={disabled} />
            </Field>
            <Field label="Default payment terms (days)" htmlFor="dueDays">
              <Input
                id="dueDays"
                type="number"
                min="0"
                className="tnum"
                value={form.invoiceDueDays}
                onChange={(e) => setForm((c) => ({ ...c, invoiceDueDays: Number(e.target.value) }))}
                disabled={disabled}
              />
            </Field>
          </div>
          <Field label="Default notes" htmlFor="notes">
            <Textarea id="notes" rows={2} value={form.invoiceNotes} onChange={(e) => setForm((c) => ({ ...c, invoiceNotes: e.target.value }))} disabled={disabled} />
          </Field>
          <Field label="Footer" htmlFor="footer" hint="Bank details, thank-you note, terms">
            <Textarea id="footer" rows={2} value={form.invoiceFooter} onChange={(e) => setForm((c) => ({ ...c, invoiceFooter: e.target.value }))} disabled={disabled} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Inventory" />
        <Field label="Low stock threshold" htmlFor="lowStock" hint="Warn when any product falls to this level or its own minimum, whichever is higher.">
          <Input
            id="lowStock"
            type="number"
            min="0"
            className="tnum max-w-32"
            value={form.lowStockThreshold}
            onChange={(e) => setForm((c) => ({ ...c, lowStockThreshold: Number(e.target.value) }))}
            disabled={disabled}
          />
        </Field>
      </Card>

      {!disabled && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Save settings
          </Button>
        </div>
      )}
    </div>
  );
}

function TeamTab() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');

  const { data, isLoading } = useQuery({
    queryKey: ['members'],
    queryFn: () =>
      api.get<Array<{ id: string; fullName: string; email: string; role: string; active: boolean; joinedAt: string }>>(
        '/business/members',
      ),
    enabled: can('members:read'),
  });

  const invite = useMutation({
    mutationFn: () => api.post('/business/members', { email, role }),
    onSuccess: () => {
      setEmail('');
      toast.success('Team member added', 'They will need to reset their password to sign in.');
      queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (error) => toast.error('Could not add', error instanceof ApiRequestError ? error.message : undefined),
  });

  if (!can('members:read')) {
    return (
      <Card className="max-w-2xl">
        <p className="text-[14px] muted">Your role cannot view the team list.</p>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <CardHeader title="Team" subtitle="Roles decide what each person — and their AI assistant — can do." />
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {(data ?? []).map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{member.fullName}</p>
                  <p className="text-[12.5px] subtle">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!member.active && <Badge tone="neutral">Inactive</Badge>}
                  <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>{titleCase(member.role)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can('members:manage') && (
        <Card>
          <CardHeader title="Add a team member" subtitle="You cannot grant a role equal to or above your own." />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Email" htmlFor="memberEmail" className="min-w-56 flex-1">
              <Input id="memberEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@business.com" />
            </Field>
            <Field label="Role" htmlFor="memberRole">
              <Select id="memberRole" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="viewer">Viewer — read only</option>
                <option value="staff">Staff — day-to-day work</option>
                <option value="manager">Manager — pricing and expenses</option>
                <option value="admin">Admin — settings and approvals</option>
              </Select>
            </Field>
            <Button variant="primary" onClick={() => invite.mutate()} loading={invite.isPending} disabled={!email.includes('@')}>
              Add member
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function AuditTab() {
  const { locale } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<AuditLogView[]>('/audit', { limit: 100 }),
  });

  return (
    <Card padded={false} className="max-w-4xl">
      <div className="border-b border-[var(--border)] px-4 py-3.5">
        <h3 className="text-[15px] font-semibold">Audit log</h3>
        <p className="mt-0.5 text-[13px] muted">
          Every change to your business, by a person or by NEXA AI. Read-only and append-only.
        </p>
      </div>
      {isLoading ? (
        <div className="p-4">
          <Skeleton className="h-64" />
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {(data ?? []).map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[13.5px]">{entry.summary}</p>
                <p className="mt-0.5 text-[11.5px] subtle">
                  {entry.action} · {dateTime(entry.createdAt, locale)}
                  {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                </p>
              </div>
              {entry.actorType === 'ai' && <Badge tone="brand">AI</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
