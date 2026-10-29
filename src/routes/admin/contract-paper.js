/*
 * THE CREATOR CONTRACT, AS A PIECE OF PAPER.
 * ---------------------------------------------------------------------------
 * Rashid, 2026-10-02, with a mockup: "we have contract generation system where
 * when we add creators contract is automatically generated ... all i want is to
 * update the ui of the contract it's very boring and also add some extra stuff
 * in it ... i want exactly that UI".
 *
 * THIS IS A REDRAW, NOT A REWRITE. Every word of the agreement still comes from
 * `CONTRACT_SECTIONS` and from whatever the editor has changed, and the page
 * flow is the same multi-page portrait PDF it always was. Rashid asked for that
 * explicitly: "the second page should be vertical below the first one like we
 * currently have" â€” his mockup shows two pages SIDE BY SIDE because it is a
 * design preview, and he was making sure the real document does not become
 * that. So: letter portrait, pages one after another, same as today.
 *
 * â”€â”€ WHAT CHANGED, AND WHY EACH THING IS THERE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Â· Cream paper with a black spine and a gold rule down the left. The document
 *   should be recognisable as Wurx from across a desk, before a word is read.
 * Â· The wordmark stamped in a black block, top left of every page. It is cream
 *   on transparent, so it needs a dark block to sit on â€” on the cream paper it
 *   would be invisible.
 * Â· A ghost of the mascot, top right, drawn in a cream two shades off the page.
 *   Vector circles rather than the logo at low opacity: it stays crisp at any
 *   zoom, costs nothing, and cannot turn into a grey smudge when a printer
 *   flattens transparency.
 * Â· Numbered sections â€” a gold numeral, a rule, the heading â€” so a nine-section
 *   agreement can be navigated by eye and referred to by number on a call.
 * Â· A footer on every page with the address and "03 / 05", because a printed
 *   contract that loses a page should say so.
 * Â· The signatures moved to their own page, as three bordered blocks, and there
 *   are now THREE: Brand, Creator and Agency. The agency block is the "extra
 *   stuff" â€” Wurx is a party to this agreement and had nowhere to sign.
 *
 * â”€â”€ THE PALETTE IS THE BRAND'S, NOT A NEW ONE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Near-black, gold and cream are the three colours in `src/styles/tokens.css`,
 * written here as RGB because a PDF has no CSS and no tokens. They are the only
 * literal colours in this file and they live in one block at the top; if the
 * brand palette ever moves, this is the one place to follow it.
 *
 * â”€â”€ WHY IT LIVES HERE AND NOT IN THE VENDORED FILE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * `src/vendor/wurxbase/contractPdf.js` is a verbatim copy of WurxBase's own
 * code. Replacing a whole renderer inside it would make the next upstream pull
 * an exercise in diff archaeology, which is exactly what the verbatim rule
 * exists to prevent. Their file now delegates to this one from a single fenced
 * line, so re-applying our work after a pull is re-adding that line.
 */
import { jsPDF } from 'jspdf';
/*
 * THE CONTRACT CARRIES THE WURX MARK, NOT PRISM'S.
 *
 * Rashid, 2026-10-14: "when a creator signs in a contract is sent to the
 * creator and it must have the wurx logo not the prism logo revert the
 * contract to original."
 *
 * The rebrand swapped this to the PRISM wordmark along with the rest of the
 * shell, and that was wrong for this one document. PRISM is the name of the
 * PLATFORM creators log into; the contract is an agreement with Wurx Media,
 * the company — `fields.agency` has said "Wurx Media" throughout, and the
 * footer has always read wurxmedia.com. A creator signing it is contracting
 * with Wurx, so Wurx is whose mark belongs at the top of it.
 *
 * `wurx-mark.js` is restored verbatim from 153f374, the commit before the
 * rebrand, rather than re-rasterised, so the logo is byte-for-byte the one
 * that was on every contract signed until now.
 */
import { WURX_MARK_PNG, WURX_MARK_W, WURX_MARK_H } from './wurx-mark.js';

/* â”€â”€ the brand's three colours, from src/styles/tokens.css â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const INK = [16, 14, 12]; /* near-black #100e0c â€” body and headings    */
const INK_SOFT = [74, 66, 56]; /* body text, a touch lighter than headings  */
const GOLD = [162, 112, 40]; /* #a27028 â€” the print-safe end of our gold  */
const GOLD_SOFT = [206, 176, 122]; /* hairlines, where full gold would shout  */
const PAPER = [246, 241, 230]; /* cream #f6f1e6 â€” the page itself           */
const PAPER_2 = [240, 233, 218]; /* one step down: the signature card fills    */
const GHOST = [241, 235, 223]; /* barely off the paper: the mascot watermark */
const BLACK = [13, 12, 11]; /* the spine and the logo block              */

