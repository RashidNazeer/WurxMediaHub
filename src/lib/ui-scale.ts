import { useCallback, useEffect, useState } from 'react';

/**
 * HOW BIG THE PRODUCT IS SET, and the one place that decides it.
 *
 * BUILT 2026-08-16. Rashid asked for two things at once: everything a little
 * smaller than it was, and a way for a person to change it themselves. Both are
 * the same control, so there is one mechanism with a new default rather than a
 * global shrink plus a separate accessibility setting bolted on later.
 *
 * HOW IT WORKS, and why it is not a font-size on a wrapper. Every size in this
 * codebase is now a `rem`, and Tailwind's spacing scale is `rem` too, so a
 * single `font-size` on the ROOT element moves type, padding, gaps, icons
 * measured in `rem` and rounded corners together. That is the difference
 * between a page whose text shrank inside boxes that did not, and a page that
 * is genuinely denser. It is also why the conversion from `px` to `rem` had to
 * happen first: a hardcoded pixel type size ignores this entirely. 846 of them
 * were converted on the day this landed, and new ones must not appear.
 *
 * WHAT IT DOES NOT TOUCH: breakpoints. `rem` inside a media query is always
 * measured against the browser's initial 16px, never against this, so `lg:`
 * still arrives at 1024px at every setting. The responsive suite's four widths
 * mean the same thing before and after.
 *
 * SCOPED TO THE SIGNED-IN APP. `ShellLayout` sets the attribute when it mounts
 * and clears it when it unmounts, so the public landing page keeps the
 * proportions it was designed at.
 */

export const UI_SCALES = [
  { value: 'compact', label: 'Compact', px: 13.6 },
  { value: 'snug', label: 'Snug', px: 14.4 },
  { value: 'default', label: 'Default', px: 15 },
  { value: 'large', label: 'Large', px: 16.5 },
] as const;

type UiScale = (typeof UI_SCALES)[number]['value'];

/**
 * 15px, against the browser's 16px. Everything is about 6% smaller than it was
 * on 2026-08-15, which is the "a little smaller" he asked for rather than a
 * change somebody has to squint at to notice.
 */
const DEFAULT_UI_SCALE: UiScale = 'default';

const KEY = 'wurxmediahub-ui-scale';

const isScale = (v: string | null): v is UiScale =>
  UI_SCALES.some((s) => s.value === v);

/** Read the stored choice. Safe before hydration and in a test runner. */
export function storedUiScale(): UiScale {
  if (typeof window === 'undefined') return DEFAULT_UI_SCALE;
  const raw = window.localStorage.getItem(KEY);
  return isScale(raw) ? raw : DEFAULT_UI_SCALE;
}

/**
 * Put it on the document. The CSS lives in `global.css`, keyed off this
 * attribute, so nothing here needs to know a pixel value.
 */
export function applyUiScale(scale: UiScale) {
  document.documentElement.dataset.uiScale = scale;
}

export function clearUiScale() {
  delete document.documentElement.dataset.uiScale;
}

/**
 * Shared across every control that shows the setting, so the header popover and
 * anything added later cannot disagree about what is selected. A plain module
 * subscription rather than context: the shell must not gain another provider,
 * and nothing here is per-session.
 */
const listeners = new Set<(s: UiScale) => void>();

function setUiScale(scale: UiScale) {
  window.localStorage.setItem(KEY, scale);
  applyUiScale(scale);
  listeners.forEach((fn) => fn(scale));
}

export function useUiScale(): [UiScale, (s: UiScale) => void] {
  const [scale, setScale] = useState<UiScale>(storedUiScale);

  useEffect(() => {
    listeners.add(setScale);
    // Another tab changing it should not leave this one out of step.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && isScale(e.newValue)) {
        applyUiScale(e.newValue);
        setScale(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(setScale);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const set = useCallback((s: UiScale) => setUiScale(s), []);
  return [scale, set];
}
