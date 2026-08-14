import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityEventView, AiActionView } from '@nexa/types';
import { ActivityIcon, SparkIcon } from '@/components/icons';
import { PageHeader, Tabs } from '@/components/ui/data';
import { EmptyState, ErrorState, Skeleton, useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, cx } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

const SEVERITY = {
  critical: { dot: 'bg-red-500', tone: 'danger' as const, glyph: '🔴' },
  warning: { dot: 'bg-amber-500', tone: 'warning' as const, glyph: '🟡' },
  success: { dot: 'bg-emerald-500', tone: 'success' as const, glyph: '🟢' },
  info: { dot: 'bg-sky-500', tone: 'info' as const, glyph: '🔵' },
};

export default function ActivityPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['activity', filter],
    queryFn: () =>
      api.get<{ data: ActivityEventView[]; total: number; unread: number }>('/activity', {
        pageSize: 60,
        unreadOnly: filter === 'unread' ? true : undefined,
      }),
  });

  const { data: pendingActions } = useQuery({
    queryKey: ['ai-actions'],
    queryFn: () => api.get<AiActionView[]>('/ai/actions'),
    enabled: can('ai:use'),
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/activity/read', { id: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api.post<AiActionView>(`/ai/actions/${id}/${decision}`, {}),
    onSuccess: (updated) => {
      if (updated.status === 'executed') toast.success('Done', updated.result ?? undefined);
      else if (updated.status === 'failed') toast.error("That didn't go through", updated.result ?? undefined);
      else toast.info('Rejected', 'Nothing was changed.');
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.error('Could not complete', error instanceof ApiRequestError ? error.message : undefined),
  });

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle={data ? `${data.total} events · ${data.unread} unread` : undefined}
        actions={
          (data?.unread ?? 0) > 0 && (
            <Button onClick={() => markRead.mutate()} loading={markRead.isPending}>
              Mark all read
            </Button>
          )
        }
      />

      {(pendingActions?.length ?? 0) > 0 && (
        <Card className="mb-5 border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/25">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-800 dark:text-amber-200">
            <SparkIcon className="size-4" />
            {pendingActions!.length} AI {pendingActions!.length === 1 ? 'action is' : 'actions are'} waiting for your approval
          </p>
          <ul className="mt-3 space-y-3">
            {pendingActions!.map((action) => (
              <li key={action.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold">{action.label}</p>
                    <p className="mt-0.5 text-[13px] muted">{action.description}</p>
                  </div>
                  <Badge tone={action.impact === 'high' ? 'danger' : action.impact === 'medium' ? 'warning' : 'neutral'}>
                    {action.impact}
                  </Badge>
                </div>
                {can('ai:approve_actions') ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => decide.mutate({ id: action.id, decision: 'approve' })}
                      loading={decide.isPending}
                    >
                      Approve
                    </Button>
                    <Button size="sm" onClick={() => decide.mutate({ id: action.id, decision: 'reject' })} disabled={decide.isPending}>
                      Reject
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-[12.5px] subtle">Your role cannot approve AI actions.</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padded={false}>
        <Tabs
          tabs={[
            { id: 'all', label: 'Everything' },
            { id: 'unread', label: 'Unread', count: data?.unread },
          ]}
          active={filter}
          onChange={setFilter}
          className="px-4"
        />

        <div className="p-4">
          {isError ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : isLoading ? (
            <Skeleton className="h-64" />
          ) : (data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={<ActivityIcon />}
              title={filter === 'unread' ? 'Nothing unread' : 'No activity yet'}
              message={
                filter === 'unread'
                  ? "You're caught up."
                  : 'As you record sales and NEXA watches your business, notable events land here.'
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data!.data.map((event) => {
                const severity = SEVERITY[event.severity];
                return (
                  <li key={event.id} className={cx('flex gap-3 py-3', !event.readAt && 'bg-brand-50/30 dark:bg-brand-950/20')}>
                    <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', severity.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14px] font-medium">{event.title}</p>
                        {event.source === 'ai' && (
                          <Badge tone="brand">
                            <SparkIcon className="size-3" /> NEXA
                          </Badge>
                        )}
                      </div>
                      {event.description && <p className="mt-0.5 text-[13px] muted">{event.description}</p>}
                      <p className="mt-1 text-[11.5px] subtle">{relativeTime(event.createdAt)}</p>
                    </div>
                    {event.actionHref && (
                      <Link
                        to={event.actionHref}
                        className="shrink-0 self-center text-[13px] font-medium text-brand-600 hover:underline"
                      >
                        {event.actionLabel ?? 'Open'} →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
