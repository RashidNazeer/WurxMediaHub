/**
 * PASSWORD RULES AND THE STRENGTH HEURISTIC. Deliberately Zod-free and
 * dependency-free, like `application-fields.ts` next door, so the apply form can
 * draw the meter and the checklist while Zod is still lazy-loading.
 *
 * ═══ NOTHING HERE LEAVES THE BROWSER ═══
 *
 * Every function in this file takes the password as an argument and returns a
 * number, a boolean or a label. There is no fetch, no logging, no analytics and
 * no hash. The password is sent to exactly one place in the product and that is
 * the `supabase.auth.signUp` / `auth.updateUser` call that already existed.
 *
 * ═══ WHY A HAND-WRITTEN HEURISTIC AND NOT ZXCVBN ═══
 *
 * A real entropy estimator ships a dictionary — zxcvbn is ~400 KB — onto the
 * landing page, which is the one page in this product that is measured for
 * weight, for a number that only ever decorates a label. So the meter below is
 * three cheap, explainable signals:
 *
 *   1. LENGTH, which is the only one that reliably buys anything;
 *   2. CHARACTER VARIETY, worth one point and no more, because "P@ssw0rd1!"
 *      has four classes and is on every cracking list;
 *   3. AN OBVIOUS-PATTERN CHECK, which can take the score straight to zero.
 *
 * It is advice, not arithmetic, and it is labelled as advice. The rules that
 * actually BLOCK a signup are the ones in `requirementsFor` below, and they are
 * enforced again by the Zod schema (`src/lib/schemas/application.ts`) and by
 * Supabase's own `password_min_length`.
 */

/** Must match `password_min_length` on the Supabase projects. */
export const PASSWORD_MIN = 10;

/**
 * Supabase hashes with bcrypt, which silently ignores anything past 72 bytes.
 * A longer box would let somebody type a passphrase whose tail does nothing.
 */
export const PASSWORD_MAX = 72;

/*
 * Straight runs, forwards and backwards: keyboard rows, the digits and the
 * alphabet. Five characters is the shortest run that is unmistakably a pattern
 * rather than a coincidence — "qwerty", "123456", "abcdefg" and their reverses
 * all trip it, while ordinary words do not contain five adjacent letters of the
 * alphabet or of a keyboard row.
 */
const RUNS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'abcdefghijklmnopqrstuvwxyz'];
const RUN_LEN = 5;

/*
 * A DELIBERATELY TINY LIST. A real deny-list is a download; this only has to
 * catch the handful of things somebody types when a form says "at least 10
 * characters" and they want to get past it. Anything longer and lazier is
 * caught by the run check or by the repeated-character check instead.
 */
const COMMON = new Set([
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  'passwordpassword',
  'qwerty12345',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'adminadmin',
  'changeme123',
  'trustno1234',
  'princess12',
  'football12',
  'baseball12',
  'superman123',
  'starwars123',
]);

function hasStraightRun(lower: string): boolean {
  for (const row of RUNS) {
    const reversed = [...row].reverse().join('');
    for (let i = 0; i + RUN_LEN <= row.length; i += 1) {
      if (lower.includes(row.slice(i, i + RUN_LEN))) return true;
      if (lower.includes(reversed.slice(i, i + RUN_LEN))) return true;
    }
  }
  return false;
}

/**
 * Is this one of the handful of shapes that is long enough to pass the length
 * rule and still worthless? Four cheap tests, no dictionary.
 */
export function isObviousPassword(password: string): boolean {
  const pw = password.trim();
  if (!pw) return false;
  const lower = pw.toLowerCase();

  // "aaaaaaaaaa", and "abababababab" — almost no distinct characters.
  if (new Set(lower).size <= 3) return true;
  if (hasStraightRun(lower)) return true;
  if (COMMON.has(lower)) return true;
  // The same short block typed twice: "wurxwurxwurx".
  for (let n = 2; n <= 4; n += 1) {
    if (lower.length % n === 0) {
      const block = lower.slice(0, lower.length / n);
      if (block.repeat(n) === lower && new Set(block).size <= 5) return true;
    }
  }
  return false;
}

type Requirement = {
  id: 'length' | 'pattern' | 'match';
  /** Written as the thing that must be true, so the ticked state reads right. */
  label: string;
  met: boolean;
};

/**
 * The rules that actually decide whether the form submits, in the order they
 * are shown. `confirm` is optional so a screen with one box (nothing today, but
 * the reset screen used to be one) can leave the third rule out.
 */
export function requirementsFor(password: string, confirm?: string): Requirement[] {
  const rules: Requirement[] = [
    {
      id: 'length',
      label: `${PASSWORD_MIN} characters or more`,
      met: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    },
    {
      id: 'pattern',
      label: 'Not an obvious pattern like 1234567890',
      met: password.length > 0 && !isObviousPassword(password),
    },
  ];
  if (confirm !== undefined) {
    rules.push({
      id: 'match',
      label: 'Both entries match',
      met: password.length > 0 && password === confirm,
    });
  }
  return rules;
}

export type PasswordStrength = {
  /** 0 is "do not use this", 4 is as good as this meter can say. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** One concrete thing that would improve it, or null when nothing would. */
  advice: string | null;
};

/**
 * Score a password locally. See the file header for what the three signals are
 * and why there are only three.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: 'Nothing yet', advice: null };

  if (isObviousPassword(password)) {
    return {
      score: 0,
      label: 'Too easy to guess',
      advice: 'Three unrelated words beat any pattern.',
    };
  }

  if (password.length < PASSWORD_MIN) {
    return {
      score: 0,
      label: 'Too short',
      advice: `${PASSWORD_MIN - password.length} more character${
        PASSWORD_MIN - password.length === 1 ? '' : 's'
      } to go.`,
    };
  }

  /* LENGTH CARRIES THE SCORE. These four steps are chosen so that a passphrase
     of three ordinary words reaches the top without needing a symbol in it,
     which is the behaviour we actually want to encourage. */
  let score = 1;
  if (password.length >= 13) score = 2;
  if (password.length >= 16) score = 3;
  if (password.length >= 20) score = 4;

  /* VARIETY IS WORTH EXACTLY ONE POINT, never more: a short password with four
     character classes is still a short password. */
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes >= 3) score += 1;

  const final = Math.min(4, score) as PasswordStrength['score'];
  const LABELS = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

  let advice: string | null = null;
  if (final < 4) {
    advice =
      password.length < 16
        ? 'Longer is stronger — try adding another word.'
        : classes < 3
          ? 'Add a capital, a number or a symbol.'
          : null;
  }

  return { score: final, label: LABELS[final], advice };
}
