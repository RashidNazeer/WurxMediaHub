import { useMemo, useState } from 'react';
import { ChevronDown, Plus, RotateCcw, X } from 'lucide-react';
import { Field, Input } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import {
  AREA_KEYS,
  EDITABLE_AREA_KEYS,
  AREA_META,
  DEFAULT_ANGLE,
  DEFAULT_BRAND_COLOR,
  auditBrandTheme,
  deriveBrandTheme,
  fitArea,
  stopsToCss,
  type BrandArea,
  type BrandAreaKey,
  type BrandPalette,
  type BrandThemeConfig,
} from '@/lib/brand-theme';

/**
 * How a brand looks inside its hub, and every part of it an admin can decide.
 *
 * Since 2026-10-09 a hub is a normal PRISM screen wearing the brand's accent and
 * hero, so only "Hero banner" and "Buttons and highlights" are offered. "Menu"
 * and "Pages and cards" are retired (see `EDITABLE_AREA_KEYS`).
 *
 * WHAT THIS USED TO BE, AND WHY IT CHANGED. Until 2026-08-25 this was one
 * colour picker, and the comment above it argued that handing an admin five
 * pickers would hand them five ways to ship a hub creators cannot read. Rashid:
 * *"I need full customization here for brands hub such that admin can decide a
 * particular area such as hero section menu items all pages in menu section
 * each with 3 to 4 colors ... some brands have multo color themes"*.
 *
 * He is right, and the old argument was protecting the wrong thing. What one
 * colour bought was READABILITY, and readability was never about how many
 * colours somebody picks. It is about which colours end up as TEXT, and an
 * admin was never picking those.
 *
 * So this screen hands out as many pickers as anybody wants, under one rule:
 *
 *   THE ADMIN PICKS FILLS. THE PRODUCT PICKS INKS.
 *
 * There is no text colour anywhere on this form and there never will be. Every
 * one of them is computed in `src/lib/brand-theme.ts` by measuring contrast
 * against every fill it will cross, including the middle stops of a four colour
 * gradient. That is why this field still has no readability error state: there
 * is no combination below that can produce one.
 *
 * THE PREVIEWS ARE THE REAL THING, not decoration. They are the actual derived
 * values in both modes, drawn with the actual gradients. Rashid tests in a
 * browser and does not read code, so a preview he can trust is worth more than
 * a paragraph promising it works.
 */
