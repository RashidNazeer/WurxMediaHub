import { createContext, useContext } from 'react';

/** What the user picked. `system` follows the operating system setting. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** What is actually on screen right now. `system` has been resolved away. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'wurxmediahub-theme';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Cycles light -> dark -> system -> light. */
  cycle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
