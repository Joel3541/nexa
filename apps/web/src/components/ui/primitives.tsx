import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { avatarTint, initials } from '@/lib/format';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm shadow-brand-600/20 disabled:bg-brand-300',
  secondary:
    'surface border border-[var(--border-strong)] hover:bg-[var(--surface-muted)] active:bg-[var(--surface-muted)]',
  ghost: 'hover:bg-[var(--surface-muted)] text-[var(--text-muted)] hover:text-[var(--text)]',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
  subtle: 'bg-[var(--surface-muted)] hover:bg-[var(--border)] text-[var(--text)]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9.5 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
  icon: 'h-9 w-9 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // `aria-busy` rather than swapping the label keeps the accessible name
      // stable while a request is in flight.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center rounded-lg font-medium transition-colors select-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

const CONTROL =
  'w-full rounded-lg border border-[var(--border-strong)] surface px-3 py-2 text-sm transition-colors ' +
  'placeholder:text-[var(--text-subtle)] focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export interface FieldProps {
  label?: string;
  /** Accepts a node so a hint can contain a link (e.g. "Forgot password?"). */
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}

export function Field({ label, hint, error, required, children, className, htmlFor }: FieldProps) {
  return (
    <div className={cx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-[12.5px] text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(CONTROL, invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/15', className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cx(CONTROL, 'resize-y', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cx(CONTROL, 'cursor-pointer pr-8', className)} {...props}>
      {children}
    </select>
  );
});

/** Money input that speaks major units to the user and minor units to the API. */
export function MoneyInput({
  valueMinor,
  onChangeMinor,
  currencySymbol,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valueMinor: number;
  onChangeMinor: (minor: number) => void;
  currencySymbol: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm subtle">
        {currencySymbol}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className="pl-11 tnum"
        value={Number.isFinite(valueMinor) ? (valueMinor / 100).toString() : '0'}
        onChange={(event) => onChangeMinor(Math.round(Number.parseFloat(event.target.value || '0') * 100))}
        {...props}
      />
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-2.5 text-sm', className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-[var(--border-strong)] text-brand-600 focus:ring-brand-500/30"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--surface-muted)] text-[var(--text-muted)] border-[var(--border)]',
  brand: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-900/25 dark:text-brand-300 dark:border-brand-800',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
  info: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

/** Maps domain statuses to a consistent tone across every module. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'paid':
    case 'completed':
    case 'confirmed':
    case 'fulfilled':
    case 'active':
    case 'executed':
      return 'success';
    case 'partial':
    case 'pending':
    case 'in_progress':
    case 'scheduled':
    case 'sent':
    case 'proposed':
      return 'info';
    case 'overdue':
    case 'unpaid':
    case 'cancelled':
    case 'failed':
    case 'blocked':
    case 'no_show':
      return 'danger';
    case 'waiting':
    case 'draft':
    case 'lead':
    case 'rescheduled':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function Card({
  children,
  className,
  as: Tag = 'div',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
  padded?: boolean;
}) {
  return (
    <Tag
      className={cx(
        // `min-w-0` matters: a Card is almost always a grid or flex item, and
        // without it wide content (charts, tables) expands the track rather
        // than scrolling inside the card.
        'surface min-w-0 rounded-[var(--radius-card)] border border-[var(--border)] shadow-[0_1px_2px_rgb(16_24_40/0.04)]',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const tint = avatarTint(name);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, background: tint.bg, color: tint.fg, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx('border-t border-[var(--border)]', className)} />;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-md bg-ink-900 px-2 py-1 text-[11.5px] whitespace-nowrap text-white opacity-0 transition-opacity group-hover/tt:opacity-100 group-focus-within/tt:opacity-100 dark:bg-ink-700"
      >
        {label}
      </span>
    </span>
  );
}
