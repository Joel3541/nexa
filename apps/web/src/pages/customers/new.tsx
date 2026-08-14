import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CustomerView } from '@nexa/types';
import { PageHeader } from '@/components/ui/data';
import { useToast } from '@/components/ui/feedback';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { ApiRequestError, api } from '@/lib/api';

export default function NewCustomerPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    addressLine1: '',
    city: '',
    status: 'active',
    source: '',
    notes: '',
    tags: '',
  });

  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const create = useMutation({
    mutationFn: () =>
      api.post<CustomerView>('/customers', {
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        company: form.company || undefined,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        status: form.status,
        source: form.source || undefined,
        notes: form.notes || undefined,
        tags: form.tags ? form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : undefined,
      }),
    onSuccess: (customer) => {
      toast.success('Customer added', customer.name);
      navigate(`/app/customers/${customer.id}`, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        setFields(error.fields ?? {});
        toast.error('Could not add customer', error.message);
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setFields({});
    create.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Add a customer" subtitle="Only a name is required — you can fill in the rest later." />
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Name" htmlFor="name" required error={fields.name}>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus invalid={Boolean(fields.name)} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="phone" error={fields.phone}>
              <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+233 24 000 0000" />
            </Field>
            <Field label="Email" htmlFor="email" error={fields.email}>
              <Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} invalid={Boolean(fields.email)} />
            </Field>
            <Field label="Company" htmlFor="company">
              <Input id="company" value={form.company} onChange={(e) => set('company', e.target.value)} />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="lead">Lead</option>
                <option value="inactive">Inactive</option>
                <option value="blocked">Blocked</option>
              </Select>
            </Field>
            <Field label="Address" htmlFor="address">
              <Input id="address" value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <Field label="How did they find you?" htmlFor="source">
              <Input id="source" value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="Instagram, referral…" />
            </Field>
            <Field label="Tags" htmlFor="tags" hint="Comma separated">
              <Input id="tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="vip, wholesale" />
            </Field>
          </div>

          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={form.name.trim().length < 1}>
              Add customer
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
