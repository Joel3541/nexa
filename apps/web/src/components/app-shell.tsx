import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { NotificationView } from '@nexa/types';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useSession } from '@/store/session';
import { CommandPalette, useCommandPalette } from './command-palette';
import {
  ActivityIcon,
  BellIcon,
  BoxIcon,
  CalendarIcon,
  CartIcon,
  ChartIcon,
  CheckSquareIcon,
  HomeIcon,
  InvoiceIcon,
  LogoutIcon,
  MenuIcon,
  MoreIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  UsersIcon,
  WalletIcon,
  Wordmark,
} from './icons';
import { Avatar, Badge, Button, cx } from './ui/primitives';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: <HomeIcon />, end: true },
  { to: '/app/customers', label: 'Customers', icon: <UsersIcon /> },
  { to: '/app/sales', label: 'Sales', icon: <CartIcon /> },
  { to: '/app/products', label: 'Products', icon: <BoxIcon /> },
  { to: '/app/invoices', label: 'Invoices', icon: <InvoiceIcon /> },
  { to: '/app/expenses', label: 'Expenses', icon: <WalletIcon /> },
  { to: '/app/tasks', label: 'Tasks', icon: <CheckSquareIcon /> },
  { to: '/app/appointments', label: 'Appointments', icon: <CalendarIcon /> },
  { to: '/app/analytics', label: 'Analytics', icon: <ChartIcon /> },
  { to: '/app/activity', label: 'Activity', icon: <ActivityIcon /> },
];

/** Mobile keeps five destinations; everything else lives behind "More". */
const MOBILE_NAV: NavItem[] = [
  { to: '/app', label: 'Home', icon: <HomeIcon />, end: true },
  { to: '/app/customers', label: 'Customers', icon: <UsersIcon /> },
  { to: '/app/sales', label: 'Sales', icon: <CartIcon /> },
  { to: '/app/tasks', label: 'Tasks', icon: <CheckSquareIcon /> },
];

export function AppShell() {
  const { session, signOut } = useSession();
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setSidebarOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ rows: NotificationView[]; unread: number }>('/notifications'),
    refetchInterval: 120_000,
    enabled: Boolean(session?.business),
  });

  const business = session?.business;

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="surface fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-[var(--border)] lg:flex">
        <SidebarContent business={business} onSignOut={signOut} />
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/45" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="surface animate-fade-up relative flex h-full w-[17rem] flex-col border-r border-[var(--border)]">
            <SidebarContent business={business} onSignOut={signOut} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="surface sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--border)] px-3 sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon />
          </Button>

          <button
            onClick={() => setPaletteOpen(true)}
            // `min-w-0` lets the flex item shrink past its placeholder text
            // instead of pushing the header wider than a phone screen.
            className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-[var(--border-strong)] px-3 text-left text-sm subtle transition-colors hover:bg-[var(--surface-muted)] sm:max-w-md"
          >
            <SearchIcon className="size-4" />
            <span className="flex-1 truncate">Search customers, invoices, products…</span>
            <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] sm:block">⌘K</kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <NavLink
              to="/app/assistant"
              className={({ isActive }) =>
                cx(
                  'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200',
                )
              }
            >
              <SparkIcon className="size-4" />
              <span className="hidden sm:inline">Ask NEXA</span>
            </NavLink>

            <NotificationsBell
              unread={notifications?.unread ?? 0}
              rows={notifications?.rows ?? []}
              onOpenAll={() => navigate('/app/activity')}
            />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pt-5 pb-24 sm:px-6 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="surface fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--border)] pb-[env(safe-area-inset-bottom)] lg:hidden">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                isActive ? 'text-brand-600' : 'subtle',
              )
            }
          >
            <span className="text-[1.35rem]">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen((current) => !current)}
          className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', moreOpen ? 'text-brand-600' : 'subtle')}
        >
          <span className="text-[1.35rem]">
            <MoreIcon />
          </span>
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-[45] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-ink-950/40" />
          <div className="surface animate-fade-up absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-[var(--border)] p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-3 gap-1.5">
              {PRIMARY_NAV.filter((item) => !MOBILE_NAV.some((m) => m.to === item.to)).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-[12px] font-medium hover:bg-[var(--surface-muted)]"
                >
                  <span className="text-[1.35rem] subtle">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to="/app/settings"
                className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-[12px] font-medium hover:bg-[var(--surface-muted)]"
              >
                <span className="text-[1.35rem] subtle">
                  <SettingsIcon />
                </span>
                Settings
              </NavLink>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function SidebarContent({
  business,
  onSignOut,
}: {
  business: { name: string; logoUrl: string | null; isDemo: boolean } | null | undefined;
  onSignOut: () => void;
}) {
  const { session } = useSession();

  return (
    <>
      <div className="flex h-14 items-center border-b border-[var(--border)] px-4">
        <Wordmark />
      </div>

      {business && (
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-3">
          <Avatar name={business.name} src={business.logoUrl} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold">{business.name}</p>
            <p className="truncate text-[11.5px] subtle">{session?.role}</p>
          </div>
          {business.isDemo && <Badge tone="brand">Demo</Badge>}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-2.5">
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                  : 'muted hover:bg-[var(--surface-muted)] hover:text-[var(--text)]',
              )
            }
          >
            <span className="text-[1.1rem]">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--border)] p-2.5">
        <NavLink
          to="/app/settings"
          className={({ isActive }) =>
            cx(
              'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
              isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30' : 'muted hover:bg-[var(--surface-muted)]',
            )
          }
        >
          <span className="text-[1.1rem]">
            <SettingsIcon />
          </span>
          Settings
        </NavLink>
        <button
          onClick={onSignOut}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium muted transition-colors hover:bg-[var(--surface-muted)]"
        >
          <span className="text-[1.1rem]">
            <LogoutIcon />
          </span>
          Sign out
        </button>
      </div>
    </>
  );
}

function NotificationsBell({
  unread,
  rows,
  onOpenAll,
}: {
  unread: number;
  rows: NotificationView[];
  onOpenAll: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen((c) => !c)} aria-label={`Notifications (${unread} unread)`}>
        <span className="relative">
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-[15px] items-center justify-center rounded-full bg-red-500 text-[9.5px] font-bold text-white tnum">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="surface animate-fade-up absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-[var(--border)] shadow-xl">
            <div className="border-b border-[var(--border)] px-4 py-2.5 text-[13px] font-semibold">Notifications</div>
            <div className="max-h-80 overflow-y-auto">
              {rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] muted">You're all caught up.</p>
              ) : (
                rows.map((row) => (
                  <div key={row.id} className="border-b border-[var(--border)] px-4 py-2.5 last:border-0">
                    <p className="text-[13px] font-medium">{row.title}</p>
                    {row.body && <p className="mt-0.5 text-[12.5px] muted">{row.body}</p>}
                    <p className="mt-1 text-[11.5px] subtle">{relativeTime(row.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => {
                setOpen(false);
                onOpenAll();
              }}
              className="w-full border-t border-[var(--border)] px-4 py-2.5 text-[13px] font-medium text-brand-600 hover:bg-[var(--surface-muted)]"
            >
              Open activity feed
            </button>
          </div>
        </>
      )}
    </div>
  );
}
