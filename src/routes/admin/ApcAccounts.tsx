import { useState } from 'react';
import { Check, Copy, KeyRound, Plus, UserCheck, UserX } from 'lucide-react';
import { FilterBar } from '@/components/layout/FilterBar';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/auth-context';
import {
  useApcAccounts,
  useApcActions,
  useApcBrandChoices,
  type ApcAccount,
  type ManagedRole,
} from '@/lib/admin/useApcAccounts';

/**
 * APC, TL AND OL LOGINS. Three kinds of account, told apart by a badge on every row.
 *
 *   APC  view only, assigned brands, never a creator's contact or payment details
 *        (Rashid, 2026-11-05: "no edit access at all").
 *   TL   full Paid Collabs access, read and write, for the assigned brands only.
 *   OL   complete admin access to every brand. A staff-level login, so only an
 *        admin can create or change one.
 *
 * THIS SCREEN ONLY MANAGES ACCOUNTS. What an APC can actually read is decided in
 * the database (migration 20261105090100): brand-scoped views with the private
 * columns left out, and no write privilege at all. Nothing here, and nothing in
 * the APC's own screens, is what keeps them out.
 *
 * A password is shown once, when the account is made or reset. It is not
 * stored where this app or an admin can read it back.
 */

type Shown = { email: string; password: string; what: 'created' | 'reset' };

/** What each role is, in the words the owners use. */
const ROLE_INFO: Record<ManagedRole, { badge: string; title: string; what: string; scoped: boolean; tone: string }> = {
  apc_viewer: {
    badge: 'APC',
    title: 'APC (view only)',
    what: 'Sees only their assigned brands, never creators’ contact or payment details, and cannot change anything.',
    scoped: true,
    tone: 'bg-surface-2 text-muted',
  },
  team_lead: {
    badge: 'TL',
    title: 'TL (Team Lead)',
    what: 'Full access to Paid Collabs for their assigned brands only: they can read everything and make changes there. Other brands stay closed.',
    scoped: true,
    tone: 'bg-accent-soft text-accent',
  },
  ops_lead: {
    badge: 'OL',
    title: 'OL (Operations Lead)',
    what: 'Complete admin access to every brand, like the operations team. No brands to pick.',
    scoped: false,
    tone: 'bg-success-soft text-success',
  },
};

type Choice = { id: string; label: string };

