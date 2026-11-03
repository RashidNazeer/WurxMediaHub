/* ════════════════════════════════════════════════════════════════════
   CONTENT CREATION AGREEMENT · fully-customizable document model
   ────────────────────────────────────────────────────────────────────
   v2 architecture:
     defaultContractFields(info)  → editable field set (names, counts,
                                    payment, all dates, signer)
     CONTRACT_SECTIONS            → 9 section templates; tmpl(fields)
                                    regenerates a section's body text
     renderContractPdf(fields, sections) → draws the PDF from whatever
                                    text is passed — edited or default
     generateContractPdf(info)    → one-shot default build (PDF chip)

   Body text format (what the editor edits):
     "- "  bullet · "-- " sub-bullet · blank line = spacing
     **bold** inline segments render bold in the PDF
   ════════════════════════════════════════════════════════════════════ */
import { jsPDF } from 'jspdf';
/* WURX-ADDED · the redrawn document.
   Rashid, 2026-10-02: "all i want is to update the ui of the contract it's very
   boring". The whole design lives in OUR file rather than in this one, because
   replacing a renderer inside a verbatim vendored copy turns the next upstream
   pull into diff archaeology. Their renderer below is left exactly as it was;
   `renderContractPdf` hands off to ours on its first line, so re-applying this
   work after a pull is re-adding that one line. WURX-END */
