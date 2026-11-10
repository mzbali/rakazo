import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mobileAppLinks } from "./app-links";

type AppConfig = { expo: { ios?: { infoPlist?: { LSApplicationQueriesSchemes?: string[] } } } };

const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../app.json"), "utf8"),
) as AppConfig;

describe("mobile app links", () => {
  it("declares every scheme iOS must check before opening it", () => {
    const declared = config.expo.ios?.infoPlist?.LSApplicationQueriesSchemes ?? [];
    for (const { scheme } of mobileAppLinks) expect(declared).toContain(scheme);
  });
});
