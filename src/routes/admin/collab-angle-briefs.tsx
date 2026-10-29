import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FilePlus2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Notice } from '@/components/admin/backups/Modal';
import { parseBriefUrl } from '@/lib/brief-url';
import { callAngles } from './collab-angles-api';

/**
 * A BRAND'S CREATIVE BRIEFS, to add and to change, inside the Categorise dialog.
 *
 * Umar: a brand with no brief saved (Mineral Ice) must let the person paste the
 * brief's link when they press Categorise; a brand can have more than one brief
 * (one per focus product); and a saved brief can be updated.
 *
 * WHY THIS EXISTS AT ALL. Categorising judges each video against the brief the
 * brand's creators were given, and until now the only way to register a brief
 * was a migration. A brand without one answered "has no content brief on file"
 * and stopped. Here the link is entered on the screen where the problem is met.
 *
 * Like everything else in this dialog it never touches the database: `brief.list`
 * and `brief.save` are actions on the `collab-angles` Edge Function, which checks
 * the caller is staff, asks Google whether the document is shared, and writes the
 * audit log. The link is also parsed here (src/lib/brief-url.ts, the twin of the
 * function's copy) so a typo is answered at once, but the function is the
 * authority.
 *
 * One brand can have SEVERAL briefs and the table allows one per product name, so
 * a second brief needs a product name, and the form says why.
 */