import { saveContract as wxSaveContract } from '@/routes/admin/contract-paper';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numWord(n) {
  n = Math.max(0, Math.round(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return String(n);
}

function fmtLongDate(d) {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const hasCents = Math.floor(v) !== v;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function safeFile(s) {
  return String(s || '').trim().replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '');
}

/* Handwritten-style signature rendered on an offscreen canvas */
function signaturePng(text) {
  const cv = document.createElement('canvas');
  cv.width = 360; cv.height = 110;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#141433';
  ctx.font = 'italic 58px "Segoe Script", "Brush Script MT", "Snell Roundhand", "Dancing Script", cursive';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 16, 58);
  return cv.toDataURL('image/png');
}

/* ── Editable field set from creator info ─────────────────────────── */
export function defaultContractFields(info) {
  const eff = info.hiringDate ? new Date(`${info.hiringDate}T00:00:00`) : new Date();
  let py = eff.getFullYear(), pm = eff.getMonth();
  if (eff.getDate() > 25) { pm += 1; if (pm > 11) { pm = 0; py += 1; } }
  const startDay = (py === 2026 && pm === 6) ? 3 : 2;   // July 2026 → 3rd, rest → 2nd
  return {
    brand: info.brand || '',
    creatorName: info.name || '',
    username: String(info.username || '').replace(/^@+/, ''),
    videos: Number(info.videos) || 0,
    amount: Number(info.amount) || 0,
    paymentMethod: 'PayPal',
    paymentProvider: 'EUKA',
    effectiveDate: fmtLongDate(eff),
    periodStart: fmtLongDate(new Date(py, pm, startDay)),
    periodEnd: fmtLongDate(new Date(py, pm, 25)),
    cycleClose: fmtLongDate(new Date(py, pm + 1, 0)),
    signerName: 'Aris',
    /* WURX-ADDED · Wurx is a party to this agreement and had nowhere to sign.
       It appears in the parties box on page one and as the third signature
       block. A field rather than a constant, so a brand that is handled under
       another name can be given one without touching the renderer. WURX-END */
    agency: 'Wurx Media',
  };
}

/* Phrases derived from fields · used by section templates */
function phrases(f) {
  const n = Number(f.videos) || 0;
  return {
    vidsPhrase: n > 0 ? `${numWord(n)} (${n})` : 'the agreed number of',
    vidsShort:  n > 0 ? `${numWord(n)} (${n})` : 'all agreed',
    pay: `USD $${money(f.amount)}`,
  };
}

/* ── The 9 sections · templates regenerate from current fields ────── */
export const CONTRACT_SECTIONS = [
  {
    title: '1. Purpose',
    tmpl: (f) => { const p = phrases(f); return (
`The Creator agrees to create and publish **${p.vidsPhrase}** original TikTok videos featuring the Brand's products on the Creator's official TikTok account in accordance with the terms of this Agreement.`); },
  },
  {
    title: '2. Deliverables',
    tmpl: (f) => { const p = phrases(f); return (
`The Creator agrees to:
- Create and publish a total of **${p.vidsPhrase}** original TikTok videos featuring the Brand's products.
- Keep all published videos publicly available on the Creator's TikTok account.
- Complete and publish all **${p.vidsShort}** videos during the collaboration period, which runs from **${f.periodStart}, through ${f.periodEnd}**.
- Follow the creative brief provided by the Brand, including all required messaging, content angles, hooks, formats, and creative guidelines.
- Publish the campaign videos gradually. Campaign videos **must not be uploaded all at once**. A minimum interval of **8 to 12 hours** must be maintained between each video unless otherwise approved by the Brand.
- Upon completion of all deliverables, provide the Brand with:
-- Links to all **${p.vidsShort}** published TikTok videos.
-- Valid TikTok Spark Ad Codes (Ad Authorization Codes) for each published video.`); },
  },
  {
    title: '3. Creator Requirements',
    tmpl: () => (
`The Creator agrees to:
- Join the Brand's designated Discord server before the campaign begins and remain an active member throughout the collaboration.
- Attend at least one onboarding or strategy call with the Brand's Creative Strategist before creating content.
- Follow the creative brief and implement the required messaging, angles, hooks, and video format provided by the Brand.
- Communicate promptly regarding revisions, feedback, or campaign updates.
- Ensure all content is original and complies with TikTok's Community Guidelines.`),
  },
  {
    title: '4. Compensation',
    tmpl: (f) => { const p = phrases(f); return (
`Upon successful completion of all deliverables outlined in this Agreement, the Brand agrees to pay the Creator:

**Payment Amount:** **${p.pay}**
**Payment Method:** ${f.paymentMethod}
**Payment Provider:** ${f.paymentProvider}

The collaboration period ends on **${f.periodEnd}**.
The Brand's payment cycle closes on **${f.cycleClose}**.
Payment will be issued under **Net 7** payment terms, meaning payment will be sent within seven (7) calendar days after **${f.cycleClose}**, provided that:
- All **${p.vidsShort}** TikTok videos have been published.
- The Brand has received and verified all video links.
- Valid TikTok Spark Ad Codes have been submitted for all videos.
- All campaign requirements outlined in this Agreement have been fulfilled.`); },
  },
  {
    title: '5. Creator Responsibilities',
    tmpl: () => (
`The Creator confirms that:
- All content created will be original.
- All videos will be published on the Creator's official TikTok account.
- The submitted video links and Spark Ad Codes will remain valid and functional.
- The Creator will comply with the Brand's creative brief and campaign requirements.
- The Creator will maintain professional communication throughout the collaboration.`),
  },
  {
    title: '6. Brand Responsibilities',
    tmpl: (f) => { const p = phrases(f); return (
`The Brand agrees to:
- Provide the Creator with a complete creative brief before content production begins.
- Schedule the onboarding or strategy call with the Creative Strategist.
- Review submitted deliverables in a timely manner.
- Issue payment of **${p.pay}** via **${f.paymentMethod} through ${f.paymentProvider}** in accordance with the payment terms outlined in this Agreement.`); },
  },
  {
    title: '7. Ownership',
    tmpl: () => (
`The Creator retains ownership of the original content.

By providing TikTok Spark Ad Codes, the Creator grants the Brand permission to promote the published content through TikTok Spark Ads for the agreed campaign period.

With the Creator's consent, the Brand and Wurx Media may use the published videos on other platforms, including **Meta (Facebook and Instagram)**, for the Brand's advertising and marketing purposes.

Any additional usage rights beyond those described above must be agreed upon separately in writing.`),
  },
  {
    title: '8. Termination',
    tmpl: () => (
`Either party may terminate this Agreement only through written mutual consent.

If the Creator fails to:
- Publish all required deliverables.
- Join the designated Discord server.
- Attend the required onboarding or strategy call.
- Follow the approved creative brief.
- Maintain the required posting schedule.
- Provide valid Spark Ad Codes.

The Brand reserves the right to withhold payment until all obligations have been fulfilled or to cancel payment if the agreed deliverables remain incomplete.`),
  },
  {
    title: '9. Entire Agreement',
    tmpl: () => (
`This Agreement constitutes the complete understanding between both parties and supersedes all prior discussions, negotiations, emails, messages, or communications relating to this collaboration.`),
  },
];

/* ── PDF renderer · draws fields + section texts (edited or default) ── */
export function renderContractPdf(fields, sections) {
  /* WURX-ADDED · everything below this line is their original renderer and is
     no longer reached. See the import at the top of this file. WURX-END */
  return wxSaveContract(fields, sections);
  // eslint-disable-next-line no-unreachable
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 64;
  const BODY = 10.5, LH = 15;
  let y = M;

  const ensure = (need) => { if (y + need > H - M) { doc.addPage(); y = M; } };
  const rule = () => { ensure(30); y += 6; doc.setDrawColor(190); doc.setLineWidth(0.75); doc.line(M, y, W - M, y); y += 24; };
  const heading = (t) => { ensure(48); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20); doc.text(t, M, y); y += 24; };
  const kv = (label, value, { gap = 7, valueBold = false } = {}) => {
    ensure(LH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(BODY); doc.setTextColor(20);
    doc.text(label, M, y);
    const lw = doc.getTextWidth(label + ' ');
    doc.setFont('helvetica', valueBold ? 'bold' : 'normal'); doc.setTextColor(valueBold ? 20 : 35);
    doc.text(String(value), M + lw + 2, y);
    y += LH + gap;
    return lw;
  };
  /* inline **bold** → segments */
  const segsOf = (text) => {
    const out = [];
    String(text).split('**').forEach((part, i) => {
      if (part) out.push({ t: part, b: i % 2 === 1 });
    });
    return out.length ? out : [{ t: '', b: false }];
  };
  const rich = (segments, { indent = 0, bulletChar = null, gap = 8 } = {}) => {
    const words = [];
    segments.forEach(s => String(s.t).split(/\s+/).filter(Boolean).forEach(w => words.push({ w, b: !!s.b })));
    if (!words.length) { y += gap; return; }
    doc.setFontSize(BODY);
    let x = M + indent;
    const maxX = W - M;
    ensure(LH);
    if (bulletChar) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(35);
      doc.text(bulletChar, M + indent - 13, y);
    }
    words.forEach(({ w, b }) => {
      doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setTextColor(b ? 20 : 35);
      const ww = doc.getTextWidth(w + ' ');
      if (x + ww > maxX) { y += LH; ensure(LH); x = M + indent; }
      doc.text(w, x, y);
      x += ww;
    });
    y += LH + (bulletChar ? -11 + gap : gap);
  };
  /* body text → lines: "- " bullet · "-- " sub-bullet · blank = spacing */
  const renderBody = (body) => {
    String(body || '').split('\n').forEach(raw => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { y += 5; return; }
      if (line.startsWith('-- ')) rich(segsOf(line.slice(3)), { indent: 40, bulletChar: 'o', gap: 15 });
      else if (line.startsWith('- ')) rich(segsOf(line.slice(2)), { indent: 20, bulletChar: '•', gap: 15 });
      else rich(segsOf(line), { gap: 6 });
    });
    y += 3;
  };

  /* ═══ TITLE + parties ═══ */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(21); doc.setTextColor(10);
  doc.text('CONTENT CREATION AGREEMENT', W / 2, y + 8, { align: 'center' });
  y += 44;
  rich(segsOf('This Content Creation Agreement ("Agreement") is entered into between:'), { gap: 10 });
  kv('Brand:', fields.brand);
  kv('Creator:', fields.creatorName);
  kv('Effective Date:', fields.effectiveDate, { gap: 4 });
  rule();

  /* ═══ sections ═══ */
  (sections || []).forEach(s => {
    heading(s.title);
    renderBody(s.body);
    rule();
  });

  /* ═══ signatures ═══ */
  ensure(170);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(10);
  doc.text('Brand Representative', M, y); y += 24;
  kv('Brand:', fields.brand);
  {
    ensure(46);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(BODY); doc.setTextColor(20);
    doc.text('Signature:', M, y);
    const lw = doc.getTextWidth('Signature: ');
    doc.setFont('helvetica', 'normal'); doc.setTextColor(35);
    doc.text('___________________________', M + lw + 2, y);
    const signer = String(fields.signerName || '').trim();
    if (signer) {
      try { doc.addImage(signaturePng(signer), 'PNG', M + lw + 34, y - 26, 92, 28); }
      catch (_) { /* canvas unavailable → line stays blank */ }
    }
    y += LH + 7;
  }
  kv('Date:', fields.effectiveDate, { gap: 6 });
  rule();

  ensure(170);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(10);
  doc.text('Creator', M, y); y += 24;
  kv('TikTok Username:', fields.username || '—');
  kv('Name:', fields.creatorName);
  kv('Signature:', '___________________________');
  kv('Date:', '___________________________');

  doc.save(`${safeFile(fields.creatorName)}_x_${safeFile(fields.brand)}.pdf`);
}

/* ── One-shot default build · used by the quick PDF chip ── */
export function generateContractPdf(info) {
  const fields = defaultContractFields(info);
  const sections = CONTRACT_SECTIONS.map(d => ({ title: d.title, body: d.tmpl(fields) }));
  renderContractPdf(fields, sections);
}