/* â”€â”€ the page, in points (letter portrait, as before) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const PAGE_W = 612,
  PAGE_H = 792;
const SPINE_W = 13; /* the black bar down the left edge         */
const ML = 56; /* content left: clear of spine and rule    */
const MR = 44; /* content right                            */
const MT = 42;
const FOOT_H = 48; /* room kept for the footer on every page   */
const CW = PAGE_W - ML - MR; /* content width                            */

const BODY = 9.6,
  LH = 13.4;

/**
 * SPLIT A RUN OF **bold**-marked SEGMENTS INTO WORDS, KEEPING THE REAL SPACES.
 *
 * Exported only so it can be tested, because this is where the old renderer
 * went wrong and the failure is invisible to anything that just asks "did a PDF
 * come out". It split every segment on whitespace and re-joined with one space,
 * which is fine until a bold run ends mid-sentence: `**September 30, 2026**.`
 * became the tokens "2026" and "." with a space invented between them, and the
 * contract read "September 30, 2026 ." â€” three times on the payment page alone.
 *
 * Splitting on a CAPTURING whitespace pattern keeps the gaps that were really
 * there; `sp` says whether a space preceded each token, so the renderer adds
 * one only where the author did.
 */
export function tokenise(segments) {
  const tokens = [];
  let pendingSpace = false;
  (segments || []).forEach((s) => {
    String(s.t)
      .split(/(\s+)/)
      .forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          pendingSpace = true;
          return;
        }
        tokens.push({ w: part, b: !!s.b, sp: pendingSpace });
        pendingSpace = false;
      });
  });
  if (tokens.length) tokens[0].sp = false;
  return tokens;
}

/** `**bold**` markers, as the editor writes them, into segments. */
export function segmentsOf(text) {
  const out = [];
  String(text)
    .split('**')
    .forEach((part, i) => {
      if (part) out.push({ t: part, b: i % 2 === 1 });
    });
  return out.length ? out : [{ t: '', b: false }];
}

/* â”€â”€ small helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const setFill = (d, c) => d.setFillColor(c[0], c[1], c[2]);
const setDraw = (d, c) => d.setDrawColor(c[0], c[1], c[2]);
const setText = (d, c) => d.setTextColor(c[0], c[1], c[2]);

/** Letter-spaced capitals, which jsPDF has no setting for. */
function tracked(d, text, x, y, space) {
  let cx = x;
  for (const ch of String(text)) {
    d.text(ch, cx, y);
    cx += d.getTextWidth(ch) + space;
  }
  return cx - x - space;
}

/**
 * THE CHROME, STAMPED ON EVERY PAGE.
 *
 * Drawn FIRST on each page, because the cream fill covers the whole sheet and
 * anything drawn before it would disappear underneath.
 */
function chrome(d, { ghost = false } = {}) {
  setFill(d, PAPER);
  d.rect(0, 0, PAGE_W, PAGE_H, 'F');

  /* The spine: a black bar hard against the edge, with a gold rule just
     inside it. Two marks rather than one â€” the bar alone reads as a printing
     error, the bar plus the rule reads as a cover. */
  setFill(d, BLACK);
  d.rect(0, 0, SPINE_W, PAGE_H, 'F');
  setDraw(d, GOLD);
  d.setLineWidth(1.1);
  d.line(SPINE_W + 7, 0, SPINE_W + 7, PAGE_H);

  if (ghost) ghostMark(d);
}

/**
 * THE MASCOT, AS A WATERMARK. Circles, not the logo at low opacity: it stays
 * crisp at any zoom and cannot flatten into a grey smudge on a printer that
 * does not do transparency. One step off the paper colour, so it reads as a
 * texture rather than as something somebody forgot to delete.
 */
function ghostMark(d) {
  /* Mostly off the right edge, so it reads as a watermark the page is sitting
     on rather than as a drawing somebody placed there. */
  const cx = PAGE_W - 58,
    cy = 104,
    r = 62;
  setFill(d, GHOST);
  d.circle(cx - 39, cy - 43, 22, 'F'); /* ears */
  d.circle(cx + 39, cy - 43, 22, 'F');
  d.circle(cx, cy, r, 'F'); /* face */
  setFill(d, PAPER);
  d.circle(cx, cy + 17, 29, 'F'); /* muzzle, cut back out of the face */
  setFill(d, GHOST);
  d.circle(cx, cy + 17, 10, 'F');
}

