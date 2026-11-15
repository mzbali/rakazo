import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import { webFetchFromTool, webSearchFromTool } from "./web-tools.js";

const context = { signal: new AbortController().signal } as AdapterContext;

function failingProvider(error: unknown) {
  return {
    describe: () => new FakeWebProvider().describe(),
    search: async () => {
      throw error;
    },
    fetch: async () => {
      throw error;
    },
  };
}

describe("web tool transport errors", () => {
  it.each([
    ["ECONNRESET", "connection reset"],
    ["ENOTFOUND", "DNS resolution failed"],
    ["UND_ERR_CONNECT_TIMEOUT", "connection timed out"],
    ["CERT_HAS_EXPIRED", "TLS certificate expired"],
  ])("classifies %s without disclosing transport details", async (code, reason) => {
    const cause = Object.assign(new Error("https://user:secret@private.example/?q=private"), {
      code,
    });
    const provider = failingProvider(
      new TypeError("fetch failed", { cause: new Error("wrapper", { cause }) }),
    );
    const expected = { error: `fetch failed (${reason})` };
    expect(await webSearchFromTool(provider, context, { query: "q" })).toEqual(expected);
    expect(await webFetchFromTool(provider, context, { url: "https://example.com" })).toEqual(
      expected,
    );
  });

  it("keeps unknown and cyclic causes private and terminates", async () => {
    const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error("secret"), { code: "private-code", cause: error });
    expect(await webSearchFromTool(failingProvider(error), context, { query: "q" })).toEqual({
      error: "fetch failed",
    });
  });

  it.each([new Error("HTTP 429"), new DOMException("cancelled", "AbortError"), "failure"])(
    "preserves other failures",
    async (error) => {
      expect(await webSearchFromTool(failingProvider(error), context, { query: "q" })).toEqual({
        error: error instanceof Error ? error.message : error,
      });
    },
  );
});
