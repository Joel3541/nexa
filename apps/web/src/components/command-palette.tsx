import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { SearchResultGroup } from '@nexa/types';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';
import {
  BoxIcon,
  CalendarIcon,
  CartIcon,
  ChartIcon,
  CheckSquareIcon,
  InvoiceIcon,
  PlusIcon,
  SearchIcon,
  SparkIcon,
  UsersIcon,
  WalletIcon,
} from './icons';
import { Spinner, cx } from './ui/primitives';

/**
 * Command palette (Ctrl/Cmd + K).
 *
 * Two things in one surface: static commands for navigation and creation, and
 * live search across the business graph. Typing filters commands instantly and
 * queries the server in parallel, so the palette is useful before the network
 * responds — this is meant to be the fastest way to operate the product.
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  href: string;
  keywords: string;
  group: 'Create' | 'Go to';
}

const COMMANDS: Command[] = [
  { id: 'new-sale', label: 'Record a sale', icon: <CartIcon />, href: '/app/sales/new', keywords: 'sale order sell pos checkout new', group: 'Create' },
  { id: 'new-customer', label: 'Add a customer', icon: <UsersIcon />, href: '/app/customers/new', keywords: 'customer client contact add new', group: 'Create' },
  { id: 'new-invoice', label: 'Create an invoice', icon: <InvoiceIcon />, href: '/app/invoices/new', keywords: 'invoice bill charge new', group: 'Create' },
  { id: 'new-product', label: 'Add a product or service', icon: <BoxIcon />, href: '/app/products/new', keywords: 'product service item stock add new', group: 'Create' },
  { id: 'new-expense', label: 'Record an expense', icon: <WalletIcon />, href: '/app/expenses?new=1', keywords: 'expense cost spend payment new', group: 'Create' },
  { id: 'new-task', label: 'Create a task', icon: <CheckSquareIcon />, href: '/app/tasks?new=1', keywords: 'task todo reminder new', group: 'Create' },
  { id: 'go-dashboard', label: 'Dashboard', icon: <ChartIcon />, href: '/app', keywords: 'home dashboard overview brief', group: 'Go to' },
  { id: 'go-customers', label: 'Customers', icon: <UsersIcon />, href: '/app/customers', keywords: 'customers crm clients', group: 'Go to' },
  { id: 'go-overdue', label: 'Overdue invoices', hint: 'Money owed to you', icon: <InvoiceIcon />, href: '/app/invoices?overdue=1', keywords: 'overdue unpaid owing debt chase', group: 'Go to' },
  { id: 'go-inactive', label: 'Inactive customers', hint: "Haven't bought in 60+ days", icon: <UsersIcon />, href: '/app/customers?segment=inactive', keywords: 'inactive lapsed quiet reactivate', group: 'Go to' },
  { id: 'go-lowstock', label: 'Low stock', icon: <BoxIcon />, href: '/app/products?lowStock=1', keywords: 'stock inventory reorder low running out', group: 'Go to' },
  { id: 'go-analytics', label: 'Analytics', icon: <ChartIcon />, href: '/app/analytics', keywords: 'analytics reports charts revenue', group: 'Go to' },
  { id: 'go-assistant', label: 'Ask NEXA AI', icon: <SparkIcon />, href: '/app/assistant', keywords: 'ai assistant ask chat nexa', group: 'Go to' },
  { id: 'go-appointments', label: 'Appointments', icon: <CalendarIcon />, href: '/app/appointments', keywords: 'appointments bookings calendar', group: 'Go to' },
  { id: 'go-settings', label: 'Settings', icon: <PlusIcon />, href: '/app/settings', keywords: 'settings business profile tax', group: 'Go to' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { isAuthenticated } = useSession();

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus after paint so the caret lands reliably on mobile Safari too.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const trimmed = query.trim();

  const { data: searchGroups, isFetching } = useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => api.get<SearchResultGroup[]>('/search', { q: trimmed }),
    enabled: open && isAuthenticated && trimmed.length >= 2,
    staleTime: 15_000,
  });

  const filteredCommands = useMemo(() => {
    if (!trimmed) return COMMANDS;
    const needle = trimmed.toLowerCase();
    return COMMANDS.filter(
      (command) => command.label.toLowerCase().includes(needle) || command.keywords.includes(needle),
    );
  }, [trimmed]);

  const items = useMemo(() => {
    const list: Array<{ id: string; label: string; hint?: string | null; icon?: ReactNode; href: string; group: string }> =
      filteredCommands.map((command) => ({ ...command, hint: command.hint }));
    for (const group of searchGroups ?? []) {
      for (const result of group.results) {
        list.push({ id: `${group.type}-${result.id}`, label: result.title, hint: result.meta ?? result.subtitle, href: result.href, group: group.label });
      }
    }
    return list;
  }, [filteredCommands, searchGroups]);

  useEffect(() => {
    setCursor(0);
  }, [items.length]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    navigate(href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((current) => Math.min(current + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = items[cursor];
      if (target) go(target.href);
    } else if (event.key === 'Escape') {
      onClose();
    }
  };

  let lastGroup = '';

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[10vh]">
      <div className="absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-fade-up surface relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4">
          <SearchIcon className="size-4 shrink-0 subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search or type a command…"
            aria-label="Search or type a command"
            className="flex-1 bg-transparent py-3.5 text-[15px] outline-none placeholder:text-[var(--text-subtle)]"
          />
          {isFetching && <Spinner className="size-4 subtle" />}
          <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] subtle sm:block">Esc</kbd>
        </div>

        <div role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm muted">
              Nothing matches “{trimmed}”. Try a customer name, invoice number or product.
            </p>
          )}
          {items.map((item, index) => {
            const showHeader = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showHeader && (
                  <p className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide uppercase subtle">
                    {item.group}
                  </p>
                )}
                <button
                  role="option"
                  aria-selected={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(item.href)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    index === cursor ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-100' : 'hover:bg-[var(--surface-muted)]',
                  )}
                >
                  <span className="shrink-0 subtle">{item.icon ?? <SearchIcon />}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-[12px] subtle tnum">{item.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Registers the global Ctrl/Cmd+K shortcut. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}
