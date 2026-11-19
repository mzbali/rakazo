import { describe, expect, it } from "vitest";
import { DIAGRAM_ICON_NAMES } from "./visual-catalog.js";
import type { VisualElement } from "./visual-fence.js";
import { parseVisualFence } from "./visual-fence.js";

/** The one child of a `<Visual>` that holds `inner`. */
function only(inner: string): VisualElement {
  const child = parseVisualFence(`<Visual summary="S">${inner}</Visual>`).root?.children[0];
  if (!child) throw new Error("no child");
  return child;
}

const BARS = `<Bars bars={[{label: "A", value: 3, display: "3 ms"}, {label: "B", value: -1}]} />`;
const LINE = `<LineChart points={[{label: "Mon", value: 2}, {label: "Tue", value: 4}]} lines={[{label: "Goal", values: [3, 3]}]} labels={["Actual"]} floor={0} unit="ms" />`;
const PIE = `<Pie parts={[{label: "A", value: 3}, {label: "B", value: 1, display: "1 GB"}]} total="4 GB" label="Used" />`;
const TABLE = `<Table columns={["Plan", "Price"]} rows={[["Free", 0], ["Pro", {text: "$9", tone: "success"}]]} align={["start", "end"]} emphasis={0} />`;
const PROS = `<ProsCons pros={["Fast", "Cheap"]} cons={["Small"]} consHeading="Watch out" />`;
const STATUS = `<Status tone="success">Shipped</Status>`;
const COPY = `<CopyButton label="Copy command" text="pnpm install" />`;
const TABS = `<Tabs><Tab label="One"><Callout lead="A">a</Callout></Tab><Tab label="Two"><Steps steps={[{title: "x"}]} /></Tab></Tabs>`;

