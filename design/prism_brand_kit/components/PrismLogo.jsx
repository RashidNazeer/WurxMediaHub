// PRISM wordmark + icon as live HTML (crisp at any size, uses the Caprasimo web font).
// Size it with font-size on the parent. Pass ink="#FFFFFF" on dark grounds.
export function PrismI({ ink = '#14141C' }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-block', margin: '0 0.03em', verticalAlign: 'baseline' }}>
      <svg viewBox="0 0 24 22" style={{ width: '0.28em', height: '0.25em', display: 'block', overflow: 'visible', margin: '0 auto 0.05em' }}>
        <path d="M12 3 L21 19 L3 19 Z" fill="none" stroke={ink} strokeWidth="3.6" strokeLinejoin="round" />
      </svg>
      <span style={{ display: 'block', width: '0.15em', height: '0.52em', margin: '0 auto', borderRadius: 999,
        background: 'linear-gradient(#17E0D4 0 25%, #2E8BFF 25% 50%, #9B5CFF 50% 75%, #FF2E8C 75%)' }} />
    </span>
  );
}

export function PrismWordmark({ ink = '#14141C', size = 48 }) {
  return (
    <span role="img" aria-label="Prism" style={{ fontFamily: "'Caprasimo', serif", fontWeight: 400, fontSize: size,
      letterSpacing: '-0.015em', lineHeight: 1, color: ink, whiteSpace: 'nowrap' }}>
      pr<PrismI ink={ink} />sm
    </span>
  );
}

// Standalone icon: the i on its own. size = em size; rendered height ≈ 0.82 × size.
export function PrismIcon({ ink = '#14141C', size = 64 }) {
  return <span role="img" aria-label="Prism" style={{ fontSize: size, lineHeight: 0, display: 'inline-block' }}><PrismI ink={ink} /></span>;
}
