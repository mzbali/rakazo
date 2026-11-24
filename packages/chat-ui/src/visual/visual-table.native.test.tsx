import { parseVisualFence } from "@rakazo/core/visual-fence";
import { tokensForAppearance } from "@rakazo/ui-tokens";
import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Table } from "./visual-blocks.native";
import { columnFloor, TABLE_FONT_SIZE } from "./visual-table-layout";

vi.mock("react-native", () => ({
  Platform: {
    select: (options: { ios?: string; default?: string }) => options.ios ?? options.default,
  },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
  View: "view",
  Text: "text",
  ScrollView: "scroll",
}));

const FENCE = `<Visual summary="Classes">
<Table columns={["Class", "Easy to solve?", "Easy to check?", "Examples"]} rows={[["P", {text: "Yes", tone: "success"}, {text: "Yes", tone: "success"}, "Sorting, shortest path, primality testing"], ["NP (not known to be in P)", {text: "Unknown", tone: "warning"}, {text: "Yes", tone: "success"}, "Factoring, graph isomorphism"], ["NP-complete", {text: "Unknown, probably not", tone: "warning"}, {text: "Yes", tone: "success"}, "SAT, Sudoku, traveling salesman (decision version), graph coloring"]]} />
</Visual>`;

function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...nodes(child.props.children as ReactNode)];
  });
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle));
  return style && typeof style === "object" ? (style as Record<string, unknown>) : {};
}

function draw(width: number) {
  const parse = parseVisualFence(FENCE);
  return Table({
    element: parse.root!.children[0]!,
    surface: {
      palette: tokensForAppearance("dark"),
      colorScheme: "dark",
      narrow: true,
      width,
      unavailable: "Unavailable",
    },
  });
}

describe("native fence table", () => {
  it("fills a phone column and scrolls only when a word cannot fit", () => {
    const fitted = draw(358);
    expect(fitted.type).toBe("view");
    const mins = nodes(fitted)
      .map((node) => flatStyle(node.props.style).minWidth)
      .filter((value): value is number => typeof value === "number");
    expect(mins[0]).toBeGreaterThanOrEqual(columnFloor(["NP-complete"], TABLE_FONT_SIZE));
    expect(mins[3]).toBeGreaterThanOrEqual(columnFloor(["isomorphism"], TABLE_FONT_SIZE));
    const heads = nodes(fitted).filter(
      (node) => node.type === "text" && node.props.children === "Class",
    );
    expect(flatStyle(heads[0]?.props.style).fontWeight).toBe("600");

    const squeezed = draw(280);
    expect(squeezed.type).toBe("scroll");
    const widths = nodes(squeezed)
      .map((node) => flatStyle(node.props.style).width)
      .filter((value): value is number => typeof value === "number");
    expect(widths[0]).toBeGreaterThanOrEqual(columnFloor(["NP-complete"], TABLE_FONT_SIZE));
  });
});
