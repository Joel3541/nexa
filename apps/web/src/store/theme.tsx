import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Theme control.
 *
 * Three states, not two: `light`, `dark` and `system`. "System" is the default
 * because most people have already told their OS what they want, and a product
 * that ignores that answer is asking a question twice.
 *
 * The resolved theme is applied as a class on <html>, which is what both the
 * design tokens and Tailwind's `dark:` variant key off (see styles.css).
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'nexa.theme';

interface ThemeValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeValue | null>(null);

function readPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function systemTheme(): ResolvedTheme {
  if (typeof matchMedia === 'undefined') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(resolved: ResolvedTheme, animate: boolean): void {
  const root = document.documentElement;
  if (root.classList.contains('dark') === (resolved === 'dark')) return;

  if (animate) {
    // One shared cross-fade instead of every element easing independently.
    root.classList.add('theme-switching');
    window.setTimeout(() => root.classList.remove('theme-switching'), 300);
  }

  root.classList.toggle('dark', resolved === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0d0f16' : '#f4f5f9');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(systemTheme);

  const resolved: ResolvedTheme = preference === 'system' ? systemResolved : preference;

  // Follow the OS live, but only while the user is on "system".
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemResolved(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // The boot script in index.html already applied the right class, so the first
  // pass must not animate — otherwise every load starts with a visible fade.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    apply(resolved, booted);
    if (!booted) setBooted(true);
  }, [resolved, booted]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggle = useCallback(() => {
    // A toggle should do the obvious thing: flip what you can currently see.
    setPreferenceState((current) => {
      const currentResolved = current === 'system' ? systemTheme() : current;
      const next: ThemePreference = currentResolved === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeCtx);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return context;
}