function BrandPicker({
  choices,
  value,
  onChange,
  label,
}: {
  choices: Choice[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  const [q, setQ] = useState('');
  const list = choices.filter((b) => b.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (b: string) =>
    onChange(value.includes(b) ? value.filter((x) => x !== b) : [...value, b]);
  return (
    <div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${label}`}
        aria-label={`Search ${label}`}
        className="h-10"
      />
      <ul className="wx-neo-inset mt-2 max-h-56 overflow-auto rounded-md p-2">
        {list.map((b) => (
          <li key={b.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[0.875rem]">
              <input type="checkbox" checked={value.includes(b.id)} onChange={() => toggle(b.id)} />
              {b.label}
            </label>
          </li>
        ))}
        {list.length === 0 && <li className="text-muted px-2 py-1.5 text-[0.875rem]">No brands.</li>}
      </ul>
      <p className="text-muted mt-1 text-[0.8125rem]">{value.length} selected</p>
    </div>
  );
}

function Credentials({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Email: ${shown.email}\nPassword: ${shown.password}`;
  return (
    <div className="bg-accent-soft mt-4 rounded-xl p-5" role="status">
      <p className="font-bold">
        {shown.what === 'created' ? 'Account created.' : 'Password reset.'} Share these now.
      </p>
      <p className="text-muted mt-1 text-[0.875rem]">
        This password is shown once and cannot be looked up later. They will be asked to choose
        their own when they first sign in. If it is lost, reset it.
      </p>
      <pre className="wx-neo-inset mt-3 overflow-auto rounded-md px-3 py-2 text-[0.8125rem]">{text}</pre>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function ApcAccounts() {
  const accounts = useApcAccounts();
  const choiceQuery = useApcBrandChoices();
  const collabChoices: Choice[] = (choiceQuery.data?.brands ?? []).map((b) => ({ id: b, label: b }));
  const platformChoices: Choice[] = (choiceQuery.data?.platformBrands ?? []).map((b) => ({
    id: b.id,
    label: b.name,
  }));
  const platformName = (id: string) =>
    platformChoices.find((b) => b.id === id)?.label ?? 'Unknown brand';
  const actions = useApcActions();
  const { claims } = useAuth();
  /* Only an admin can make or change an OL; the Edge Function enforces it, this
     just keeps the option out of everyone else's way. */
  const isAdmin = claims?.role === 'admin';
  const roleChoices: ManagedRole[] = isAdmin ? ['apc_viewer', 'team_lead', 'ops_lead'] : ['apc_viewer', 'team_lead'];

  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<ManagedRole>('apc_viewer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [platformIds, setPlatformIds] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBrands, setEditBrands] = useState<string[]>([]);
  const [editPlatform, setEditPlatform] = useState<string[]>([]);

  const fail = (e: unknown) => setProblem(e instanceof Error ? e.message : 'That did not go through.');

  const create = async () => {
    setProblem('');
    if (!name.trim()) return setProblem('Add their name');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setProblem('That email does not look right');
    const scoped = ROLE_INFO[role].scoped;
    if (scoped && brands.length === 0) return setProblem('Assign at least one brand');
    try {
      const r = await actions.create.mutateAsync({
        email: email.trim(),
        displayName: name.trim(),
        role,
        brands: scoped ? brands : [],
        platformBrandIds: scoped ? platformIds : [],
      });
      setShown({ email: r.email, password: r.password, what: 'created' });
      setCreating(false);
      setName('');
      setEmail('');
      setBrands([]);
      setPlatformIds([]);
      setRole('apc_viewer');
    } catch (e) {
      fail(e);
    }
  };

  const changeRole = async (a: ApcAccount, next: ManagedRole) => {
    if (next === a.role) return;
    setProblem('');
    const from = ROLE_INFO[a.role].badge;
    const to = ROLE_INFO[next].badge;
    const note =
      next === 'ops_lead'
        ? 'They will get admin access to EVERY brand.'
        : a.role === 'ops_lead'
          ? 'They will lose access to every brand and keep only the brands you assign.'
          : next === 'team_lead'
            ? 'They keep their brands and gain the ability to make changes in them.'
            : 'They keep their brands but can only view them.';
    if (!window.confirm(`Change ${a.display_name || a.email} from ${from} to ${to}? ${note} They will be signed out and must sign in again.`)) return;
    try {
      await actions.setRole.mutateAsync({ userId: a.id, role: next, brands: next === 'ops_lead' ? [] : a.brands });
    } catch (e) {
      fail(e);
    }
  };

  const reset = async (a: ApcAccount) => {
    if (!window.confirm(`Reset the password for ${a.email}? Their current password stops working.`)) return;
    setProblem('');
    try {
      const r = await actions.resetPassword.mutateAsync({ userId: a.id });
      setShown({ email: r.email, password: r.password, what: 'reset' });
    } catch (e) {
      fail(e);
    }
  };

  const saveBrands = async (a: ApcAccount) => {
    setProblem('');
    if (editBrands.length === 0) return setProblem('Assign at least one brand, or disable the account');
    try {
      await actions.setBrands.mutateAsync({ userId: a.id,
        brands: editBrands,
        platformBrandIds: editPlatform,
      });
      setEditing(null);
    } catch (e) {
      fail(e);
    }
  };

  const toggleActive = async (a: ApcAccount) => {
    setProblem('');
    try {
      await actions.setActive.mutateAsync({ userId: a.id, active: !a.is_active });
    } catch (e) {
      fail(e);
    }
  };

  const list = accounts.data ?? [];

  return (
    <>
      <FilterBar
        action={
          <Button
            size="sm"
            className="h-10 pointer-coarse:h-11"
            onClick={() => {
              setCreating((v) => !v);
              setProblem('');
            }}
          >
            <Plus size={15} aria-hidden />
            New login
          </Button>
        }
      >
        <p className="text-muted text-[0.875rem]">
          <strong>APC</strong> views assigned brands only. <strong>TL</strong> has full access to
          assigned brands. <strong>OL</strong> has full admin access to every brand.
        </p>
      </FilterBar>

      {shown && <Credentials shown={shown} onClose={() => setShown(null)} />}

      {problem && (
        <p role="alert" className="text-danger mt-3 text-[0.875rem] font-semibold">
          {problem}
        </p>
      )}

      {creating && (
        <div className="wx-neo-raised mt-4 rounded-xl p-5">
          <fieldset>
            <legend className="mb-2 block text-[0.875rem] font-semibold">What kind of login</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {roleChoices.map((r) => (
                <label
                  key={r}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1 rounded-md p-3',
                    role === r ? 'wx-neo-raised' : 'wx-neo-inset'
                  )}
                >
                  <span className="flex items-center gap-2 font-bold">
                    <input type="radio" name="apc-role" checked={role === r} onChange={() => setRole(r)} />
                    {ROLE_INFO[r].title}
                  </span>
                  <span className="text-muted text-[0.8125rem]">{ROLE_INFO[r].what}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="apc-name">Name</Label>
              <Input id="apc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="apc-email">Email (their sign-in)</Label>
              <Input
                id="apc-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          {ROLE_INFO[role].scoped ? (
            <>
              <div className="mt-4">
                <Label htmlFor="apc-brands">
                  {role === 'team_lead' ? 'Paid Collabs brands they work on' : 'Paid Collabs brands they can see'}
                </Label>
                {choiceQuery.isPending ? (
                  <p className="text-muted mt-2 text-[0.875rem]">Loading brands…</p>
                ) : (
                  <BrandPicker label="brands" choices={collabChoices} value={brands} onChange={setBrands} />
                )}
              </div>
              <div className="mt-4">
                <Label htmlFor="apc-platform">Contest brands they can see (optional)</Label>
                <BrandPicker
                  label="contest brands"
                  choices={platformChoices}
                  value={platformIds}
                  onChange={setPlatformIds}
                />
              </div>
            </>
          ) : (
            <p className="text-muted mt-4 text-[0.875rem]">
              An OL works on every brand, so there is nothing to pick.
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void create()} disabled={actions.create.isPending}>
              {actions.create.isPending ? 'Creating…' : 'Create and generate password'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ul className="mt-4 grid gap-3">
        {accounts.isPending && <li className="text-muted">Loading…</li>}
        {accounts.isError && (
          <li role="alert" className="text-danger">
            Could not load the logins.
          </li>
        )}
        {accounts.isSuccess && list.length === 0 && (
          <li className="wx-neo-raised rounded-xl px-6 py-14 text-center">
            <p className="font-bold">No logins yet</p>
            <p className="text-muted mt-1 text-[0.875rem]">Create one for an APC, a TL or an OL.</p>
          </li>
        )}
        {list.map((a) => (
          <li key={a.id} className="wx-neo-raised rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-bold">
                  {a.display_name || a.email}
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold tracking-wider uppercase',
                      ROLE_INFO[a.role].tone
                    )}
                    title={ROLE_INFO[a.role].title}
                  >
                    {ROLE_INFO[a.role].badge}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold tracking-wider uppercase',
                      a.is_active ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'
                    )}
                  >
                    {a.is_active ? 'Active' : 'Disabled'}
                  </span>
                </p>
                <p className="text-muted text-[0.875rem]">{a.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(a.role !== 'ops_lead' || isAdmin) && (
                  <div className="w-44">
                    <Select
                      aria-label={`Role for ${a.display_name || a.email}`}
                      value={a.role}
                      onChange={(e) => void changeRole(a, e.target.value as ManagedRole)}
                      className="h-10 pointer-coarse:h-11"
                    >
                      {roleChoices.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_INFO[r].badge}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {ROLE_INFO[a.role].scoped && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(editing === a.id ? null : a.id);
                      setEditBrands(a.brands);
                      setEditPlatform(a.platformBrandIds);
                      setProblem('');
                    }}
                  >
                    Brands
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => void reset(a)}>
                  <KeyRound size={15} aria-hidden />
                  Reset password
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleActive(a)}>
                  {a.is_active ? <UserX size={15} aria-hidden /> : <UserCheck size={15} aria-hidden />}
                  {a.is_active ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
            {editing === a.id ? (
              <div className="mt-4">
                <Label htmlFor="apc-edit-brands">Paid Collabs brands</Label>
                <BrandPicker label="brands" choices={collabChoices} value={editBrands} onChange={setEditBrands} />
                <div className="mt-3">
                  <Label htmlFor="apc-edit-platform">Contest brands</Label>
                  <BrandPicker
                    label="contest brands"
                    choices={platformChoices}
                    value={editPlatform}
                    onChange={setEditPlatform}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => void saveBrands(a)} disabled={actions.setBrands.isPending}>
                    Save brands
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted mt-3 text-[0.875rem]">
                {!ROLE_INFO[a.role].scoped
                  ? 'Every brand'
                  : a.brands.length
                    ? a.brands.join(' · ')
                    : 'No brands assigned'}
                {a.platformBrandIds.length > 0 &&
                  ` · Contests: ${a.platformBrandIds.map(platformName).join(', ')}`}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
