import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, Spinner, cx } from './primitives';

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: 'success' | 'error' | 'info';
  leaving?: boolean;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const EXIT_MS = 220;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    // Errors linger; confirmations get out of the way. Two-phase removal so
    // the exit animation can play instead of the toast vanishing.
    const life = toast.tone === 'error' ? 7000 : 4000;
    setTimeout(() => {
      setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), EXIT_MS);
    }, life);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ title, description, tone: 'success' }),
      error: (title, description) => push({ title, description, tone: 'error' }),
      info: (title, description) => push({ title, description, tone: 'info' }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          // Announced politely so a screen reader is not interrupted mid-task.
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:top-0 sm:bottom-auto sm:items-end"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cx(
                'pointer-events-auto w-full max-w-sm rounded-2xl border p-3.5 shadow-lifted backdrop-blur-xl',
                'transition-all duration-[220ms] ease-[var(--ease-out-soft)]',
                toast.leaving ? 'translate-y-1 scale-95 opacity-0' : 'animate-scale-in',
                toast.tone === 'success' &&
                  'border-emerald-300 bg-emerald-50/95 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/90 dark:text-emerald-100',
                toast.tone === 'error' &&
                  'border-red-300 bg-red-50/95 text-red-900 dark:border-red-500/40 dark:bg-red-950/90 dark:text-red-100',
                toast.tone === 'info' && 'border-[var(--border-strong)] bg-[var(--surface)]/95',
              )}
            >
              <div className="flex items-start gap-2.5">
                <ToastGlyph tone={toast.tone} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{toast.title}</p>
                  {toast.description && <p className="mt-0.5 text-[13px] opacity-80">{toast.description}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastGlyph({ tone }: { tone: Toast['tone'] }) {
  const path = {
    success: 'm5 10.5 3.2 3.2L15 7',
    error: 'M10 6.5v5M10 14h.01',
    info: 'M10 9v5M10 6.5h.01',
  }[tone];
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {tone !== 'success' && <circle cx="10" cy="10" r="8" strokeWidth="1.6" />}
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    // Mount first, then flip to visible so the enter transition actually runs.
    const frame = requestAnimationFrame(() => setVisible(true));

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      // Focus trap: Tab must not escape an open dialog.
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      // Return focus where the user left it.
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div
        className={cx(
          'absolute inset-0 bg-ink-950/50 backdrop-blur-[3px] transition-opacity duration-[var(--duration-base)] ease-[var(--ease-smooth)]',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'surface relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-[var(--radius-panel)] border border-[var(--border)] shadow-lifted outline-none sm:rounded-[var(--radius-panel)]',
          'transition-all duration-[var(--duration-base)] ease-[var(--ease-out-soft)]',
          visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-6 scale-[0.97] opacity-0',
          width,
        )}
      >
        <div className="surface sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" className="size-8 rounded-lg" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="surface sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm muted">{message}</div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading / empty / error states                                              */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-xl', className)} />;
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3" style={{ opacity: 1 - rowIndex * 0.12 }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className={cx('h-10 flex-1', columnIndex === 0 && 'max-w-[38%]')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="animate-fade-in flex items-center justify-center gap-2.5 py-12 text-sm muted">
      <Spinner className="size-4" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-fade-up flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-[var(--surface-muted)] text-xl text-[var(--text-subtle)]">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-[13.5px] muted">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Error state.
 *
 * Shows the message the API wrote for a human, plus a retry — never a bare
 * status code. Technical detail stays in the server log.
 */
export function ErrorState({
  title = "We couldn't load this",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="animate-fade-up border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-950/25">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300">
          <WarningIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-[13px] muted">{message ?? 'Something went wrong on our side.'}</p>
          {onRetry && (
            <Button size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path
        d="M10 7v4M10 14h.01M8.6 3.2 1.9 15a1.6 1.6 0 0 0 1.4 2.4h13.4a1.6 1.6 0 0 0 1.4-2.4L11.4 3.2a1.6 1.6 0 0 0-2.8 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
