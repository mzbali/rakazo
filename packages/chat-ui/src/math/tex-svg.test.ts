import { describe, expect, it } from "vitest";
import { texToSvg } from "./tex-svg";

describe("texToSvg", () => {
  it("draws a formula in the text colour, with no embedded font cache", () => {
    const svg = texToSvg("\\frac{a}{b} + \\sqrt{x}", true);
    expect(svg.xml.startsWith("<svg")).toBe(true);
    expect(svg.xml).toContain('fill="currentColor"');
    expect(svg.xml).not.toContain("<use");
    expect(svg.width).toBeGreaterThan(0);
    expect(svg.height).toBeGreaterThan(0);
  });

  it("puts a subscript's descender below the baseline", () => {
    expect(texToSvg("x_i", false).baseline).toBeLessThan(0);
  });

  it("throws on TeX it cannot read, so the caller shows the source", () => {
    expect(() => texToSvg("\\frac{", false)).toThrow();
    expect(() => texToSvg("\\notacommand", false)).toThrow();
  });
});

describe("texToSvg macros", () => {
  it("does not let one formula define a macro for the next", () => {
    expect(() => texToSvg("\\def\\x{y}\\x", false)).toThrow();
    expect(() => texToSvg("\\x", false)).toThrow();
    expect(() => texToSvg("\\newcommand{\\z}{q}\\z", false)).toThrow();
  });
});
