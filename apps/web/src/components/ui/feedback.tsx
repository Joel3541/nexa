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
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    // Errors linger; confirmations get out of the way.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), toast.tone === 'error' ? 7000 : 4000);
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
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:top-0 sm:items-end"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cx(
                'animate-fade-up pointer-events-auto w-full max-w-sm rounded-xl border p-3.5 shadow-lg backdrop-blur',
                toast.tone === 'success' && 'border-emerald-200 bg-emerald-50/95 dark:border-emerald-900 dark:bg-emerald-950/90',
                toast.tone === 'error' && 'border-red-200 bg-red-50/95 dark:border-red-900 dark:bg-red-950/90',
                toast.tone === 'info' && 'border-[var(--border)] bg-[var(--surface)]/95',
              )}
            >
              <p className="text-sm font-medium">{toast.title}</p>
              {toast.description && <p className="mt-0.5 text-[13px] muted">{toast.description}</p>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}

/* -------------------------------------------------------------------------- */
/* Modal / Drawer                                                              */
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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Prevent the page behind from scrolling while a dialog is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'animate-fade-up surface relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] shadow-2xl outline-none sm:rounded-2xl',
          width,
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
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
  return <div className={cx('skeleton rounded-md', className)} />;
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className={cx('h-9 flex-1', columnIndex === 0 && 'max-w-[38%]')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-12 text-sm muted">
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
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-3.5 flex size-11 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--text-subtle)]">
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
    <Card className="border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/25">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300">
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

/* -------------------------------------------------------------------------- */
/* Icons used by the states above                                              */
/* -------------------------------------------------------------------------- */

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
      <path d="M10 7v4M10 14h.01M8.6 3.2 1.9 15a1.6 1.6 0 0 0 1.4 2.4h13.4a1.6 1.6 0 0 0 1.4-2.4L11.4 3.2a1.6 1.6 0 0 0-2.8 0Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
