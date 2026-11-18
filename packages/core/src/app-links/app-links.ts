/**
 * A place in an app the host trusts links to open: the app's URL scheme and host, and
 * optionally a website whose icon its links show, such as the app's home page.
 */
export type AppLink = { scheme: string; host: string; icon?: string };

const schemePattern = /^([a-z][a-z\d+.-]*):/i;

/**
 * Whether a URL opens one of these app places. A query, fragment, port or credentials is
 * refused: they can carry instructions to the app, such as a prompt to run, that the reader
 * never sees behind a link's label.
 */
export function matchesAppLink(url: string, links: readonly AppLink[]): boolean {
  return findAppLink(url, links) !== undefined;
}

/** The app place a URL opens, under the same rules as `matchesAppLink`. */
export function findAppLink(url: string, links: readonly AppLink[]): AppLink | undefined {
  const value = url.trim();
  const scheme = value.match(schemePattern)?.[1]?.toLowerCase();
  const candidates = links.filter((link) => link.scheme.toLowerCase() === scheme);
  // An empty query or fragment parses as none, yet still reaches the app, which parses it again.
  if (candidates.length === 0 || /[?#]/.test(value)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.port || parsed.username || parsed.password) return undefined;
  const host = parsed.hostname.toLowerCase();
  return candidates.find((link) => link.host.toLowerCase() === host);
}
