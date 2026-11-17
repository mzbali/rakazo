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
    return { error: webToolError(error) };
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
    return { error: webToolError(error) };
  }
}

// Transport messages can contain credentials, query strings and internal addresses. Only
// expose known classifications from causes, never their messages or arbitrary code values.
const transportReasons = new Map([
  ["ENOTFOUND", "DNS resolution failed"],
  ["EAI_AGAIN", "DNS resolution temporarily unavailable"],
  ["ECONNRESET", "connection reset"],
  ["ECONNREFUSED", "connection refused"],
  ["ETIMEDOUT", "connection timed out"],
  ["UND_ERR_CONNECT_TIMEOUT", "connection timed out"],
  ["UND_ERR_SOCKET", "connection closed"],
  ["CERT_HAS_EXPIRED", "TLS certificate expired"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "TLS certificate verification failed"],
]);

function webToolError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.message !== "fetch failed") return error.message;
  const seen = new Set<Error>();
  let cause: unknown = error;
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    const code = "code" in cause ? cause.code : undefined;
    const reason = typeof code === "string" ? transportReasons.get(code) : undefined;
    if (reason) return `fetch failed (${reason})`;
    cause = cause.cause;
  }
  return error.message;
}
