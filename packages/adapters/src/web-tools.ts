import type { AdapterContext, WebFetchProvider, WebSearchProvider } from "@rakazo/adapter-kit";
import { normalizedHttpUrl } from "@rakazo/core/egress";
import { clampMaxChars, clampMaxResults, clampOffset } from "./web-limits.js";

/** Remember an https image a fetched page named. Text in the run cannot add one. */
export function rememberFetchedPageImage(urls: Set<string>, image: unknown) {
  if (typeof image !== "string") return;
  const url = normalizedHttpUrl(image);
  if (url?.startsWith("https://")) urls.add(url);
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
