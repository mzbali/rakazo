import { expectLinearTime } from "@rakazo/contracts/test-timing";
import { createMathScanner } from "@rakazo/core/math-delimiters";
import { createMarkdownIt } from "@ronradtke/react-native-markdown-display";
import { describe, expect, it, vi } from "vitest";
import { markMath } from "./markdown-it-math";

// The library draws with react-native, whose source node cannot load; parsing needs none of it.
vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: (options: Record<string, unknown>) => options.ios ?? options.default,
  },
  StyleSheet: {
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1,
  },
  Dimensions: { get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) },
  PixelRatio: { get: () => 3, getFontScale: () => 1 },
  Linking: {},
  Text: "Text",
  View: "View",
  Image: "Image",
  TouchableWithoutFeedback: "TouchableWithoutFeedback",
  ScrollView: "ScrollView",
}));

const parser = createMarkdownIt();
markMath(parser);

type Token = { type: string; content: string; children?: Token[] | null };

function formulas(markdown: string): { type: string; tex: string }[] {
  const found: { type: string; tex: string }[] = [];
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === "math_inline" || token.type === "math_display") {
        found.push({ type: token.type, tex: token.content });
      }
      if (token.children) walk(token.children);
    }
  };
  walk(parser.parse(markdown, {}) as Token[]);
  return found;
}

describe("markMath", () => {
  it("reads $$ and \\[ as display and \\( as inline", () => {
    expect(formulas("a $$x^2$$ b \\[y\\] c \\(z\\)")).toEqual([
      { type: "math_display", tex: "x^2" },
      { type: "math_display", tex: "y" },
      { type: "math_inline", tex: "z" },
    ]);
  });

  it("keeps markdown characters inside a formula out of emphasis", () => {
    expect(formulas("\\(a*b*c and x_i_j\\)")).toEqual([
      { type: "math_inline", tex: "a*b*c and x_i_j" },
    ]);
  });

  it("reads a formula across lines", () => {
    expect(formulas("see\n$$\na = b\n$$\nthere")).toEqual([{ type: "math_display", tex: "a = b" }]);
  });

  it("never treats a single $ as maths", () => {
    expect(formulas("It costs $5 to $10, or $20.")).toEqual([]);
  });

  it("leaves an unclosed delimiter as text, even with a closer in the next paragraph", () => {
    expect(formulas("open $$ x\n\nclose $$")).toEqual([]);
    expect(formulas("\\(a and \\[b and then more")).toEqual([]);
  });

  it("finds nothing in code", () => {
    expect(formulas("`$$x$$` and `\\(y\\)`\n\n```\n$$z$$\n\\[w\\]\n```\n\n    \\(q\\)")).toEqual(
      [],
    );
  });

  it("keeps an escaped dollar or backslash from opening or closing", () => {
    expect(formulas("\\$$5 and $$10")).toEqual([]);
    expect(formulas("\\\\(not maths\\\\)")).toEqual([]);
    expect(formulas("\\(a \\\\) b \\)")).toEqual([{ type: "math_inline", tex: "a \\\\) b" }]);
  });

  it("agrees with the shared scanner", () => {
    const samples = [
      "$$a$$ and $$b$$",
      "$$a $ b$$",
      "\\(\\) $$ $$ \\[ \\]",
      "$$$x$$",
      "\\[a\\)b\\]",
    ];
    for (const sample of samples) {
      const scan = createMathScanner(sample);
      const expected: { type: string; tex: string }[] = [];
      for (let index = 0; index < sample.length; ) {
        const match = scan(index);
        if (match) {
          expected.push({ type: match.display ? "math_display" : "math_inline", tex: match.tex });
          index = match.end;
        } else {
          index += sample[index] === "\\" ? 2 : 1;
        }
      }
      expect(formulas(sample), sample).toEqual(expected);
    }
  });

  it("reads hostile runs of openers in linear time", () => {
    for (const unit of ["$$ a ", "\\( a ", "$$\\( a \\[ "]) {
      const text = unit.repeat(20_000);
      expectLinearTime(() => expect(formulas(text).length).toBeLessThan(20_001));
    }
  });
});
