/**
 * WHO MAY INDEX WHAT.
 *
 * DENY BY DEFAULT, like everything else here. `index.html` ships
 * `<meta name="robots" content="noindex">`, so every route is invisible to a
 * search engine unless it says otherwise. The public website pages say
 * otherwise; the signed-in app and the client share links never do, and the
 * share page adds `nofollow, noarchive` of its own.
 *
 * AND ONLY ON THE REAL SITE. Dev is a full deployment on its own address, so a
 * bare "index this" would offer Google two copies of every page, one of them
 * full of test data with a different brand list. The host has to be one of
 * ours below, or the page stays noindex however public it is.
 *
 * This is a meta tag rather than a header because the whole product is one
 * HTML file: there is no per-route response to attach `X-Robots-Tag` to.
 * Google renders the page and reads the tag it finds after React has run.
 */

/** The one address the real, public site answers on. Every other address (a preview, localhost) is deliberately absent. */
const PUBLIC_HOSTS = ['prismwurx.vercel.app'];

function robotsTag(): HTMLMetaElement {
  let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = 'robots';
    document.head.appendChild(tag);
  }
  return tag;
}

/**
 * Let search engines index the page that calls this, and put it back to
 * `noindex` when that page unmounts. Returns the cleanup, so it can be used
 * straight from a `useEffect`.
 */
export function allowIndexing(): () => void {
  const tag = robotsTag();
  const previous = tag.content;
  if (PUBLIC_HOSTS.includes(window.location.hostname)) {
    tag.content = 'index, follow';
  }
  return () => {
    tag.content = previous || 'noindex';
  };
}
