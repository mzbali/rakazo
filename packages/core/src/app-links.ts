/** A place in a desktop app the host trusts links to open: the app's URL scheme and host. */
export type AppLink = { scheme: string; host: string };

const schemePattern = /^([a-z][a-z\d+.-]*):/i;

/**
 * Whether a URL opens one of these app places. A query, fragment, port or credentials is
 * refused: they can carry instructions to the app, such as a prompt to run, that the reader
 * never sees behind a link's label.
 */
export function matchesAppLink(url: string, links: readonly AppLink[]): boolean {
  const value = url.trim();
  const scheme = value.match(schemePattern)?.[1]?.toLowerCase();
  const candidates = links.filter((link) => link.scheme.toLowerCase() === scheme);
  // An empty query or fragment parses as none, yet still reaches the app, which parses it again.
  if (candidates.length === 0 || /[?#]/.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.port || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return candidates.some((link) => link.host.toLowerCase() === host);
}
