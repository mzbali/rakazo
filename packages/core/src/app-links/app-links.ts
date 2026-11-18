import { appLinkCatalog } from "./app-link-catalog.js";

/**
 * A place in an app the host trusts links to open: the app's URL scheme and host, and
 * optionally its name, a website whose icon its links show (such as the app's home page), and
 * the query keys a link may carry.
 */
export type AppLink = {
  scheme: string;
  host: string;
  /** What a link to it is called: "Open in {name}". */
  name?: string;
  icon?: string;
  /** Query keys that only pick what the app shows, such as which account. */
  queryKeys?: readonly string[];
  /** Only the iPhone app takes these links, so every other surface leaves them as text. */
  iosOnly?: boolean;
};

export { appLinkCatalog };

/** The catalog's apps a computer can open, for web and desktop. */
export const computerAppLinks = appLinkCatalog.filter((link) => !link.iosOnly);

const schemePattern = /^([a-z][a-z\d+.-]*):/i;

/**
 * Whether a URL opens one of these app places. A fragment, port, credentials or a query key
 * the place does not list is refused: they can carry instructions to the app, such as a prompt
 * to run, that the reader never sees behind a link's label.
 */
export function matchesAppLink(url: string, links: readonly AppLink[]): boolean {
  return findAppLink(url, links) !== undefined;
}

/** The app place a URL opens, under the same rules as `matchesAppLink`. */
export function findAppLink(url: string, links: readonly AppLink[]): AppLink | undefined {
  const value = url.trim();
  const scheme = value.match(schemePattern)?.[1]?.toLowerCase();
  const candidates = links.filter((link) => link.scheme.toLowerCase() === scheme);
  // An empty fragment parses as none, yet still reaches the app, which parses it again.
  if (!scheme || candidates.length === 0 || value.includes("#")) return undefined;
  // The host is part of the place, so `scheme:path` without one is not it.
  if (!value.startsWith("//", scheme.length + 1)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.port || parsed.username || parsed.password) return undefined;
  const host = parsed.hostname.toLowerCase();
  const link = candidates.find((candidate) => candidate.host.toLowerCase() === host);
  const queryAt = value.indexOf("?");
  return link && (queryAt === -1 || allowedQuery(value.slice(queryAt + 1), link))
    ? link
    : undefined;
}

/** Keys compare as written, since the app reads the query itself; each may appear once. */
function allowedQuery(query: string, link: AppLink): boolean {
  if (!query || !link.queryKeys) return false;
  const keys = query.split("&").map((pair) => pair.split("=", 1)[0]!);
  return new Set(keys).size === keys.length && keys.every((key) => link.queryKeys!.includes(key));
}
