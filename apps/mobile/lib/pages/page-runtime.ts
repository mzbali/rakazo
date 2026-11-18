import { PAGE_RUNTIME_PATH } from "@rakazo/core";

type Runtime = { text: string; etag: string | null };

const runtimes = new Map<string, Runtime>();
const pending = new Map<string, Promise<string>>();

/** A request that has not answered by then fails, so pages and visuals show their fallback. */
export const PAGE_RUNTIME_TIMEOUT_MS = 20_000;

/**
 * The page runtime from the user's own server; the page document inlines it because the viewer's
 * policy loads nothing. Each use asks the server again with the last copy's tag, as its
 * `no-cache` asks, so a page never runs on a kit older than the server that checked it. Uses
 * that overlap share one request, and a failed or stalled request is retried next time.
 */
export function loadPageRuntime(apiBase: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = new URL(PAGE_RUNTIME_PATH, apiBase).href;
  let runtime = pending.get(url);
  if (!runtime) {
    const cached = runtimes.get(url);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error("Page runtime request timed out"));
      }, PAGE_RUNTIME_TIMEOUT_MS);
    });
    const headers = cached?.etag ? { "if-none-match": cached.etag } : undefined;
    const load = fetcher(url, { headers, signal: abort.signal }).then(async (response) => {
      if (response.status === 304 && cached) return cached.text;
      if (!response.ok) throw new Error(`Page runtime returned ${response.status}`);
      const text = await response.text();
      runtimes.set(url, { text, etag: response.headers.get("etag") });
      return text;
    });
    runtime = Promise.race([load, stalled]).finally(() => {
      clearTimeout(timer);
      pending.delete(url);
    });
    pending.set(url, runtime);
  }
  return runtime;
}
