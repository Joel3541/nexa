import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AiActionView, AiChatResponse, AiMessageView } from '@nexa/types';
import { SparkIcon } from '@/components/icons';
import { PageHeader } from '@/components/ui/data';
import { useToast } from '@/components/ui/feedback';
import { Badge, Button, Card, Spinner, cx } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { ApiRequestError, api } from '@/lib/api';
import { useSession } from '@/store/session';

interface AgentInfo {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  tools: Array<{ name: string; label: string; kind: 'read' | 'write'; requiresApproval: boolean; permission: string }>;
}

const SUGGESTIONS = [
  'How did my business perform this month?',
  'Why did revenue fall?',
  'Who owes me money?',
  'Which products are selling fastest?',
  "Which customers haven't bought in 60 days?",
  'What should I focus on today?',
  'Show me my biggest expenses',
  'Create a follow-up task for every overdue invoice',
];

export default function AssistantPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('chief_of_staff');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<AiMessageView[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: agentInfo } = useQuery({
    queryKey: ['ai-agents'],
    queryFn: () => api.get<{ provider: string; model: string; generative: boolean; agents: AgentInfo[] }>('/ai/agents'),
    staleTime: Infinity,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: (message: string) =>
      api.post<AiChatResponse>('/ai/chat', { message, conversationId, agentId }),
    onSuccess: (response) => {
      setConversationId(response.conversationId);
      setMessages((current) => [...current, response.message]);
      queryClient.invalidateQueries({ queryKey: ['ai-actions'] });
    },
    onError: (error) => {
      toast.error(
        'NEXA could not answer that',
        error instanceof ApiRequestError ? error.message : 'Please try again.',
      );
      // Drop the optimistic user bubble so the transcript stays truthful.
      setMessages((current) => current.filter((message) => !message.id.startsWith('pending-')));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || send.isPending) return;
    setDraft('');
    setMessages((current) => [
      ...current,
      {
        id: `pending-${crypto.randomUUID()}`,
        role: 'user',
        content: message,
        agentId: null,
        toolCalls: [],
        pendingActions: [],
        citations: [],
        createdAt: new Date().toISOString(),
      },
    ]);
    send.mutate(message);
  }

  if (!can('ai:use')) {
    return (
      <Card>
        <p className="text-[15px] font-semibold">NEXA AI isn't available on your role</p>
        <p className="mt-1.5 text-[14px] muted">Ask an owner or admin to grant you AI access.</p>
      </Card>
    );
  }

  const activeAgent = agentInfo?.agents.find((agent) => agent.id === agentId);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="NEXA AI"
        subtitle={
          agentInfo
            ? agentInfo.generative
              ? `Connected to ${agentInfo.model}. Answers are grounded in your business data.`
              : 'Running the development adapter: answers are composed deterministically from your real data.'
            : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {agentInfo?.agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setAgentId(agent.id)}
            className={cx(
              'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
              agent.id === agentId
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                : 'border-[var(--border-strong)] muted hover:bg-[var(--surface-muted)]',
            )}
          >
            {agent.name}
          </button>
        ))}
      </div>

      {activeAgent && (
        <p className="mb-4 text-[13px] muted">
          {activeAgent.tagline}{' '}
          <span className="subtle">
            {activeAgent.tools.length} tools available to you · {activeAgent.tools.filter((t) => t.requiresApproval).length}{' '}
            require your approval
          </span>
        </p>
      )}

      {messages.length === 0 && (
        <Card className="mb-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/40">
              <SparkIcon />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">Ask me anything about your business.</p>
              <p className="mt-1 text-[13.5px] muted">
                I read your actual records — customers, sales, stock, invoices, expenses. I'll never make a number up,
                and anything that changes your data waits for your approval.
              </p>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setDraft('');
                      setMessages([
                        {
                          id: `pending-${crypto.randomUUID()}`,
                          role: 'user',
                          content: suggestion,
                          agentId: null,
                          toolCalls: [],
                          pendingActions: [],
                          citations: [],
                          createdAt: new Date().toISOString(),
                        },
                      ]);
                      send.mutate(suggestion);
                    }}
                    className="rounded-lg border border-[var(--border-strong)] px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--surface-muted)]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-[14.5px] text-white">
                {message.content}
              </div>
            </div>
          ) : (
            <AssistantMessage key={message.id} message={message} />
          ),
        )}
        {send.isPending && (
          <div className="flex items-center gap-2.5 text-[13.5px] muted">
            <Spinner className="size-4" />
            NEXA is reading your records…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-20 mt-5 lg:bottom-4">
        <div className="surface flex items-end gap-2 rounded-2xl border border-[var(--border-strong)] p-2 shadow-lg">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) submit(event);
            }}
            rows={1}
            placeholder="Ask about revenue, customers, stock, invoices…"
            aria-label="Message NEXA AI"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-[14.5px] outline-none placeholder:text-[var(--text-subtle)]"
          />
          <Button type="submit" variant="primary" disabled={!draft.trim()} loading={send.isPending}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function AssistantMessage({ message }: { message: AiMessageView }) {
  const [showTools, setShowTools] = useState(false);

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/40">
          <SparkIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap">{message.content}</p>

          {message.citations.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {message.citations.map((citation) => (
                <Link
                  key={citation.href}
                  to={citation.href}
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-[12px] muted hover:bg-[var(--surface-muted)]"
                >
                  {citation.label} →
                </Link>
              ))}
            </div>
          )}

          {message.pendingActions.map((action) => (
            <ApprovalCard key={action.id} action={action} />
          ))}

          {message.toolCalls.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowTools((current) => !current)}
                className="text-[12px] subtle hover:text-[var(--text)]"
              >
                {showTools ? 'Hide' : 'Show'} what NEXA looked at ({message.toolCalls.length})
              </button>
              {showTools && (
                <ul className="mt-2 space-y-1.5 border-l-2 border-[var(--border)] pl-3">
                  {message.toolCalls.map((call) => (
                    <li key={call.id} className="text-[12px] muted">
                      <span className={cx('font-medium', call.status === 'error' && 'text-red-600')}>{call.label}</span>
                      {' — '}
                      {call.summary}
                      <span className="subtle"> ({call.durationMs}ms)</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Approval card.
 *
 * Nothing has happened yet when this renders. It shows exactly what NEXA
 * intends to do, with a preview of the affected records, and requires an
 * explicit decision.
 */
function ApprovalCard({ action }: { action: AiActionView }) {
  const [status, setStatus] = useState(action.status);
  const [result, setResult] = useState(action.result);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useSession();

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post<AiActionView>(`/ai/actions/${action.id}/${decision}`, {}),
    onSuccess: (updated) => {
      setStatus(updated.status);
      setResult(updated.result);
      if (updated.status === 'executed') {
        toast.success('Done', updated.result ?? undefined);
        // Any module could have changed — refresh what the user might look at.
        queryClient.invalidateQueries();
      } else if (updated.status === 'failed') {
        toast.error("That didn't go through", updated.result ?? undefined);
      } else {
        toast.info('Rejected', 'Nothing was changed.');
      }
    },
    onError: (error) => {
      toast.error('Could not complete that', error instanceof ApiRequestError ? error.message : undefined);
    },
  });

  const decided = status !== 'proposed';

  return (
    <div
      className={cx(
        'mt-3.5 rounded-xl border p-4',
        status === 'executed'
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/25'
          : status === 'rejected' || status === 'failed'
            ? 'border-[var(--border)] bg-[var(--surface-muted)]'
            : 'border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/25',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[14.5px] font-semibold">{action.label}</p>
            <Badge tone={action.impact === 'high' ? 'danger' : action.impact === 'medium' ? 'warning' : 'neutral'}>
              {action.impact} impact
            </Badge>
          </div>
          <p className="mt-1 text-[13.5px] muted">{action.description}</p>
        </div>
        {decided && (
          <Badge tone={status === 'executed' ? 'success' : status === 'failed' ? 'danger' : 'neutral'}>{status}</Badge>
        )}
      </div>

      {action.preview.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-[12.5px]">
            <tbody>
              {action.preview.map((row, index) => (
                <tr key={`${row.label}-${index}`} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-1.5 font-medium">{row.label}</td>
                  <td className="px-3 py-1.5 text-right muted tnum">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {decided ? (
        result && <p className="mt-3 text-[13px] muted">{result}</p>
      ) : can('ai:approve_actions') ? (
        <div className="mt-3.5 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => decide.mutate('approve')} loading={decide.isPending}>
            Approve and run
          </Button>
          <Button size="sm" onClick={() => decide.mutate('reject')} disabled={decide.isPending}>
            Reject
          </Button>
          <span className="text-[12px] subtle">Nothing has happened yet.</span>
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] subtle">
          Your role can't approve AI actions. Ask an owner or admin to review this.
        </p>
      )}
    </div>
  );
}

export { relativeTime };
