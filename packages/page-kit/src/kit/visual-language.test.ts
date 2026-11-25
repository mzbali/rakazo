import { describe, expect, it } from "vitest";
import { standsAsColumns } from "./visual-language.js";

describe("standsAsColumns", () => {
  it("stands a few short positive bars as columns", () => {
    expect(
      standsAsColumns([
        { label: "Mon", value: 4 },
        { label: "Tue", value: 0 },
      ]),
    ).toBe(true);
  });

  it("keeps long names, negatives and many bars as rows", () => {
    expect(standsAsColumns([{ label: "Travelling Salesman", value: 4 }])).toBe(false);
    expect(standsAsColumns([{ label: "Mon", value: -1 }])).toBe(false);
    expect(
      standsAsColumns(Array.from({ length: 9 }, (_, i) => ({ label: `${i}`, value: i }))),
    ).toBe(false);
    expect(standsAsColumns([])).toBe(false);
  });
});
