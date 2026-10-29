import { CreatorFace } from '@/components/work/CreatorFace';
import { cn } from '@/lib/utils';

interface StackedCreator {
  id: string;
  name: string | null;
  handle: string | null;
}

/**
 * A group of creators, drawn as overlapping faces with the rest as a count.
 *
 * Rashid, 2026-08-21, about the offers screen: *"we can show avatras with dps
 * not all but atleast 3 if they have manu show at max 3, we can add 3 avatars
 * and then + sign"*.
 *
 * ONE COMPONENT, for the same reason `CreatorFace` is one: a set of people has
 * to look identical on the offers grid and anywhere else it turns up, or the
 * product stops reading as one product.
 *
 * THE OVERFLOW COUNT COMES FROM `total`, NOT FROM `faces.length`. The hook
 * feeding this caps how many people it carries, because a card shows three and
 * an offer with two hundred creators should not put two hundred names into the
 * query cache. So the faces say WHO and `total` says HOW MANY, and the two are
 * allowed to disagree — that disagreement is the +N.
 *
 * THE RING IS THE SURFACE COLOUR, not a border. Overlapping discs have to be cut
 * out of each other or they read as one smudge, and a ring painted in whatever
 * the card is standing on does that at any size without a wrapper per face.
 */
export function CreatorStack({
  faces,
  total,
  avatars,
  max = 3,
  size = 28,
  className,
}: {
  faces: StackedCreator[];
  /** How many people there really are. Defaults to how many faces arrived. */
  total?: number;
  /** Signed avatar URLs by profile id, from `useCreatorAvatars`. */
  avatars?: Record<string, string>;
  max?: number;
  size?: number;
  className?: string;
}) {
  const shown = faces.slice(0, max);
  const more = Math.max(0, (total ?? faces.length) - shown.length);

  if (shown.length === 0 && more === 0) return null;

  return (
    /*
     * `-space-x-2` at 28px is a third of a face. Less and they stop reading as a
     * group; more and the one underneath is a sliver that looks like a bug.
     * The overlap scales with the size on purpose, via the style below.
     */
    <span className={cn('flex shrink-0 items-center', className)}>
      {shown.map((c, i) => (
        <CreatorFace
          key={c.id}
          src={avatars?.[c.id]}
          name={c.name}
          handle={c.handle}
          size={size}
          className="ring-surface-1 ring-2"
          // Later faces sit on top of earlier ones, so the stack reads
          // left to right the way a sentence does.
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.32), zIndex: i }}
        />
      ))}

      {more > 0 ? (
        <span
          aria-hidden
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.36),
            marginLeft: shown.length === 0 ? 0 : -Math.round(size * 0.32),
            zIndex: shown.length,
          }}
          className="bg-surface-3 text-muted ring-surface-1 grid shrink-0 place-items-center rounded-full font-mono font-semibold ring-2"
        >
          +{more}
        </span>
      ) : null}
    </span>
  );
}