type Brief = {
  id: string;
  product: string;
  brief_url: string;
  angle_count: number;
  updated_at: string | null;
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toBriefs(raw: unknown): Brief[] {
  const list = (raw as { briefs?: unknown } | null)?.briefs;
  return (Array.isArray(list) ? list : []).map((b) => {
    const o = b as Record<string, unknown>;
    return {
      id: String(o.id ?? ''),
      product: typeof o.product === 'string' ? o.product : '',
      brief_url: String(o.brief_url ?? ''),
      angle_count: num(o.angle_count),
      updated_at: typeof o.updated_at === 'string' ? o.updated_at : null,
    };
  });
}

/** `docs.google.com/document/d/1AbC…/edit?tab=t.0`, short enough to read in a row. */
function shortLink(url: string): string {
  const m = /\/document\/d\/([A-Za-z0-9_-]+)/.exec(url);
  const tab = /[?&]tab=(t\.[A-Za-z0-9]+)/.exec(url)?.[1];
  return m ? `Google Doc …${m[1]!.slice(-6)}${tab ? ` · tab ${tab}` : ''}` : url;
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

type Props = {
  brand: string;
  /** How many briefs the brand has, or null while that is not known yet. */
  onCount: (n: number | null) => void;
  /** Called after a brief was added or changed. */
  onChanged?: () => void;
};

export function CollabAngleBriefs({ brand, onCount, onChanged }: Props) {
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  /** The id being edited, 'new' for the add form, or null for neither. */
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [url, setUrl] = useState('');
  const [product, setProduct] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const alive = useRef(true);
  const scope = useRef(brand);
  scope.current = brand;
  const countRef = useRef(onCount);
  useEffect(() => {
    countRef.current = onCount;
  }, [onCount]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const asked = brand;
    try {
      const raw = await callAngles<unknown>({ action: 'brief.list', brand }, 'Could not read the briefs.');
      if (!alive.current || scope.current !== asked) return;
      const next = toBriefs(raw);
      setBriefs(next);
      setError(null);
      countRef.current(next.length);
      /* A brand with none goes straight to the form: it cannot do anything else. */
      if (next.length === 0) setEditing((e) => e ?? 'new');
    } catch (e) {
      if (alive.current && scope.current === asked) setError((e as Error).message);
    }
  }, [brand]);

  /* A different brand is a different set of briefs: forget the old one. */
  useEffect(() => {
    setBriefs(null);
    setError(null);
    setNotice(null);
    setEditing(null);
    setUrl('');
    setProduct('');
    setFormError(null);
    countRef.current(null);
    void load();
  }, [brand, load]);

  const open = (id: string | 'new') => {
    const b = briefs?.find((x) => x.id === id);
    setEditing(id);
    setUrl(b?.brief_url ?? '');
    setProduct(b?.product ?? '');
    setFormError(null);
    setNotice(null);
  };
  const close = () => {
    setEditing(null);
    setFormError(null);
  };

  const hasBriefs = (briefs?.length ?? 0) > 0;
  /* The product name matters from the second brief on: the table allows one
     brief per product name, and it is the label the audit backend reports. */
  const needsProduct = editing === 'new' && hasBriefs;
  const showProduct =
    needsProduct || (editing !== null && editing !== 'new' && (briefs!.length > 1 || product !== ''));

  const save = async () => {
    if (saving || editing === null) return;
    const checked = parseBriefUrl(url);
    if (!checked.ok) return setFormError(checked.error);
    if (needsProduct && !product.trim()) {
      return setFormError(
        `${brand} already has a brief, so this one needs the product it is for. ` +
          'Each brief of a brand is told apart by its product name.',
      );
    }
    setSaving(true);
    setFormError(null);
    try {
      const r = await callAngles<{ created?: boolean; verified?: boolean }>(
        {
          action: 'brief.save',
          brand,
          brief_url: url,
          product: product.trim(),
          ...(editing !== 'new' ? { id: editing } : {}),
        },
        'Could not save the brief.',
      );
      if (!alive.current) return;
      setNotice(
        r.verified === false
          ? {
              tone: 'warn',
              text: 'Saved, but Google did not answer, so I could not confirm the document is shared. If categorising fails, check its sharing.',
            }
          : { tone: 'good', text: r.created ? 'Brief added.' : 'Brief updated.' },
      );
      setEditing(null);
      await load();
      onChanged?.();
    } catch (e) {
      if (alive.current) setFormError((e as Error).message);
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  if (!brand) return null;

  return (
    <section aria-label="Creative briefs" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[0.9375rem] font-bold">Creative brief{hasBriefs && briefs!.length > 1 ? 's' : ''}</h3>
        {hasBriefs && editing === null ? (
          <Button size="sm" variant="secondary" onClick={() => open('new')}>
            <FilePlus2 size={14} aria-hidden /> Add another brief
          </Button>
        ) : null}
      </div>

      {error ? <Notice tone="bad">{error}</Notice> : null}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {briefs && !hasBriefs ? (
        <Notice tone="warn">
          {brand} has no creative brief yet, so its videos cannot be categorised. Paste the link to its
          brief below and it can be.
        </Notice>
      ) : null}

      {hasBriefs ? (
        <ul className="space-y-2">
          {briefs!.map((b) => (
            <li key={b.id} className="bg-surface-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3">
              <div className="min-w-0 flex-1 text-[0.8125rem]">
                <span className="block font-semibold">{b.product || 'Brief'}</span>
                <a
                  href={b.brief_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent inline-flex items-center gap-1 hover:underline"
                >
                  {shortLink(b.brief_url)} <ExternalLink size={12} aria-hidden />
                </a>
                <span className="text-muted block">
                  {b.angle_count > 0
                    ? `${b.angle_count} concepts read`
                    : 'Concepts are read from the document on the next run'}
                  {day(b.updated_at) ? ` · updated ${day(b.updated_at)}` : ''}
                </span>
              </div>
              {editing !== b.id ? (
                <Button size="sm" variant="secondary" disabled={editing !== null} onClick={() => open(b.id)}>
                  <Pencil size={14} aria-hidden /> Edit link
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {editing !== null ? (
        <form
          className="bg-surface-2 space-y-3 rounded-xl px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {showProduct ? (
            <Field
              label={needsProduct ? 'Product this brief is for' : 'Product'}
              hint={
                needsProduct
                  ? 'Required: each brief of a brand has its own product name.'
                  : 'Optional. The name shown for this brief.'
              }
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  value={product}
                  maxLength={80}
                  disabled={saving}
                  placeholder="e.g. Hair Perfection"
                  onChange={(e) => setProduct(e.target.value)}
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </Field>
          ) : null}

          <Field
            label={editing === 'new' ? 'Link to the brief' : 'New link to the brief'}
            error={formError ?? undefined}
            hint={
              'A Google Docs link, shared as "Anyone with the link" can view. For a document with a tab per ' +
              'product, open that tab first so the link ends in ?tab=…'
            }
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="url"
                value={url}
                disabled={saving}
                placeholder="https://docs.google.com/document/d/…"
                onChange={(e) => setUrl(e.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>

          {editing !== 'new' ? (
            <p className="text-muted text-[0.75rem]">
              Videos already categorised stay where they are. The next run uses the new link.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving || !url.trim()}>
              {saving ? 'Checking the link…' : editing === 'new' ? 'Save brief' : 'Save link'}
            </Button>
            {hasBriefs ? (
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={close}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

