import { parseVisualFence } from "@rakazo/core/visual-fence";
import { describe, expect, it } from "vitest";
import { drawPlan, drawsAsVisual, hasUnfinishedPart } from "./visual-draw";

const parse = (source: string) => parseVisualFence(source);

describe("drawPlan", () => {
  it("draws what is complete, shells for open containers, and waits for open leaves", () => {
    const { root } = parse(
      `<Visual summary="S"><Callout lead="a">x</Callout><Callout lead="b">half`,
    );
    expect(drawPlan(root!)).toBe("draw");
    expect(root?.children.map(drawPlan)).toEqual(["draw", "skip"]);
  });

  it("names a closed element that cannot draw", () => {
    const { root } = parse(`<Visual summary="S"><Quote>q</Quote></Visual>`);
    expect(root?.children.map(drawPlan)).toEqual(["unavailable"]);
  });
});

describe("hasUnfinishedPart", () => {
  it("is true for a cut tag or an open leaf, false between complete siblings", () => {
    expect(hasUnfinishedPart(parse(`<Visual summary="S"><Callout lea`))).toBe(true);
    expect(hasUnfinishedPart(parse(`<Visual summary="S"><Callout lead="a">x`))).toBe(true);
    expect(hasUnfinishedPart(parse(`<Visual summary="S"><Callout lead="a">x</Callout>\n`))).toBe(
      false,
    );
  });
});

describe("drawsAsVisual", () => {
  const big = `<Visual summary="S">${'<Callout lead="x">filler</Callout>'.repeat(1100)}`;

  it("needs a usable <Visual> root", () => {
    expect(drawsAsVisual(parse(`<Callout lead="a" />`), false)).toBe(false);
    expect(drawsAsVisual(parse(`<Visual>`), true)).toBe(false);
    expect(drawsAsVisual(parse(`<Visual summary="S">`), true)).toBe(true);
  });

  it("keeps drawing an oversize fence while it streams and gives it up once finished", () => {
    expect(drawsAsVisual(parse(big), true)).toBe(true);
    expect(drawsAsVisual(parse(big), false)).toBe(false);
  });
});