export function BrandLookField({
  value,
  theme,
  onChange,
  onThemeChange,
  disabled,
  error,
}: {
  value: string;
  theme: BrandThemeConfig | null;
  onChange: (hex: string) => void;
  onThemeChange: (theme: BrandThemeConfig | null) => void;
  disabled?: boolean;
  error?: string;
}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : DEFAULT_BRAND_COLOR;
  const derived = useMemo(() => deriveBrandTheme(hex), [hex]);
  const built = useMemo(() => deriveBrandTheme(hex, theme), [hex, theme]);

  /*
   * Belt and braces. The derivation guarantees this is empty for every input,
   * and `scripts/build/check-brand-theme.mjs` proves it over 88 base colours plus
   * 1200 random multi-colour themes inside the build. If it is ever NOT empty,
   * an admin should be the second to know rather than the last.
   */
  const problems = useMemo(() => auditBrandTheme(hex, theme), [hex, theme]);

  const setArea = (key: BrandAreaKey, area: BrandArea | undefined) => {
    const next: BrandThemeConfig = { v: 1, ...(theme ?? {}) };
    if (area) next[key] = area;
    else delete next[key];
    const empty = AREA_KEYS.every((k) => !next[k]);
    onThemeChange(empty ? null : next);
  };

  /*
   * TURNING AN AREA ON CHANGES NOTHING, on purpose. It starts from the colours
   * that area is ALREADY showing, so the first thing an admin sees after
   * clicking Customise is the hub exactly as it was, with handles on it. A
   * blank row of pickers would mean every customisation starts by destroying
   * the current look and rebuilding it from memory.
   */
  const startingStops = (key: BrandAreaKey): string[] => {
    const p = derived.light;
    if (key === 'hero') return [p.heroFrom, p.heroTo];
    if (key === 'rail') return [p.rail];
    if (key === 'page') return [p.page];
    return [p.accent];
  };

  return (
    <Field label="The brand's look" error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="grid gap-4">
          {/*
            THE EXPLANATION GOES FIRST, and it is written here rather than
            passed as `hint`. `Field` prints a hint UNDER its children, which is
            right for a text box and wrong for this: the sentence that tells an
            admin what the four blocks below are ended up orphaned beneath all
            four of them, where nobody reads it until after they have guessed.
          */}
          <p className="text-muted -mt-1 text-[0.8125rem] leading-relaxed">
            One colour builds the whole hub. Customise any part of it below, with up to four
            colours each. Every text colour is worked out from what you pick, so it stays
            readable in dark and light.
          </p>

          <div className="flex items-center gap-2.5">
            {/*
              A NATIVE COLOUR INPUT AND A TEXT BOX, both bound to the same
              value. The picker is how somebody chooses; the text box is how
              somebody pastes the hex a client sent them, which is what actually
              happens.
            */}
            <input
              type="color"
              aria-label="Pick the base brand colour"
              value={hex}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              className="wx-neo-inset h-[2.75rem] w-[3.25rem] shrink-0 cursor-pointer rounded-md p-1"
            />
            <Input
              id={id}
              name="brandColor"
              value={value}
              disabled={disabled}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              placeholder={DEFAULT_BRAND_COLOR}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Preview title="Light" p={built.light} />
            <Preview title="Dark" p={built.dark} />
          </div>

          {/* --------------------------------------------------- the areas -- */}
          <div className="grid gap-2">
            {/* `EDITABLE_AREA_KEYS`, not `AREA_KEYS`. "Menu" and "Pages and
                cards" are retired: a hub now renders inside the PRISM shell and
                supplies only an accent, a logo and a hero, so nothing reads
                those colours. Offering them would be a control that lies — you
                pick a colour, you save it, and the product ignores it. The keys
                remain in the schema so brands saved before the change still
                validate; see the note in brand-theme.ts. */}
            {EDITABLE_AREA_KEYS.map((key) => (
              <AreaEditor
                key={key}
                area={key}
                value={theme?.[key]}
                disabled={disabled}
                onChange={(next) => setArea(key, next)}
                onEnable={() => setArea(key, { stops: startingStops(key) })}
              />
            ))}
          </div>

          {problems.length ? (
            <p className="text-danger text-[0.75rem]">
              {problems.length} derived pair(s) fall short of AA. That should be impossible;
              report it rather than working around it.
            </p>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/* ------------------------------------------------------------- one area -- */

function AreaEditor({
  area,
  value,
  disabled,
  onChange,
  onEnable,
}: {
  area: BrandAreaKey;
  value: BrandArea | undefined;
  disabled?: boolean;
  onChange: (next: BrandArea | undefined) => void;
  onEnable: () => void;
}) {
  const meta = AREA_META[area];
  const [open, setOpen] = useState(false);
  const on = Boolean(value);

  /*
   * WHAT WE WILL ACTUALLY PAINT WITH, in both modes, next to what was picked.
   *
   * A colour outside the band its area can support is pulled to the band's
   * edge, keeping its hue and its saturation. Showing that rather than hiding
   * it is the difference between a tool an admin trusts and one that quietly
   * disagrees with them: pick a near-white hero and the swatch says so, on the
   * spot, instead of on a creator's screen an hour later.
   */
  const light = fitArea(area, value, 'light');
  const dark = fitArea(area, value, 'dark');
  const adjusted = light.some((s) => s.adjusted) || dark.some((s) => s.adjusted);

  const stops = value?.stops ?? [];

  const setStops = (next: string[]) => onChange({ ...(value as BrandArea), stops: next });

  return (
    <div className={cn('wx-neo-inset rounded-xl', on && 'bg-surface-2/40')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <button
          type="button"
          onClick={() => (on ? setOpen((v) => !v) : (onEnable(), setOpen(true)))}
          disabled={disabled}
          aria-expanded={on ? open : false}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronDown
            size={15}
            aria-hidden
            className={cn(
              'text-muted shrink-0 transition-transform duration-200',
              on && open && 'rotate-180'
            )}
          />
          <span className="min-w-0">
            <span className="block text-[0.875rem] font-semibold">{meta.label}</span>
            <span className="text-muted block text-[0.75rem] leading-snug">{meta.hint}</span>
          </span>
        </button>

        {/* The current colours, readable at a glance whether it is open or not. */}
        <span
          aria-hidden
          className="wx-neo-raised-sm h-7 w-16 shrink-0 rounded-md"
          style={{
            background: on
              ? stopsToCss(
                  light.map((s) => s.used),
                  90
                )
              : undefined,
          }}
        >
          {on ? null : (
            <span className="text-faint grid h-full place-items-center text-[0.625rem] font-semibold">
              Derived
            </span>
          )}
        </span>

        {on ? (
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            disabled={disabled}
            className="text-muted hover:text-danger flex shrink-0 items-center gap-1.5 text-[0.75rem] font-semibold transition-colors"
          >
            <RotateCcw size={13} aria-hidden />
            Reset
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onEnable();
              setOpen(true);
            }}
            disabled={disabled}
            className="text-accent shrink-0 text-[0.75rem] font-semibold hover:underline"
          >
            Customise
          </button>
        )}
      </div>

      {on && open ? (
        <div className="border-line grid gap-3 border-t p-3">
          <div className="flex flex-wrap items-end gap-2">
            {stops.map((stop, i) => (
              <span key={i} className="grid gap-1">
                <span className="text-muted text-[0.625rem] tracking-wider uppercase">
                  {i === 0 ? 'From' : i === stops.length - 1 ? 'To' : `Stop ${i + 1}`}
                </span>
                <span className="flex items-center gap-1">
                  <input
                    type="color"
                    aria-label={`${meta.label} colour ${i + 1}`}
                    value={stop}
                    disabled={disabled}
                    onChange={(e) =>
                      setStops(
                        stops.map((s, j) => (j === i ? e.target.value.toLowerCase() : s))
                      )
                    }
                    className="wx-neo-inset h-[2.25rem] w-[2.75rem] cursor-pointer rounded-md p-1"
                  />
                  {stops.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setStops(stops.filter((_, j) => j !== i))}
                      disabled={disabled}
                      aria-label={`Remove colour ${i + 1}`}
                      className="text-muted hover:text-danger hover:bg-surface-2 grid size-7 place-items-center rounded-full transition-colors"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  ) : null}
                </span>
              </span>
            ))}

            {stops.length < meta.max ? (
              <button
                type="button"
                /* The new colour starts as a copy of the last one, so adding a
                   stop cannot change the look until somebody moves it. */
                onClick={() =>
                  setStops([...stops, stops[stops.length - 1] ?? DEFAULT_BRAND_COLOR])
                }
                disabled={disabled}
                className="wx-neo-raised-sm wx-neo-press text-muted hover:text-accent flex h-[2.25rem] items-center gap-1.5 rounded-md px-2.5 text-[0.75rem] font-semibold transition-colors"
              >
                <Plus size={13} aria-hidden />
                Add colour
              </button>
            ) : null}
          </div>

          {meta.angle ? (
            <label className="flex flex-wrap items-center gap-3">
              <span className="text-muted text-[0.75rem] font-semibold">Direction</span>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={value?.angle ?? DEFAULT_ANGLE}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...(value as BrandArea), angle: Number(e.target.value) })
                }
                className="accent-accent h-1 min-w-[9rem] flex-1"
              />
              <span className="wx-numeric text-muted w-12 shrink-0 text-right text-[0.75rem]">
                {value?.angle ?? DEFAULT_ANGLE}&deg;
              </span>
            </label>
          ) : null}

          {meta.tone ? (
            /*
              THE ONE THING THAT IS NOT A COLOUR, and it is here because it
              changes which BAND the colours are held in rather than what any of
              them are. A brand that is cream and charcoal wants a pale hero,
              and without this every pick would be pulled down into the deep
              band and come back as a dark version of their cream.
            */
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted text-[0.75rem] font-semibold">This area is</span>
              {(
                [
                  ['auto', 'Deep, with light text'],
                  ['light', 'Pale, with dark text'],
                ] as const
              ).map(([tone, label]) => {
                const active = (value?.tone ?? 'auto') === tone;
                return (
                  <button
                    key={tone}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ ...(value as BrandArea), tone })}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[0.75rem] font-semibold transition-colors',
                      active
                        ? 'wx-neo-pressed text-accent'
                        : 'wx-neo-raised-sm text-muted hover:text-text'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {adjusted ? (
            /*
              SHORT, because it appears once per customised area and three
              paragraphs of the same reassurance stops being reassurance. The
              swatch beside each picker already shows what will actually be
              used, which is the part an admin can act on.
            */
            <p className="text-muted text-[0.75rem] leading-relaxed">
              Brightness adjusted so the writing on top stays readable. Your hue and saturation
              are untouched.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- the preview -- */

/**
 * A miniature of the hub as a creator actually sees it: a PRISM screen with
 * the brand's hero across the top and the brand's accent on the things you
 * press.
 *
 * REDRAWN 2026-10-09, and it had to be. This used to paint a brand-coloured
 * RAIL down the left, a brand-coloured page behind it and a brand-coloured
 * card — none of which exist any more, because a hub now renders inside the
 * PRISM shell and supplies only an accent, a logo and a hero.
 *
 * That made it worse than no preview at all. The header of this file says the
 * previews "are the real thing, not decoration", and the reason given is that
 * Rashid checks in a browser and does not read code — so a preview he can
 * trust is worth more than a pretty one. A preview showing a rail he will
 * never see is precisely the thing that header exists to prevent.
 *
 * So the chrome here uses OUR tokens, exactly as the real shell does, and only
 * the hero and the accent come from the brand. If a colour cannot change
 * anything on screen, it cannot change anything in here either.
 */
function Preview({ title, p }: { title: string; p: BrandPalette }) {
  return (
    <div className="wx-neo-raised overflow-hidden rounded-xl">
      <div className="bg-surface-2 text-muted px-2.5 py-1.5 text-[0.5625rem] font-bold tracking-[0.12em] uppercase">
        {title}
      </div>
      {/* The page ground is PRISM's, not the brand's. */}
      <div className="bg-bg h-[7.5rem] p-2">
        {/* The hero: the brand's own gradient, which is still real. */}
        <div
          className="flex h-[42%] items-center rounded-md px-2.5"
          style={{ background: stopsToCss(p.heroStops, p.heroAngle) }}
        >
          <span className="text-[0.625rem] font-bold" style={{ color: p.heroText }}>
            Create with&hellip;
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {/* A PRISM card, because that is what a hub's cards are now. */}
          <div className="wx-neo-raised-sm flex-1 rounded-md p-2">
            <div className="bg-faint h-1.5 w-1/2 rounded-full opacity-60" />
            {/* The one thing inside a card the brand still colours: an accent
                figure or link. */}
            <div
              className="mt-1.5 h-2.5 w-3/4 rounded"
              style={{ background: p.accentInk }}
              aria-hidden
            />
          </div>
          <span
            className="rounded-full px-2 py-1 text-[0.5625rem] font-bold"
            style={{ background: stopsToCss(p.accentStops, 135), color: p.accentText }}
          >
            Apply
          </span>
        </div>
      </div>
    </div>
  );
}
