import { describe, expect, it } from "vitest";
import { kitComponentsUsed } from "./kit-components-used.js";

describe("kitComponentsUsed", () => {
  it("lists kit components once, in first-use order, and skips elements and unknown tags", () => {
    const source = `export default function V() {
  return (
    <Section>
      <div><Slider label="Rate" /></div>
      <LineChart data={[]} />
      <Slider label="Term" />
      <Mystery />
    </Section>
  );
}`;
    expect(kitComponentsUsed(source)).toEqual(["Section", "Slider", "LineChart"]);
  });

  it("ignores tag-like text in strings and comments", () => {
    const source = `export default () => <Section>{"<Quiz />"}{/* <Timeline /> */}</Section>;`;
    expect(kitComponentsUsed(source)).toEqual(["Section"]);
  });

  it("uses nothing from source that does not parse", () => {
    expect(kitComponentsUsed("export default () => <Section><")).toEqual([]);
  });
});
