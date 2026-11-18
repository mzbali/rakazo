import { expectLinearTime } from "@rakazo/contracts/test-timing";
import { createMathScanner } from "@rakazo/core/math-delimiters";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { remarkMath } from "./remark-math";

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hProperties?: { className?: string[] } };
};

const processor = unified().use(remarkParse).use(remarkMath);

function formulas(markdown: string): { tex: string; display: boolean }[] {
  const found: { tex: string; display: boolean }[] = [];
  const walk = (node: Node) => {
    if (node.type === "rkMath") {
      found.push({
        tex: node.value ?? "",
        display: node.data?.hProperties?.className?.includes("rk-math-display") ?? false,
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(processor.parse(markdown) as Node);
  return found;
}

describe("remarkMath", () => {
  it("reads $$ and \\[ as display and \\( as inline", () => {
    expect(formulas("a $$x^2$$ b \\[y\\] c \\(z\\)")).toEqual([
      { tex: "x^2", display: true },
      { tex: "y", display: true },
      { tex: "z", display: false },
    ]);
  });

  it("keeps markdown characters inside a formula out of emphasis", () => {
    expect(formulas("\\(a*b*c and x_i_j\\)")).toEqual([{ tex: "a*b*c and x_i_j", display: false }]);
  });

  it("reads a formula across lines", () => {
    expect(formulas("see\n$$\na = b\n$$\nthere")).toEqual([{ tex: "a = b", display: true }]);
  });

  it("never treats a single $ as maths", () => {
    expect(formulas("It costs $5 to $10, or $20.")).toEqual([]);
  });

  it("leaves an unclosed delimiter as text, even with a closer in the next paragraph", () => {
    expect(formulas("open $$ x\n\nclose $$")).toEqual([]);
    expect(formulas("\\(a and \\[b and then more")).toEqual([]);
  });

  it("finds nothing in code", () => {
    expect(formulas("`$$x$$` and `\\(y\\)`\n\n```\n$$z$$\n\\[w\\]\n```")).toEqual([]);
  });

  it("keeps an escaped dollar or backslash from opening or closing", () => {
    expect(formulas("\\$$5 and $$10")).toEqual([]);
    expect(formulas("\\\\(not maths\\\\)")).toEqual([]);
    expect(formulas("\\(a \\\\) b \\)")).toEqual([{ tex: "a \\\\) b", display: false }]);
  });

  it("agrees with the shared scanner", () => {
    const samples = [
      "$$a$$ and $$b$$",
      "$$a $ b$$",
      "\\(\\) $$ $$ \\[ \\]",
      "$$$x$$",
      "\\(x\\)\\(y\\)",
      "x $$a \\$$ b$$",
      "\\[a\\)b\\]",
    ];
    for (const sample of samples) {
      const scan = createMathScanner(sample);
      const expected: { tex: string; display: boolean }[] = [];
      for (let index = 0; index < sample.length; ) {
        const match = scan(index);
        if (match) {
          expected.push({ tex: match.tex, display: match.display });
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
