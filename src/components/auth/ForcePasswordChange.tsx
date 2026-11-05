import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Label, PasswordInput } from '@/components/ui/Field';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/schemas/password-rules';

/**
 * FIRST SIGN-IN FOR AN APC: CHOOSE YOUR OWN PASSWORD.
 *
 * The password an admin shares was generated for them and passed on by hand, so
 * it is only ever a way in the first time. Until it is changed, nothing else in
 * the app renders.
 *
 * This is a convenience flag, not a security boundary: `must_change_password`
 * sits in the user's own metadata, which they could edit. What it protects is
 * the admin's wish that a shared password does not live on. What an APC may
 * READ is decided in the database and does not depend on this screen.
 *
 * `@/lib/supabase` is imported on demand so the Supabase client stays out of
 * the entry chunk, as `useWurxbaseIdentity` does.
 */
export function ForcePasswordChange({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setProblem('');
    if (pw.length < PASSWORD_MIN) return setProblem(`Use at least ${PASSWORD_MIN} characters`);
    if (pw.length > PASSWORD_MAX) return setProblem(`Use at most ${PASSWORD_MAX} characters`);
    if (pw !== again) return setProblem('The two passwords do not match');
    setPending(true);
    try {
      const { getSupabase } = await import('@/lib/supabase');
      const { error } = await getSupabase().auth.updateUser({
        password: pw,
        data: { must_change_password: false },
      });
      if (error) {
        setProblem(error.message || 'That did not go through. Try again.');
        return;
      }
      onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={(e) => void submit(e)} className="wx-neo-raised w-full max-w-md rounded-xl p-6">
        <h1 className="text-xl font-bold">Choose your own password</h1>
        <p className="text-muted mt-1 text-[0.9375rem]">
          The one you were given is for first sign-in only. Pick a new one to continue.
        </p>
        <div className="mt-5">
          <Label htmlFor="fpc-new">New password</Label>
          <PasswordInput
            id="fpc-new"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="mt-4">
          <Label htmlFor="fpc-again">Confirm new password</Label>
          <PasswordInput
            id="fpc-again"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {problem && (
          <p role="alert" className="text-danger mt-3 text-[0.875rem] font-semibold">
            {problem}
          </p>
        )}
        <Button type="submit" className="mt-5 w-full" disabled={pending}>
          {pending ? 'Saving…' : 'Save and continue'}
        </Button>
      </form>
    </main>
  );
}
