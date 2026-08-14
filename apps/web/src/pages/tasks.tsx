import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CustomerView, Paginated, TaskView } from '@nexa/types';
import { CheckSquareIcon, PlusIcon, SparkIcon } from '@/components/icons';
import { PageHeader, Tabs } from '@/components/ui/data';
import { EmptyState, ErrorState, Modal, Skeleton, useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, Field, Input, Select, Textarea, cx } from '@/components/ui/primitives';
import { relativeTime, titleCase } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

const STATUSES = ['todo', 'in_progress', 'waiting', 'completed'] as const;

export default function TasksPage() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<string>('todo');
  const [open, setOpen] = useState(params.get('new') === '1');
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '', customerId: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tasks', status],
    queryFn: () => api.get<Paginated<TaskView>>('/tasks', { pageSize: 100, status: status || undefined }),
  });

  const { data: customers } = useQuery({
    queryKey: ['task-customers'],
    queryFn: () => api.get<Paginated<CustomerView>>('/customers', { pageSize: 200, sort: 'name' }),
  });

  function closeModal() {
    setOpen(false);
    const query = new URLSearchParams(params);
    query.delete('new');
    setParams(query);
  }

  const create = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        customerId: form.customerId || undefined,
        status: 'todo',
        recurrence: 'none',
      }),
    onSuccess: () => {
      closeModal();
      setForm({ title: '', description: '', priority: 'medium', dueDate: '', customerId: '' });
      toast.success('Task created');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => toast.error('Could not create task', error instanceof ApiRequestError ? error.message : undefined),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch(`/tasks/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error('Could not update task', error instanceof ApiRequestError ? error.message : undefined),
  });

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={data ? `${data.total} ${status ? titleCase(status).toLowerCase() : ''}` : undefined}
        actions={
          can('tasks:write') && (
            <Button variant="primary" icon={<PlusIcon className="size-4" />} onClick={() => setOpen(true)}>
              New task
            </Button>
          )
        }
      />

      <Card padded={false}>
        <Tabs
          tabs={[
            { id: '', label: 'All' },
            ...STATUSES.map((s) => ({ id: s as string, label: titleCase(s) })),
          ]}
          active={status}
          onChange={setStatus}
          className="px-4"
        />

        <div className="p-4">
          {isError ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : isLoading ? (
            <Skeleton className="h-64" />
          ) : (data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={<CheckSquareIcon />}
              title="Nothing here"
              message={status === 'todo' ? 'No open tasks. Enjoy the quiet.' : 'No tasks with that status.'}
              action={
                can('tasks:write') ? (
                  <Button variant="primary" onClick={() => setOpen(true)}>
                    New task
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data!.data.map((task) => (
                <li key={task.id} className="flex items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    checked={task.status === 'completed'}
                    disabled={!can('tasks:write')}
                    onChange={(event) =>
                      update.mutate({ id: task.id, patch: { status: event.target.checked ? 'completed' : 'todo' } })
                    }
                    style={{ accentColor: 'var(--color-brand-600)' }}
                    className="mt-1 size-4 shrink-0 cursor-pointer rounded border-[var(--border-strong)] transition-transform duration-[var(--duration-fast)] active:scale-90"
                    aria-label={`Mark "${task.title}" complete`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-[14.5px] font-medium', task.status === 'completed' && 'line-through subtle')}>
                      {task.title}
                    </p>
                    {task.description && <p className="mt-0.5 text-[13px] muted">{task.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] subtle">
                      {task.customerName && (
                        <Link to={`/app/customers/${task.customerId}`} className="hover:text-accent">
                          {task.customerName}
                        </Link>
                      )}
                      {task.dueDate && (
                        <span className={task.isOverdue ? 'font-medium text-negative' : ''}>
                          Due {relativeTime(task.dueDate)}
                        </span>
                      )}
                      {task.createdBySource === 'ai' && (
                        <span className="inline-flex items-center gap-1 text-accent">
                          <SparkIcon className="size-3" /> Created by NEXA AI
                        </span>
                      )}
                      {task.recurrence !== 'none' && <span>Repeats {task.recurrence}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      tone={
                        task.isOverdue
                          ? 'danger'
                          : task.priority === 'urgent'
                            ? 'danger'
                            : task.priority === 'high'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {task.isOverdue ? 'Overdue' : titleCase(task.priority)}
                    </Badge>
                    {can('tasks:write') && task.status !== 'completed' && (
                      <Select
                        value={task.status}
                        onChange={(event) => update.mutate({ id: task.id, patch: { status: event.target.value } })}
                        className="hidden w-auto text-[12.5px] sm:block"
                        aria-label="Change status"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {titleCase(s)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Modal
        open={open}
        onClose={closeModal}
        title="New task"
        footer={
          <>
            <Button onClick={closeModal}>Cancel</Button>
            <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!form.title.trim()}>
              Create task
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="What needs doing?" htmlFor="title" required>
            <Input
              id="title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Call Akosua about her order"
              autoFocus
            />
          </Field>
          <Field label="Details" htmlFor="description">
            <Textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority" htmlFor="priority">
              <Select
                id="priority"
                value={form.priority}
                onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Due date" htmlFor="dueDate">
              <Input
                id="dueDate"
                type="date"
                value={form.dueDate}
                onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="Related customer" htmlFor="customer">
            <Select
              id="customer"
              value={form.customerId}
              onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))}
            >
              <option value="">None</option>
              {(customers?.data ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
