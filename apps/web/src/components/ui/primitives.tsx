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

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'invert';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // Disabled uses a neutral surface rather than a pale brand fill: white text
  // on brand-300 is both unreadable and ambiguous about being disabled.
  primary:
    'bg-brand-600 text-white shadow-[var(--shadow-brand)] hover:bg-brand-700 hover:shadow-[0_10px_26px_-6px_rgb(91_69_230/0.45)] active:bg-brand-800 ' +
    'disabled:bg-[var(--surface-sunken)] disabled:text-[var(--text-subtle)] disabled:shadow-none',
  secondary:
    'surface border border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:border-[var(--text-subtle)]',
  ghost: 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 ' +
    'disabled:bg-[var(--surface-sunken)] disabled:text-[var(--text-subtle)]',
  subtle: 'bg-[var(--surface-muted)] text-[var(--text)] hover:bg-[var(--border)]',
  invert: 'bg-white text-brand-700 hover:bg-brand-50 shadow-raised',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5.5 text-[15px] gap-2 rounded-xl',
  icon: 'h-10 w-10 justify-center rounded-xl',
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
        'press inline-flex items-center font-medium select-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {/* The spinner takes the icon's place so the label never shifts. */}
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
  'w-full rounded-xl border border-[var(--border-strong)] surface px-3.5 py-2.5 text-sm ' +
  'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-smooth)] ' +
  'placeholder:text-[var(--text-subtle)] hover:border-[var(--text-subtle)] ' +
  'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

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
          {required && <span className="text-negative"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="animate-fade-in text-[12.5px] text-red-600 dark:text-red-400">
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
    <select ref={ref} className={cx(CONTROL, 'cursor-pointer pr-9', className)} {...props}>
      {children}
    </select>
  );
});

/** Money input that speaks major units to the user and minor units to the API. */
export function MoneyInput({
  valueMinor,
  onChangeMinor,
  currencySymbol,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valueMinor: number;
  onChangeMinor: (minor: number) => void;
  currencySymbol: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm subtle">
        {currencySymbol}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className={cx('pl-11 tnum', className)}
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
    <label className={cx('group flex cursor-pointer items-start gap-2.5 text-sm', className)}>
      <input
        type="checkbox"
        // `accent-color` is what actually tints a native checkbox; a text
        // colour would do nothing here without a forms plugin.
        style={{ accentColor: 'var(--color-brand-600)' }}
        className="mt-0.5 size-4 rounded-md border-[var(--border-strong)] transition-transform duration-[var(--duration-fast)] group-active:scale-90 focus:ring-brand-500/30"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

/** Sliding on/off switch, used for boolean settings. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-[var(--duration-base)] ease-[var(--ease-smooth)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-[var(--border-strong)]',
      )}
    >
      <span
        className={cx(
          'inline-block size-[18px] rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-base)] ease-[var(--ease-spring)]',
          checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--surface-muted)] text-[var(--text-muted)] border-[var(--border)]',
  brand: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:border-brand-500/30',
  success:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
  info: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap',
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
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
  padded?: boolean;
  /** Adds hover elevation. Use only when the whole card is clickable. */
  interactive?: boolean;
}) {
  return (
    <Tag
      className={cx(
        // `min-w-0` matters: a Card is almost always a grid or flex item, and
        // without it wide content (charts, tables) expands the track rather
        // than scrolling inside the card.
        'surface min-w-0 rounded-[var(--radius-card)] border border-[var(--border)] shadow-card',
        interactive && 'lift cursor-pointer',
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
        <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
        {subtitle && <div className="mt-0.5 text-[13px] muted">{subtitle}</div>}
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
        className="rounded-full object-cover ring-2 ring-[var(--surface)]"
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

/** Soft tinted square behind an icon — the reference's accent treatment. */
export function IconTile({
  children,
  tone = 'brand',
  size = 40,
  className,
}: {
  children: ReactNode;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size?: number;
  className?: string;
}) {
  const tones = {
    brand: 'bg-brand-50 text-accent dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    danger: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
    info: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    neutral: 'bg-[var(--surface-muted)] text-[var(--text-muted)]',
  }[tone];

  return (
    <span
      className={cx('inline-grid shrink-0 place-items-center rounded-xl', tones, className)}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden="true"
    >
      {children}
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
        className="panel-invert pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 translate-y-1 rounded-lg px-2 py-1 text-[11.5px] whitespace-nowrap opacity-0 transition-all duration-[var(--duration-fast)] ease-[var(--ease-smooth)] group-hover/tt:translate-y-0 group-hover/tt:opacity-100 group-focus-within/tt:translate-y-0 group-focus-within/tt:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