/** The wordmark in its black block, top-left. */
function markBlock(d, y) {
  const h = 42,
    pad = 9;
  const w = h * (WURX_MARK_W / WURX_MARK_H) * 0.78 + pad * 2;
  setFill(d, BLACK);
  d.roundedRect(ML, y, w, h, 3, 3, 'F');
  const iw = w - pad * 2,
    ih = iw * (WURX_MARK_H / WURX_MARK_W);
  try {
    d.addImage(WURX_MARK_PNG, 'PNG', ML + pad, y + (h - ih) / 2, iw, ih);
  } catch {
    /* No image support is not a reason to produce a contract with a hole in
       the header: fall back to the name, set the way the mark sets it. */
    setText(d, PAPER);
    d.setFont('helvetica', 'bold');
    d.setFontSize(17);
    d.text('WURX', ML + pad, y + h / 2 + 5);
  }
  /* The hairline that carries the eye from the mark to the right edge. */
  setDraw(d, GOLD_SOFT);
  d.setLineWidth(0.9);
  d.line(ML + w + 14, y + h / 2, PAGE_W - MR, y + h / 2);
  return y + h;
}

/** The eyebrow, the title and the short gold underline beneath it. */
function titleBlock(d, eyebrow, title, y, { size = 31 } = {}) {
  setText(d, GOLD);
  d.setFont('helvetica', 'bold');
  d.setFontSize(8.2);
  tracked(d, eyebrow.toUpperCase(), ML, y, 3.1);
  /* THE GAP IS MEASURED FROM THE TITLE, NOT GUESSED. jsPDF places text on its
     BASELINE, so a 36pt title reaches about 28pt above the point it is drawn
     at â€” a fixed gap that looked right at 31pt had the capitals of "Signatures"
     sitting on top of the eyebrow at 36. */
  y += size * 0.78 + 11;

  setText(d, INK);
  d.setFont('helvetica', 'normal');
  d.setFontSize(size);
  d.text(title, ML, y);
  y += 14;

  setDraw(d, GOLD);
  d.setLineWidth(2.6);
  d.line(ML, y, ML + 46, y);
  return y + 20;
}

/** The footer: a hairline, the address, and the page number. Stamped in a
 *  second pass, once the document knows how many pages it has. */
