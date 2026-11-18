import type { AdapterContext, WebFetchProvider, WebSearchProvider } from "@rakazo/adapter-kit";
import { normalizedHttpUrl } from "@rakazo/core/egress";
import { clampMaxChars, clampMaxResults, clampOffset } from "./web-limits.js";

/**
 * Remember an https image a fetched page named, and the page it came from. Text in the run cannot
 * add one. The first page wins. An image with no page is still trusted, with an empty page.
 */
export function rememberFetchedPageImage(
  urls: Map<string, string>,
  image: unknown,
  pageUrl?: unknown,
) {
  if (typeof image !== "string") return;
  const url = normalizedHttpUrl(image);
  if (!url?.startsWith("https://") || urls.has(url)) return;
  const page = typeof pageUrl === "string" ? normalizedHttpUrl(pageUrl) : undefined;
  urls.set(url, page ?? "");
}

export async function webSearchFromTool(
  search: WebSearchProvider,
  context: AdapterContext,
  args: Record<string, unknown>,
) {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query is required" };
  try {
    const results = await search.search(
      {
        query,
        maxResults: clampMaxResults(args.maxResults),
        signal: context.signal,
      },
      context,
    );
    return { results };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function webFetchFromTool(
  fetchProvider: WebFetchProvider,
  context: AdapterContext,
  args: Record<string, unknown>,
) {
  const url = String(args.url ?? "").trim();
  if (!url) return { error: "url is required" };
  try {
    const result = await fetchProvider.fetch(
      {
        url,
        maxChars: clampMaxChars(args.maxChars),
        offset: clampOffset(args.offset),
        signal: context.signal,
      },
      context,
    );
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
