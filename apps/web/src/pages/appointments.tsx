import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { AppointmentView, CustomerView, Paginated, ProductView } from '@nexa/types';
import { CalendarIcon, PlusIcon } from '@/components/icons';
import { PageHeader, Tabs } from '@/components/ui/data';
import { EmptyState, ErrorState, Modal, Skeleton, useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, Field, Input, Select, Textarea, statusTone } from '@/components/ui/primitives';
import { timeOnly, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

export default function AppointmentsPage() {
  const { locale, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    customerId: '',
    productId: '',
    date: new Date().toISOString().slice(0, 10),
    time: '10:00',
    durationMinutes: 60,
    notes: '',
  });

  const now = new Date();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['appointments', view],
    queryFn: () =>
      api.get<Paginated<AppointmentView>>('/appointments', {
        pageSize: 100,
        ...(view === 'upcoming'
          ? { from: now.toISOString() }
          : { to: now.toISOString() }),
      }),
  });

  const { data: customers } = useQuery({
    queryKey: ['appointment-customers'],
    queryFn: () => api.get<Paginated<CustomerView>>('/customers', { pageSize: 200, sort: 'name' }),
  });

  const { data: services } = useQuery({
    queryKey: ['appointment-services'],
    queryFn: () => api.get<Paginated<ProductView>>('/products', { pageSize: 100, kind: 'service' }),
  });

  /** Grouped by day so the list reads like a diary rather than a table. */
  const grouped = useMemo(() => {
    const groups = new Map<string, AppointmentView[]>();
    const rows = [...(data?.data ?? [])].sort((a, b) =>
      view === 'upcoming' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt),
    );
    for (const appointment of rows) {
      const day = appointment.startsAt.slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), appointment]);
    }
    return [...groups.entries()];
  }, [data, view]);

  const create = useMutation({
    mutationFn: () =>
      api.post('/appointments', {
        title: form.title || services?.data.find((s) => s.id === form.productId)?.name || 'Appointment',
        customerId: form.customerId || undefined,
        productId: form.productId || undefined,
        startsAt: new Date(`${form.date}T${form.time}:00`).toISOString(),
        durationMinutes: form.durationMinutes,
        notes: form.notes || undefined,
        status: 'scheduled',
      }),
    onSuccess: () => {
      setOpen(false);
      setForm((current) => ({ ...current, title: '', customerId: '', notes: '' }));
      toast.success('Appointment booked');
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error('Could not book', error instanceof ApiRequestError ? error.message : undefined),
  });

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/appointments/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] }),
    onError: (error) => toast.error('Could not update', error instanceof ApiRequestError ? error.message : undefined),
  });

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle={data ? `${data.total} ${view}` : undefined}
        actions={
          can('appointments:write') && (
            <Button variant="primary" icon={<PlusIcon className="size-4" />} onClick={() => setOpen(true)}>
              Book appointment
            </Button>
          )
        }
      />

      <Card padded={false}>
        <Tabs
          tabs={[
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'past', label: 'Past' },
          ]}
          active={view}
          onChange={setView}
          className="px-4"
        />

        <div className="p-4">
          {isError ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : isLoading ? (
            <Skeleton className="h-64" />
          ) : grouped.length === 0 ? (
            <EmptyState
              icon={<CalendarIcon />}
              title={view === 'upcoming' ? 'Nothing booked' : 'No past appointments'}
              message={
                view === 'upcoming'
                  ? 'Book an appointment and it will show up here and on your dashboard.'
                  : 'Completed and cancelled appointments will appear here.'
              }
              action={
                can('appointments:write') && view === 'upcoming' ? (
                  <Button variant="primary" onClick={() => setOpen(true)}>
                    Book appointment
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-6">
              {grouped.map(([day, appointments]) => (
                <div key={day}>
                  <h3 className="mb-2 text-[13px] font-semibold tracking-wide uppercase subtle">
                    {new Date(`${day}T12:00:00`).toLocaleDateString(locale, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </h3>
                  <ul className="divide-y divide-[var(--border)]">
                    {appointments.map((appointment) => (
                      <li key={appointment.id} className="flex items-center gap-3 py-2.5">
                        <div className="w-16 shrink-0 text-[13px] font-medium tnum">
                          {timeOnly(appointment.startsAt, locale)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium">{appointment.title}</p>
                          <p className="text-[12.5px] subtle">
                            {appointment.customerName ?? 'No customer'} · {appointment.durationMinutes} min
                            {appointment.location ? ` · ${appointment.location}` : ''}
                          </p>
                        </div>
                        <Badge tone={statusTone(appointment.status)}>{titleCase(appointment.status)}</Badge>
                        {can('appointments:write') && appointment.status !== 'completed' && (
                          <Select
                            value={appointment.status}
                            onChange={(event) => update.mutate({ id: appointment.id, status: event.target.value })}
                            className="hidden w-auto text-[12.5px] sm:block"
                            aria-label="Change status"
                          >
                            <option value="scheduled">Scheduled</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="no_show">No show</option>
                          </Select>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Book an appointment"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending}>
              Book it
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Service" htmlFor="service">
            <Select
              id="service"
              value={form.productId}
              onChange={(event) => {
                const service = services?.data.find((s) => s.id === event.target.value);
                setForm((current) => ({
                  ...current,
                  productId: event.target.value,
                  title: service?.name ?? current.title,
                  durationMinutes: service?.durationMinutes ?? current.durationMinutes,
                }));
              }}
            >
              <option value="">Custom appointment</option>
              {(services?.data ?? []).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor="title" required>
            <Input
              id="title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Signature Facial"
            />
          </Field>
          <Field label="Customer" htmlFor="customer">
            <Select
              id="customer"
              value={form.customerId}
              onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))}
            >
              <option value="">No customer</option>
              {(customers?.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" htmlFor="date">
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
              />
            </Field>
            <Field label="Time" htmlFor="time">
              <Input
                id="time"
                type="time"
                value={form.time}
                onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
              />
            </Field>
            <Field label="Duration" htmlFor="duration">
              <Select
                id="duration"
                value={form.durationMinutes}
                onChange={(event) => setForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))}
              >
                {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor="notes">
            <Textarea
              id="notes"
              rows={2}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
