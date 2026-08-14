import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '@/components/icons';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/" className="inline-block">
            <Wordmark />
          </Link>
          <h1 className="mt-9 text-[26px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mt-2 text-[14.5px] muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-[13.5px] muted">{footer}</div>}
        </div>
      </div>

      {/* Decorative panel — hidden on small screens rather than shrunk. */}
      <aside className="relative hidden overflow-hidden border-l border-[var(--border)] bg-[var(--surface-muted)] lg:block">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_60%_20%,var(--color-brand-100),transparent)]"
        />
        <div className="relative flex h-full flex-col justify-center px-14">
          <p className="text-[13px] font-semibold tracking-wide text-brand-600 uppercase">NEXA Morning Brief</p>
          <p className="mt-4 text-[22px] leading-snug font-semibold tracking-[-0.01em]">
            “Revenue is down 27% this period, mostly because Glow Serum stocked out on the 12th. You're owed
            GH₵3,745 across 28 overdue invoices — that's the fastest cash you can collect today.”
          </p>
          <p className="mt-5 text-[14px] muted">
            That's a NEXA brief. Real numbers, from your own records, with the one thing worth doing first.
          </p>
        </div>
      </aside>
    </div>
  );
}