function footer(d, page, total) {
  const y = PAGE_H - 34;
  setDraw(d, GOLD_SOFT);
  d.setLineWidth(0.8);
  d.line(ML, y - 12, PAGE_W - MR, y - 12);
  d.setFont('helvetica', 'normal');
  d.setFontSize(7.6);
  setText(d, GOLD);
  d.text('wurxmedia.com', ML, y);
  const label = `${String(page).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  setText(d, INK_SOFT);
  d.text(label, PAGE_W - MR - d.getTextWidth(label), y);
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   THE DOCUMENT
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function drawContract(fields, sections) {
  const d = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = 0;

  const newPage = ({ ghost = false } = {}) => {
    d.addPage();
    chrome(d, { ghost });
    y = MT + 16;
  };
  /* Room on the page, or turn over. Every block asks before it draws, so a
     heading can never be orphaned at the foot of a page from its body. */
  const ensure = (need) => {
    if (y + need > PAGE_H - FOOT_H) {
      newPage();
      return true;
    }
    return false;
  };

  const segsOf = segmentsOf;

  /**
   * A paragraph, wrapped, with bold runs kept bold.
   *
   * `x0` is where the text starts and `width` how much room it has, so a
   * section body can sit indented under its heading while a bullet sits
   * further in again â€” all of it measured from one place rather than from a
   * margin plus a guess.
   */
  const para = (
    segments,
    { x0 = ML, width = CW, gap = 7, bullet = null, ink = INK_SOFT } = {}
  ) => {
    const tokens = tokenise(segments);
    if (!tokens.length) {
      y += gap;
      return;
    }
    d.setFontSize(BODY);
    ensure(LH * 2);
    if (bullet) {
      setFill(d, GOLD);
      d.circle(x0 - 9, y - 3, 1.7, 'F');
    }
    let x = x0;
    const maxX = x0 + width;
    tokens.forEach(({ w, b, sp }) => {
      d.setFont('helvetica', b ? 'bold' : 'normal');
      setText(d, b ? INK : ink);
      const sw = sp ? d.getTextWidth(' ') : 0;
      const ww = d.getTextWidth(w);
      if (x + sw + ww > maxX) {
        y += LH;
        ensure(LH); /* a turn resets y to the top of the next page */
        x = x0; /* and the space that would have led is dropped */
      } else {
        x += sw;
      }
      d.text(w, x, y);
      x += ww;
    });
    y += LH + gap;
  };

  /** A section body: "- " bullet, "-- " sub-bullet, blank line = air. */
  const body = (text, x0, width) => {
    String(text || '')
      .split('\n')
      .forEach((raw) => {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim()) {
          y += 4;
          return;
        }
        if (line.startsWith('-- '))
          para(segsOf(line.slice(3)), {
            x0: x0 + 30,
            width: width - 30,
            gap: 1.5,
            bullet: true,
          });
        else if (line.startsWith('- '))
          para(segsOf(line.slice(2)), {
            x0: x0 + 14,
            width: width - 14,
            gap: 1.5,
            bullet: true,
          });
        else para(segsOf(line), { x0, width, gap: 5 });
      });
  };

  /* â•â•â• PAGE ONE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
  chrome(d, { ghost: true });
  y = MT;
  y = markBlock(d, y) + 30;
  y = titleBlock(d, 'Content', 'CREATION AGREEMENT', y);

  para(segsOf('This Content Creation Agreement ("Agreement") is entered into between:'), {
    gap: 12,
  });

  /* â”€â”€ THE PARTIES, IN A BOX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     Four facts that get looked up rather than read â€” who, with whom, for
     whom, from when. A box lets the eye find them without reading the
     agreement, which is what people actually do with the first page. */
  {
    const rowH = 38,
      colW = CW / 2;
    const cells = [
      ['Brand', fields.brand || 'â€”'],
      ['Creator', fields.creatorName || 'â€”'],
      ['Agency', fields.agency || 'Wurx Media'],
      ['Effective Date', fields.effectiveDate || 'â€”'],
    ];
    ensure(rowH * 2 + 16);
    const top = y;
    setDraw(d, GOLD_SOFT);
    d.setLineWidth(0.9);
    d.rect(ML, top, CW, rowH * 2);
    d.line(ML, top + rowH, ML + CW, top + rowH);
    d.line(ML + colW, top, ML + colW, top + rowH * 2);
    cells.forEach(([label, value], i) => {
      const cx = ML + (i % 2) * colW + 12;
      const cy = top + Math.floor(i / 2) * rowH;
      setText(d, GOLD);
      d.setFont('helvetica', 'bold');
      d.setFontSize(6.8);
      tracked(d, `${label.toUpperCase()}:`, cx, cy + 14, 1.5);
      setText(d, INK);
      d.setFont('helvetica', 'normal');
      d.setFontSize(11.5);
      /* A long brand or creator name must not run into the next column. */
      const room = colW - 24;
      let v = String(value);
      while (d.getTextWidth(v) > room && v.length > 4) v = v.slice(0, -2);
      if (v !== String(value)) v = `${v}â€¦`;
      d.text(v, cx, cy + 30);
    });
    y = top + rowH * 2 + 26;
  }

  /* â•â•â• THE SECTIONS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     A gold numeral, a rule, the heading â€” and the body indented to sit
     under the heading rather than under the numeral, so the numbers form
     their own column down the page. */
  const NUM_W = 44;
  (sections || []).forEach((s, i) => {
    const title = String(s.title || '').replace(/^\s*\d+\.\s*/, '');
    ensure(78);
    const top = y;

    setText(d, GOLD);
    d.setFont('helvetica', 'bold');
    d.setFontSize(19);
    d.text(String(i + 1).padStart(2, '0'), ML, top + 2);

    setDraw(d, GOLD);
    d.setLineWidth(1.6);
    d.line(ML + NUM_W - 14, top - 11, ML + NUM_W - 14, top + 5);

    setText(d, INK);
    d.setFont('helvetica', 'bold');
    d.setFontSize(12.5);
    d.text(title, ML + NUM_W, top);

    y = top + 17;
    body(s.body, ML + NUM_W, CW - NUM_W);

    /* A hairline between sections, never under the last one on a page. */
    y += 6;
    if (i < (sections || []).length - 1 && y < PAGE_H - FOOT_H - 30) {
      setDraw(d, GOLD_SOFT);
      d.setLineWidth(0.7);
      d.line(ML, y, PAGE_W - MR, y);
      y += 20;
    }
  });

  /* â•â•â• THE SIGNATURES, ON THEIR OWN PAGE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     On its own page deliberately: this is the page that gets printed,
     signed and photographed, and a signature block split across a page
     break is the one thing that makes a contract look amateur. */
  newPage({ ghost: true });
  y = MT;
  y = markBlock(d, y) + 30;
  y = titleBlock(d, 'Content Creation Agreement', 'Signatures', y, { size: 36 });
  y += 6;

  /**
   * One signing block. `rows` are [label, value] â€” a value of null draws the
   * ruled line to sign on, anything else is printed as a fact.
   */
  const signBlock = (n, heading, rows, { signature = '' } = {}) => {
    const padY = 16,
      rowH = 24;
    const h = padY * 2 + 24 + rows.length * rowH;
    ensure(h + 18);
    const top = y;

    setFill(d, PAPER_2);
    setDraw(d, GOLD_SOFT);
    d.setLineWidth(0.9);
    d.roundedRect(ML, top, CW, h, 5, 5, 'FD');

    setText(d, GOLD);
    d.setFont('helvetica', 'bold');
    d.setFontSize(19);
    d.text(String(n).padStart(2, '0'), ML + 18, top + padY + 15);

    setDraw(d, GOLD);
    d.setLineWidth(1.6);
    d.line(ML + 58, top + padY + 2, ML + 58, top + padY + 18);

    setText(d, INK);
    d.setFont('helvetica', 'bold');
    d.setFontSize(13);
    d.text(heading, ML + 74, top + padY + 15);

    let ry = top + padY + 44;
    const labelX = ML + 74,
      valueX = ML + 180;
    rows.forEach(([label, value]) => {
      setText(d, GOLD);
      d.setFont('helvetica', 'normal');
      d.setFontSize(8.6);
      d.text(`${label}:`, labelX, ry);
      if (value === null) {
        setDraw(d, INK_SOFT);
        d.setLineWidth(0.6);
        d.line(valueX, ry + 2, PAGE_W - MR - 20, ry + 2);
        /* The one signature we hold is drawn ON the line, as a person would
           sign it â€” above the rule, not instead of it. */
        if (signature && label.toLowerCase() === 'signature') {
          try {
            d.addImage(signature, 'PNG', valueX + 10, ry - 22, 88, 26);
          } catch {
            /* no canvas */
          }
        }
      } else {
        setText(d, INK);
        d.setFont('helvetica', 'normal');
        d.setFontSize(10);
        d.text(String(value), valueX, ry);
      }
      ry += rowH;
    });
    y = top + h + 18;
  };

  const signer = String(fields.signerName || '').trim();
  signBlock(
    1,
    'Brand Representative',
    [
      ['Brand', fields.brand || 'â€”'],
      ['Name', signer || null],
      ['Signature', null],
      ['Date', fields.effectiveDate || 'â€”'],
    ],
    { signature: signer ? signaturePng(signer) : '' }
  );

  signBlock(2, 'Creator', [
    [
      'TikTok Username',
      fields.username ? `@${String(fields.username).replace(/^@+/, '')}` : 'â€”',
    ],
    ['Name', fields.creatorName || null],
    ['Signature', null],
    ['Date', null],
  ]);

  signBlock(3, 'Agency Representative', [
    ['Agency', fields.agency || 'Wurx Media'],
    ['Name', null],
    ['Signature', null],
    ['Date', null],
  ]);

  /* â•â•â• FOOTERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     Last, because "01 / 04" cannot be written until the document knows how
     many pages it turned out to be. */
  const total = d.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    d.setPage(p);
    footer(d, p, total);
  }

  return d;
}

/** A handwritten-looking signature, drawn on an offscreen canvas. Unchanged in
 *  behaviour from the original renderer â€” Rashid is deciding separately how the
 *  real signatures should arrive. */
function signaturePng(text) {
  try {
    const cv = document.createElement('canvas');
    cv.width = 360;
    cv.height = 110;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#141414';
    ctx.font =
      'italic 58px "Segoe Script", "Brush Script MT", "Snell Roundhand", "Dancing Script", cursive';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 16, 58);
    return cv.toDataURL('image/png');
  } catch {
    return '';
  }
}

const safeFile = (s) =>
  String(s || '')
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, '');

/** Draw it and hand it to the browser, which is what every caller wants. */
export function saveContract(fields, sections) {
  const d = drawContract(fields, sections);
  d.save(`${safeFile(fields.creatorName)}_x_${safeFile(fields.brand)}.pdf`);
}
