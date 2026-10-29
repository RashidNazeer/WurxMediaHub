/**
 * One product band inside an angle: a disclosure for its videos, and what they
 * did.
 *
 * The arrangement that decides which bands exist and what is in them lives in
 * `collab-angle-products.ts`, which has no React in it so Node can test it
 * directly. This file is only the band itself.
 */

import { useState } from 'react';

import type { ProductHead } from './collab-angle-products';
import { wxCompact } from './collab-angle-products';

interface ProductHeadProps {
  head: ProductHead;
  shut: boolean;
  onToggle: () => void;
  /** The card's own money formatter, so one brand's currency reads the same everywhere. */
  fmt: (n: number) => string;
  /** The product's picture, when the catalogue has one. */
  pic?: string | null;
}

/**
 * THE WHOLE BAND IS THE HIT TARGET, not the chevron somebody has to aim at,
 * which is how the group rows on the Brands screen already behave. That is the
 * only decision here that is about hit targets rather than layout.
 *
 * THE PICTURE IS NEVER A BROKEN ICON. The catalogue may not have one, may not
 * be reachable, and a URL that worked yesterday can 404 today; all three land
 * on the same neutral tile rather than the browser's torn-image glyph. An
 * `onError` that blanks `src` would re-fire forever, so it sets state once.
 */
export function WxAngleProductHead({ head, shut, onToggle, fmt, pic }: ProductHeadProps) {
  const [broken, setBroken] = useState(false);
  const showPic = !!pic && !broken && !head.unknown;
  return (
    <div className={'wx-pg' + (shut ? ' shut' : '') + (head.unknown ? ' none' : '')}>
      <button
        type="button"
        className="wx-pg-b"
        onClick={onToggle}
        aria-expanded={!shut}
        title={shut ? 'Show these videos' : 'Hide these videos'}
      >
        <span className="wx-pg-chev" aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
        {showPic ? (
          <img className="wx-pg-pic" src={pic as string} alt="" loading="lazy"
            onError={() => setBroken(true)} />
        ) : (
          <span className="wx-pg-pic wx-pg-pic-none" aria-hidden="true" />
        )}
        <b title={head.name}>{head.name}</b>
        <span className="wx-pg-n">
          {head.count} video{head.count === 1 ? '' : 's'}
        </span>
      </button>
      <span className="wx-pg-f">
        <i>{wxCompact(head.views)} views</i>
        <i className="g">{fmt(head.gmv)}</i>
        {head.ad > 0 ? <i className="a">{fmt(head.ad)}</i> : null}
      </span>
    </div>
  );
}
