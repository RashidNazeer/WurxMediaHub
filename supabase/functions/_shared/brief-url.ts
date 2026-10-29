/**
 * A content-brief link, checked the same way in the browser and on the server.
 *
 * THIS FILE HAS A TWIN: `src/lib/brief-url.ts`. Two copies, on purpose and for
 * the same reason as `parseDealVideos`: the Edge Function runs in Deno and the
 * screen in the browser, and neither can import the other's tree. The screen's
 * copy only decides what to say before a request is made; THIS copy decides
 * what is stored. `scripts/verify/angles/check-angles-briefs.mjs` runs both over
 * one table of inputs and fails if they ever disagree.
 *
 * WHAT IS ACCEPTED: a Google Docs link, because that is all the audit backend
 * can read (`collab_brand_briefs.brief_url` has a CHECK for the same prefix).
 * It must be shared as "Anyone with the link can view", which this file cannot
 * know and the function asks Google about separately.
 *
 * THE TAB IS PART OF THE BRIEF. A document with two products has a tab each, and
 * without `?tab=t.xxxx` Google exports every tab as one text, so one product's
 * videos would be judged against the other's concepts. The tab is kept; every
 * other query parameter and the fragment are dropped, so the same document
 * always becomes the same stored link.
 *
 * No imports and no I/O, so it can be tested directly.
 */

export type BriefUrl =
  | { ok: true; url: string; docId: string; tab: string | null }
  | { ok: false; error: string };

const DOC_PATH = /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{16,})(?:\/|$)/;
const TAB = /^t\.[A-Za-z0-9]+$/;

export function parseBriefUrl(input: string): BriefUrl {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Paste the link to the brief.' };
  if (raw.length > 600) return { ok: false, error: 'That link is too long to be a Google Docs link.' };

  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'That does not look like a link. Copy it from the document\'s address bar.' };
  }

  if (u.protocol !== 'https:') {
    return { ok: false, error: 'The link must start with https://.' };
  }
  if (u.hostname === 'drive.google.com') {
    return {
      ok: false,
      error: 'That is a Google Drive link. Open the document itself and copy its address from the browser.',
    };
  }
  if (u.hostname !== 'docs.google.com') {
    return { ok: false, error: 'Only Google Docs links are supported (docs.google.com/document/...).' };
  }
  if (/^\/document\/d\/e\//.test(u.pathname)) {
    return {
      ok: false,
      error: 'That is a "published to the web" link. Use the normal link from the address bar instead.',
    };
  }
  const m = DOC_PATH.exec(u.pathname);
  if (!m) {
    return { ok: false, error: 'That is not a Google Docs document link (docs.google.com/document/d/...).' };
  }

  const docId = m[1]!;
  const tabParam = u.searchParams.get('tab');
  const tab = tabParam && TAB.test(tabParam) ? tabParam : null;
  const url = `https://docs.google.com/document/d/${docId}/edit${tab ? `?tab=${tab}` : ''}`;
  return { ok: true, url, docId, tab };
}

/** The plain-text export of a brief, which is what the audit backend reads. */
export function briefExportUrl(docId: string, tab: string | null): string {
  return `https://docs.google.com/document/d/${docId}/export?format=txt${tab ? `&tab=${tab}` : ''}`;
}
