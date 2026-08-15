import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { cx } from './ui/primitives';

/**
 * Scroll-triggered reveal.
 *
 * Entrance animation that fires when an element scrolls into view, rather than
 * when the page mounts. On a long marketing page those are completely different
 * things: mount-time animation plays for content the visitor cannot see yet, so
 * by the time they scroll to it the motion has already finished and the section
 * simply appears. This waits for the element to actually approach the viewport.
 *
 * Three properties that matter more than the effect itself:
 *
 *  - **It never hides content permanently.** If IntersectionObserver is
 *    unavailable, or JS fails, the element renders visible. An animation
 *    library that leaves text at `opacity: 0` on failure has broken the page
 *    to decorate it.
 *  - **It observes once, then disconnects.** Re-animating on every scroll past
 *    is nausea-inducing and keeps observers alive for the page's lifetime.
 *  - **`prefers-reduced-motion` skips it entirely** — not a faster animation, no
 *    animation. Vestibular disorders are not a speed preference.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className,
  /** Distance to travel, in px. Larger reads as heavier — keep it subtle. */
  distance = 18,
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
  distance?: number;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Honour the OS setting, and treat a missing API as "show it".
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    /*
     * IntersectionObserver does not fire while the document is hidden — a
     * background tab, a webview that was never brought to front, a print
     * render. Without this the content would stay at `opacity: 0` for the
     * lifetime of the page: the exact failure this component is supposed to
     * rule out. Nobody is watching a hidden document, so there is no animation
     * to lose by simply showing it.
     */
    if (document.visibilityState === 'hidden') {
      setVisible(true);
      return;
    }

    const revealIfHidden = () => {
      if (document.visibilityState === 'hidden') setVisible(true);
    };
    document.addEventListener('visibilitychange', revealIfHidden);

    // Already on screen at mount (above the fold): reveal without waiting for a
    // scroll that may never come.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        // Start slightly before the element reaches the viewport so the motion
        // completes as it arrives rather than beginning once it is already read.
        rootMargin: '0px 0px -12% 0px',
        threshold: 0.08,
      },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', revealIfHidden);
    };
  }, []);

  return (
    <Tag
      ref={ref}
      className={cx('reveal', visible && 'is-visible', className)}
      style={{
        '--reveal-delay': `${delay}ms`,
        '--reveal-distance': `${distance}px`,
      } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}

/**
 * Reveals children in sequence as the group scrolls in.
 *
 * The delay is per-child rather than per-group so a row of three cards arrives
 * as a wave. Capped at 6 steps: past that the last item lags far enough behind
 * that it reads as a page that has not finished loading.
 */
export function RevealGroup({
  children,
  className,
  step = 80,
}: {
  children: ReactNode[];
  className?: string;
  step?: number;
}) {
  return (
    <div className={className}>
      {children.map((child, index) => (
        <Reveal key={index} delay={Math.min(index, 6) * step}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
