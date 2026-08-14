import { useState } from 'react';
import { useTheme, type ThemePreference } from '@/store/theme';
import { cx } from './ui/primitives';

/**
 * Theme toggle.
 *
 * A single click flips light/dark — the common case, one tap. Holding the
 * dropdown open exposes "System" for people who want to follow their OS.
 * The sun/moon crossfade and rotate rather than swapping, so the control feels
 * like one object changing state instead of two icons trading places.
 */
export function ThemeToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const { resolved, preference, setPreference, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDark = resolved === 'dark';

  if (compact) {
    return (
      <button
        onClick={toggle}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        className={cx(
          'press relative inline-flex size-9 items-center justify-center rounded-xl text-[var(--text-muted)]',
          'hover:bg-[var(--surface-muted)] hover:text-[var(--text)]',
          className,
        )}
      >
        <ThemeGlyph isDark={isDark} />
      </button>
    );
  }

  const options: Array<{ id: ThemePreference; label: string }> = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div className={cx('relative', className)}>
      <button
        onClick={toggle}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen((open) => !open);
        }}
        aria-label={`Theme: ${preference}. Switch to ${isDark ? 'light' : 'dark'} mode.`}
        className="press surface inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border-strong)] px-2.5 text-[13px] font-medium hover:bg-[var(--surface-muted)]"
      >
        <ThemeGlyph isDark={isDark} />
        <span className="hidden sm:inline">{isDark ? 'Dark' : 'Light'}</span>
        <span
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            setMenuOpen((open) => !open);
          }}
          role="button"
          tabIndex={0}
          aria-label="Theme options"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }
          }}
          className="grid size-4 place-items-center rounded text-[var(--text-subtle)] hover:text-[var(--text)]"
        >
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="animate-scale-in surface absolute right-0 z-50 mt-1.5 w-36 origin-top-right overflow-hidden rounded-xl border border-[var(--border)] p-1 shadow-lifted">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  setPreference(option.id);
                  setMenuOpen(false);
                }}
                className={cx(
                  'press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px]',
                  preference === option.id
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'hover:bg-[var(--surface-muted)]',
                )}
              >
                {option.label}
                {preference === option.id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Sun and moon share one box; they rotate and fade through each other. */
function ThemeGlyph({ isDark }: { isDark: boolean }) {
  return (
    <span className="relative grid size-[1.05rem] shrink-0 place-items-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
        className={cx(
          'absolute size-[1.05rem] transition-all duration-[400ms] ease-[var(--ease-spring)]',
          isDark ? 'scale-50 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100',
        )}
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={cx(
          'absolute size-[1.05rem] transition-all duration-[400ms] ease-[var(--ease-spring)]',
          isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-90 opacity-0',
        )}
      >
        <path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z" />
      </svg>
    </span>
  );
}
