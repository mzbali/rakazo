import { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { redactBlocks } from "./run-messages.js";
import { integrationTools } from "./run-tools-integrations.js";

const NASA = "https://science.nasa.gov/mars/facts/";
const ESA = "https://www.esa.int/Science_Exploration/Space_Science/Mars_Express";

function finishCall(args: Record<string, unknown>) {
  return { args, finish: async (result: unknown) => result };
}

function trustContext(sources?: Map<string, { url: string; title: string }>) {
  const searchResultUrls = new Set<string>();
  return {
    searchResultUrls,
    ctx: {
      trust: sources ? { sources, searchResultUrls } : { searchResultUrls },
      context: { signal: new AbortController().signal },
      providers: {
        web: {
          search: async () => [
            { title: "Mars Facts", url: NASA, snippet: "A day" },
            { title: "Skipped", url: "not a url", snippet: "" },
          ],
          fetch: async (input: { url: string }) => {
            if (input.url.endsWith("/missing")) return { error: "Not found" };
            return { url: input.url, title: "Mars Express", text: "A year", truncated: false };
          },
        },
      },
    },
  };
}

describe("recorded web sources", () => {
  it("records each search hit and a fetched page, and not a failed fetch", async () => {
    const sources = new Map<string, { url: string; title: string }>();
    const { ctx, searchResultUrls } = trustContext(sources);
    await integrationTools.web_search?.(ctx as never, finishCall({ query: "mars" }) as never);

    expect([...searchResultUrls]).toEqual([NASA]);
    expect(sources.get(NASA)).toEqual({ url: NASA, title: "Mars Facts" });
    expect([...sources.keys()]).toEqual([NASA]);

    await integrationTools.web_fetch?.(ctx as never, finishCall({ url: ESA }) as never);
    expect(searchResultUrls.has(ESA)).toBe(false);
    expect(sources.get(ESA)).toEqual({ url: ESA, title: "Mars Express" });

    await integrationTools.web_fetch?.(
      ctx as never,
      finishCall({ url: "https://example.test/missing" }) as never,
    );
    expect(sources.has("https://example.test/missing")).toBe(false);
  });

  it("still searches when the run has no sources map", async () => {
    const { ctx, searchResultUrls } = trustContext();
    await expect(
      integrationTools.web_search?.(ctx as never, finishCall({ query: "mars" }) as never),
    ).resolves.toMatchObject({
      results: [
        expect.objectContaining({ url: NASA }),
        expect.objectContaining({ url: "not a url" }),
      ],
    });
    expect([...searchResultUrls]).toEqual([NASA]);
  });
});

describe("redacted sources", () => {
  it("replaces a secret in the title and url and stays inside the block limits", () => {
    const secret = "super-secret-value";
    const [block] = redactBlocks(
      [
        {
          kind: "sources",
          items: [
            {
              url: `https://example.test/${secret}`,
              title: `Title ${secret}`,
              site: "example",
            },
          ],
        },
      ],
      [secret],
    );
    expect(block).toEqual({
      kind: "sources",
      items: [
        {
          url: "https://example.test/[redacted]",
          title: "Title [redacted]",
          site: "example",
        },
      ],
    });
    const parsed = MessageBlock.parse(block);
    expect(parsed.kind).toBe("sources");
    if (parsed.kind !== "sources") return;
    expect(parsed.items[0]?.url.length).toBeLessThanOrEqual(2048);
    expect(parsed.items[0]?.title.length).toBeLessThanOrEqual(300);
    expect(parsed.items[0]?.site.length).toBeLessThanOrEqual(40);
  });
});
