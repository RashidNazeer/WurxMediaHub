/**
 * Types for the vendored WurxBase app.
 *
 * WurxBase is plain JavaScript written by another developer for a separate
 * Create React App project. It was copied in whole and unchanged, on purpose:
 * Rashid asked for the code, features and logic to be left exactly alone and
 * only the look to become ours. So it is not converted to TypeScript, not
 * refactored, and not linted to our rules.
 *
 * These declarations are the seam. They tell our strict build what the two
 * entry components are without asking it to check thirty thousand lines of
 * somebody else's JavaScript, which would fail on the first line and would be
 * a change we were told not to make.
 */

declare module '@/vendor/wurxbase/App' {
  /*
   * The three props our route passes in. Everything else the vendored app
   * needs it owns itself; these exist because the SHELL is ours now — the six
   * tabs are six routes in our sidebar, so the tab has to come from the URL,
   * and the header is portaled into our top bar rather than drawn as a second
   * bar underneath it.
   *
   * All optional: unembedded and uncontrolled, App still renders the
   * standalone dashboard it was written as.
   */
  export interface WurxBaseAppProps {
    /** One of brands | creators | performance | reporting | leaderboard | discovery. */
    tab?: string;
    /** Called when something inside the app changes tab, e.g. a brand drilldown. */
    onTabChange?: (tab: string) => void;
    /** Hides its own tab rail and moves its header into our top bar. */
    embedded?: boolean;
  }
  const App: React.ComponentType<WurxBaseAppProps>;
  export default App;
}


declare module '@/vendor/wurxbase/access' {
  /*
   * The capability model, read by OUR sidebar so it can stop offering rows a
   * person cannot open. A pure function over a role name and a capability key —
   * no client, no network. `src/lib/wurxbase-identity.ts` is the only thing
   * that imports it.
   */
  export function defaultFor(role: string, key: string): boolean;
  export function can(user: unknown, key: string): boolean;
  export const ALL_CAPS: string[];
  export const ROLE_LIST: string[];
}

/** WURX-ADDED 2026-11-05: points the vendored client at the APC viewer's brand-scoped views. */
declare module '@/vendor/wurxbase/supabaseClient' {
  export function setApcViewer(on: boolean): void;
  export function isApcViewer(): boolean;
}
