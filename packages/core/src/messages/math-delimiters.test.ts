import { expectLinearTime } from "@rakazo/contracts/test-timing";
import { describe, expect, it } from "vitest";
import { plainTextFromMarkdown } from "./markdown-plain.js";
import { createMathScanner } from "./math-delimiters.js";

function all(source: string) {
  const scan = createMathScanner(source);
  const found: { at: number; tex: string; display: boolean }[] = [];
  for (let index = 0; index < source.length; ) {
    const match = scan(index);
    if (match) {
      found.push({ at: index, tex: match.tex, display: match.display });
      index = match.end;
    } else {
      index += source[index] === "\\" ? 2 : 1;
    }
  }
  return found;
}

describe("createMathScanner", () => {
  it("reads $$ and \\[ as display and \\( as inline", () => {
    expect(all("a $$x^2$$ b \\[y\\] c \\(z\\)")).toEqual([
      { at: 2, tex: "x^2", display: true },
      { at: 12, tex: "y", display: true },
      { at: 20, tex: "z", display: false },
    ]);
  });

  it("never treats a single $ as maths", () => {
    expect(all("It costs $5 to $10, or $20.")).toEqual([]);
  });

  it("leaves an unclosed delimiter as text", () => {
    expect(all("start $$ never closed and \\( neither \\[ nor this")).toEqual([]);
  });

  it("does not close on an escaped delimiter", () => {
    expect(all("\\(a \\\\) b")).toEqual([]);
    expect(all("\\(a \\\\) b \\)")).toEqual([{ at: 0, tex: "a \\\\) b", display: false }]);
    expect(all("$$a \\$$ b")).toEqual([]);
    expect(all("\\$$5 and $$10")).toEqual([]);
  });

  it("keeps an escaped task-list box literal", () => {
    expect(all("- \\[x\\] done\n- \\[ \\] open\n- \\[X\\] too")).toEqual([]);
    expect(all("\\[xy\\]")).toEqual([{ at: 0, tex: "xy", display: true }]);
  });

  it("skips empty formulas", () => {
    expect(all("\\(\\) $$ $$ $$$$")).toEqual([]);
  });

  it("keeps a single $ inside a display formula", () => {
    expect(all("$$a $ b$$")).toEqual([{ at: 0, tex: "a $ b", display: true }]);
  });

  it("reads hostile runs of openers in linear time", () => {
    for (const unit of ["$$ a ", "\\( a ", "\\[ a ", "$$\\( a \\[ "]) {
      const text = unit.repeat(40_000);
      expectLinearTime(() => expect(all(text).length).toBeLessThan(40_001));
    }
  });
});

describe("plainTextFromMarkdown with maths", () => {
  it("keeps the TeX as written", () => {
    expect(plainTextFromMarkdown("Set \\(a \\{b\\} \\_c\\) and $$x_1 * y_2$$ now")).toBe(
      "Set \\(a \\{b\\} \\_c\\) and $$x_1 * y_2$$ now",
    );
    expect(plainTextFromMarkdown("\\[\n\\frac{1}{2}\n\\]")).toBe("\\[ \\frac{1}{2} \\]");
  });

  it("still unescapes outside formulas and reads code as code", () => {
    expect(plainTextFromMarkdown("a \\* b `\\(x\\)` $5")).toBe("a * b \\(x\\) $5");
  });
});
