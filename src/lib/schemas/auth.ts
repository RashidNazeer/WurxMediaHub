import { z } from 'zod';
import { PASSWORD_MAX, PASSWORD_MIN, isObviousPassword } from './password-rules';

/**
 * Auth form contracts.
 *
 * Kept separate from the application schema so the two do not drag each other
 * into the same chunk. These load with the auth routes, which are behind a
 * click, so they can be imported normally.
 *
 * The minimum length matches `password_min_length` on the Supabase project. If
 * one changes, change the other, or people will pass the form and be rejected
 * by the server, which is a maddening bug to report.
 */
const password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Passwords are limited to ${PASSWORD_MAX} characters`)
  /* The same tightening the apply form got on 2026-10-16: a run, a repeat or a
     name off the short list in `password-rules.ts` is refused. Nothing that
     passed before stops passing unless it is one of those. */
  .refine((v) => !isObviousPassword(v), {
    message: 'That is too easy to guess. Three unrelated words work well.',
  });

const email = z
  .string()
  .trim()
  .min(1, 'Enter your email')
  .email('That email does not look right');

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Both passwords need to match',
    path: ['confirmPassword'],
  });

export type SignInInput = z.infer<typeof signInSchema>;

/** One message per bad field, in the shape the forms expect. */
export function collectErrors<T extends Record<string, unknown>>(
  schema: z.ZodType<unknown, T>,
  input: T
): Partial<Record<keyof T, string>> {
  const result = schema.safeParse(input);
  if (result.success) return {};
  const errors: Partial<Record<keyof T, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof T | undefined;
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
