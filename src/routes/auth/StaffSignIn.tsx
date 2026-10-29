import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { AuthShell, FormError } from '@/components/auth/AuthShell';
import { friendlyAuthError } from '@/lib/auth/auth-errors';
import { Field, Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { getSupabase } from '@/lib/supabase';
import { collectErrors, signInSchema, type SignInInput } from '@/lib/schemas/auth';
import { HOME_FOR_ROLE, readClaims } from '@/lib/auth/auth-context';

/**
 * The staff door, at /admin/login.
 *
 * A separate screen because the team should not be greeted by a page selling
 * them on applying, and there must be no sign up route anywhere near it. Staff
 * accounts are only ever created with `scripts/ops/create-admin.mjs`, holding the
 * service key.
 *
 * Be clear about what this is: a different DOOR, not a different LOCK. Both
 * screens call the same sign-in, and the thing that actually decides what
 * anyone can do is row level security plus the Edge Function's server-side role
 * check. Nothing here is a security boundary, and it must never be treated as
 * one. A creator who signs in here is simply sent to their own dashboard rather
 * than being told off for using the wrong URL.
 */
export function StaffSignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState<SignInInput>({ email: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof SignInInput, string>>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);

  const set = <K extends keyof SignInInput>(k: K, v: SignInInput[K]) =>
    setValues((prev) => ({ ...prev, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const next = collectErrors(signInSchema, values);
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    const { data, error } = await getSupabase().auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    });
    setPending(false);

    if (error) {
      setFormError(friendlyAuthError(error.message));
      return;
    }

    // The one place a sign-in redirect happens. The auth listener never
    // navigates, so a background token refresh cannot move anyone.
    const intended = (location.state as { from?: string } | null)?.from;
    const claims = readClaims(data.session?.access_token);
    navigate(intended ?? (claims ? HOME_FOR_ROLE[claims.role] : '/app'), { replace: true });
  }

  return (
    <AuthShell
      eyebrow={
        <span className="bg-accent-soft text-accent inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[0.6875rem] tracking-[0.16em] uppercase">
          <ShieldCheck size={13} aria-hidden />
          Staff access
        </span>
      }
      title="Welcome back"
      subtitle="Sign in to the Wurx control room: applications, creators, brands and data."
      footer={
        // A way out for anyone who lands here by mistake. Deliberately not a
        // sign up link: there is no such thing for staff.
        <>
          Not on the team?{' '}
          <Link to="/login" className="text-accent font-medium hover:underline">
            Creator sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <FormError>{formError}</FormError>

        <div className="space-y-5">
          <Field label="Work email" error={errors.email}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@wurxmedia.com"
                value={values.email}
                onChange={(e) => set('email', e.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>

          <Field label="Password" error={errors.password}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Your password"
                value={values.password}
                onChange={(e) => set('password', e.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>
        </div>

        <div className="mt-3 text-right">
          <Link
            to="/forgot-password"
            className="text-muted hover:text-accent text-[0.8125rem] underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" size="lg" disabled={pending} className="group mt-6 w-full">
          {pending ? (
            'Signing you in...'
          ) : (
            <>
              Sign in
              <ArrowRight
                size={17}
                className="ease-brand transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden
              />
            </>
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
