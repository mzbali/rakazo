import { describe, expect, it } from "vitest";
import { formatValue } from "./dataviz/scale.js";
import { nativeWords } from "./native-words.js";

describe("native words", () => {
  it("shorten large figures like the web does, even where Intl ignores compact notation", () => {
    expect(formatValue(123_456_789, undefined, undefined, nativeWords)).toBe("123.5M");
    expect(formatValue(250_000, undefined, undefined, nativeWords)).toBe("250K");
    expect(formatValue(1234.5, undefined, undefined, nativeWords)).toBe("1,234.5");
  });

  it("read the English words for what the phone writes itself", () => {
    expect([nativeWords.t("pros"), nativeWords.t("cons"), nativeWords.t("other")]).toEqual([
      "Pros",
      "Cons",
      "Other",
    ]);
  });
});