describe("the rest of the catalog", () => {
  it.each([
    ["Bars", BARS],
    ["LineChart", LINE],
    ["Pie", PIE],
    ["Table", TABLE],
    ["ProsCons", PROS],
    ["Status", STATUS],
    ["CopyButton", COPY],
    ["Tabs", TABS],
  ])("reads a valid %s", (tag, source) => {
    const element = only(source);
    expect(element.tag).toBe(tag);
    expect(element.state).toBe("complete");
    expect(element.reason).toBeUndefined();
  });

  it("keeps only the props each tag names", () => {
    expect(only(`<Bars bars={[{label: "A", value: 1, extra: "x"}]} other="y" />`).props).toEqual({
      bars: [{ label: "A", value: 1 }],
    });
    expect(only(`<Status tone="info" lead="x">Ok</Status>`).props).toEqual({ tone: "info" });
    expect(
      only(`<Table columns={["A"]} rows={[[{text: "x", tone: "danger", extra: 1}]]} />`).props.rows,
    ).toEqual([[{ text: "x", tone: "danger" }]]);
  });

  it.each([
    ["no bars", `<Bars />`],
    ["a bar without a number", `<Bars bars={[{label: "A", value: "3"}]} />`],
    ["too many bars", `<Bars bars={[${Array(21).fill('{label: "A", value: 1}').join(",")}]} />`],
    ["a bad emphasis", `<Bars bars={[{label: "A", value: 1}]} emphasis={4} />`],
    ["a line chart with no points", `<LineChart points={[]} />`],
    ["a non-numeric series", `<LineChart points={[{value: 1}]} lines={[{values: ["a"]}]} />`],
    [
      "more than 5 series names",
      `<LineChart points={[{value: 1}]} labels={["a","b","c","d","e","f"]} />`,
    ],
    ["a pie part below zero", `<Pie parts={[{label: "A", value: -1}]} />`],
    ["a pie total that is false", `<Pie parts={[{label: "A", value: 1}]} total={false} />`],
    ["a table without rows", `<Table columns={["A"]} />`],
    ["a row longer than the columns", `<Table columns={["A"]} rows={[["x", "y"]]} />`],
    [
      "a cell that is an object without text",
      `<Table columns={["A"]} rows={[[{tone: "info"}]]} />`,
    ],
    ["a table align that is unknown", `<Table columns={["A"]} rows={[["x"]]} align={["left"]} />`],
    ["a column emphasis out of range", `<Table columns={["A"]} rows={[["x"]]} emphasis={1} />`],
    ["pros and cons both empty", `<ProsCons pros={[]} cons={[]} />`],
    ["a blank point", `<ProsCons pros={["  "]} />`],
    ["a status with no words", `<Status tone="info"></Status>`],
    ["a status with an unknown tone", `<Status tone="purple">Hi</Status>`],
    ["a status that is a sentence", `<Status>${"word ".repeat(12)}</Status>`],
    ["a copy button with no text", `<CopyButton label="Copy" />`],
    ["a copy button with no label", `<CopyButton text="x" />`],
    ["a very long copy text", `<CopyButton label="Copy" text="${"x".repeat(2001)}" />`],
    [
      "a floor too large for a scale to tell apart",
      `<LineChart points={[{value: 1e20}]} floor={1e20} />`,
    ],
    ["an expression as a prop", `<Bars bars={items} />`],
  ])("shows %s as invalid", (_name, source) => {
    const element = only(source);
    expect(element.state).toBe("invalid");
    expect(element.reason).toBeTruthy();
  });

  it("keeps big figures in bars, a pie, a table or a metric, which have no numeric axis", () => {
    expect(only(`<Bars bars={[{label: "A", value: 1e16, display: "10 PB"}]} />`).state).toBe(
      "complete",
    );
    expect(only(`<Pie parts={[{label: "A", value: 1e16}]} />`).state).toBe("complete");
    expect(only(`<Table columns={["A"]} rows={[[1e16]]} />`).state).toBe("complete");
    expect(only(`<Metrics metrics={[{value: 1e16, label: "x"}]} />`).state).toBe("complete");
  });

  it("lets a diagram node name an icon from the fixed list only", () => {
    const node = (icon: string) =>
      only(`<Diagram nodes={[{id: "a", label: "A", icon: "${icon}"}]} />`);
    for (const name of DIAGRAM_ICON_NAMES) expect(node(name).state).toBe("complete");
    expect(node("database").props.nodes).toEqual([{ id: "a", label: "A", icon: "database" }]);
    expect(node("rocket").state).toBe("invalid");
    expect(node("constructor").state).toBe("invalid");
  });

  describe("Tabs", () => {
    it("holds Tab elements, each with its own children", () => {
      const tabs = only(TABS);
      expect(tabs.children.map((tab) => [tab.tag, tab.props.label, tab.state])).toEqual([
        ["Tab", "One", "complete"],
        ["Tab", "Two", "complete"],
      ]);
      expect(tabs.children[1]?.children.map((child) => child.tag)).toEqual(["Steps"]);
    });

    it("rejects a Tab outside Tabs, other children, a nested Tabs and more than 8 tabs", () => {
      expect(only(`<Tab label="x"></Tab>`).state).toBe("invalid");
      const mixed = only(`<Tabs><Callout lead="x" /></Tabs>`);
      expect(mixed.children[0]?.state).toBe("invalid");
      const nested = only(`<Tabs><Tab label="x"><Tabs></Tabs></Tab></Tabs>`);
      expect(nested.children[0]?.children[0]?.state).toBe("invalid");
      const many = only(
        `<Tabs>${Array.from({ length: 9 }, (_, n) => `<Tab label="${n}"></Tab>`).join("")}</Tabs>`,
      );
      expect(
        many.children.map((tab) => tab.state).filter((state) => state === "invalid"),
      ).toHaveLength(1);
      expect(only(`<Tabs><Tab></Tab></Tabs>`).children[0]?.state).toBe("invalid");
    });

    it("lets a Tab hold a Grid, and a Grid hold Tabs", () => {
      const tab = only(
        `<Tabs><Tab label="x"><Grid columns={2}><Status>A</Status><Status>B</Status></Grid></Tab></Tabs>`,
      );
      expect(tab.children[0]?.children[0]?.children.map((child) => child.state)).toEqual([
        "complete",
        "complete",
      ]);
      expect(only(`<Grid><Tabs><Tab label="x"></Tab></Tabs></Grid>`).children[0]?.state).toBe(
        "complete",
      );
    });

    it("draws the tabs that are complete while the Tabs is still open", () => {
      const { root, tail } = parseVisualFence(
        `<Visual summary="S"><Tabs><Tab label="One"><Callout lead="A">a</Callout></Tab><Tab label="Two"><Callout lead="B">b`,
      );
      const tabs = root?.children[0];
      expect(tabs?.state).toBe("open");
      expect(tabs?.children.map((tab) => [tab.props.label, tab.state])).toEqual([
        ["One", "complete"],
        ["Two", "open"],
      ]);
      expect(tabs?.children[1]?.children[0]?.state).toBe("open");
      expect(tail).toBe(true);
    });
  });

  describe("streaming", () => {
    const WHOLE = `<Visual summary="S">\n${[BARS, LINE, PIE, TABLE, PROS, STATUS, COPY, TABS].join("\n")}\n</Visual>`;

    it("never draws half of a tag and keeps every drawn element once it is drawn", () => {
      let drawn = 0;
      for (let cut = 0; cut <= WHOLE.length; cut++) {
        const { root } = parseVisualFence(WHOLE.slice(0, cut));
        const done = (root?.children ?? []).filter((child) => child.state === "complete").length;
        expect(done).toBeGreaterThanOrEqual(drawn);
        drawn = done;
      }
      expect(drawn).toBe(8);
    });

    it("has the new tags unfinished until their closing tag or /> arrives", () => {
      const cut = (source: string, at: number) =>
        parseVisualFence(`<Visual summary="S">${source.slice(0, at)}`);
      for (const source of [BARS, TABLE, PIE, COPY]) {
        const partial = cut(source, source.length - 3);
        expect(partial.root?.children).toHaveLength(0);
        expect(partial.tail).toBe(true);
      }
      const status = cut(STATUS, STATUS.indexOf("</Status>") - 1);
      expect(status.root?.children[0]?.state).toBe("open");
      expect(status.tail).toBe(true);
    });

    it("shows an invalid closed element beside the ones that drew", () => {
      const { root } = parseVisualFence(`<Visual summary="S">${STATUS}<Pie parts={[]} />${COPY}`);
      expect(root?.children.map((child) => child.state)).toEqual([
        "complete",
        "invalid",
        "complete",
      ]);
    });
  });
});
