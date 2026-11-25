import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appLinkCatalog } from "@rakazo/core/app-links";
import { describe, expect, it } from "vitest";

type AppConfig = { expo: { ios?: { infoPlist?: { LSApplicationQueriesSchemes?: string[] } } } };

const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../app.json"), "utf8"),
) as AppConfig;

describe("mobile app links", () => {
  it("declares every scheme iOS must check before opening it", () => {
    const declared = config.expo.ios?.infoPlist?.LSApplicationQueriesSchemes ?? [];
    for (const { scheme } of appLinkCatalog) expect(declared).toContain(scheme);
  });
});
