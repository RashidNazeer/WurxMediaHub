/**
 * Application field definitions and types. Deliberately Zod-free.
 *
 * The form needs the option lists and the shape to render, but it does not need
 * the validation engine until someone actually presses submit. Keeping these in
 * a separate module means importing them does not drag Zod (~60 KB gzipped)
 * onto the landing page's critical path. See `application.ts` for the schema.
 */

export const NICHES = [
  'Beauty & skincare',
  'Health & wellness',
  'Fitness & recovery',
  'Home & kitchen',
  'Fashion & accessories',
  'Food & beverage',
  'Baby & kids',
  'Pets',
  'Tech & gadgets',
  'Other',
] as const;

export type Niche = (typeof NICHES)[number];

export const WORKED_WITH_WURX = [
  { value: 'no', label: 'No, this is my first time' },
  { value: 'yes', label: 'Yes, I know my contact by name' },
] as const;

export type WorkedWithWurx = (typeof WORKED_WITH_WURX)[number]['value'];

/**
 * Must match `password_min_length` on the Supabase projects. If one changes,
 * change the other, or people pass the form and get rejected by the server,
 * which is a maddening bug to report.
 *
 * RE-EXPORTED, NOT RE-DECLARED, since 2026-10-16. The same number was written
 * out in three files — here, `auth.ts` and now the strength rules — and three
 * copies of a number that must equal a server setting is two copies too many.
 * `password-rules.ts` is the one that owns it and it is Zod-free, so importing
 * it costs this module nothing.
 */
export { PASSWORD_MIN } from './password-rules';

/** Raw form state. Empty strings are the "nothing picked yet" case. */
export interface ApplicationInput {
  tiktokHandle: string;
  email: string;
  niche: Niche | '';
  nicheOther?: string;
  workedWithWurx: WorkedWithWurx | '';
  videoLinks: string;
  /** Applying creates the account, so the password is collected here. */
  password: string;
  /**
   * TYPED TWICE, since 2026-10-16.
   *
   * The show/hide toggle used to be the argument against a second box, and it
   * is a good argument for a typo you can SEE. It does nothing for the typo you
   * cannot: this password is the only way back into an account whose email is
   * not verified yet, and a reset email is the only recovery there is. Two
   * reviewers asked for the field; the toggle stays as well, because together
   * they catch different mistakes.
   */
  confirmPassword: string;
}

export const emptyApplication: ApplicationInput = {
  tiktokHandle: '',
  email: '',
  niche: '',
  nicheOther: '',
  workedWithWurx: '',
  videoLinks: '',
  password: '',
  confirmPassword: '',
};

export type ApplicationErrors = Partial<Record<keyof ApplicationInput, string>>;
