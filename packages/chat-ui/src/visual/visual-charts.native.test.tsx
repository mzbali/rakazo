import { parseVisualFence } from "@rakazo/core/visual-fence";
import { pageKitPalette, tokensForAppearance } from "@rakazo/ui-tokens";
import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Pie } from "./visual-charts.native";

vi.mock("react-native", () => ({
  Platform: { select: (options: { ios: string }) => options.ios },
  StyleSheet: { create: (styles: unknown) => styles },
  View: "view",
  Text: "text",
}));
vi.mock("react-native-svg", () => ({
  default: "svg",
  G: "g",
  Path: "path",
  Rect: "rect",
  Text: "text",
  Circle: "circle",
  Ellipse: "ellipse",
  Line: "line",
}));

function tagged(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [
      ...(child.type === type ? [child] : []),
      ...tagged(child.props.children as ReactNode, type),
    ];
  });
}

describe("native pie", () => {
  it("paints the first slice with the first series color, matching the web chart", () => {
    const parts = ["Rent", "Food", "Travel", "Bills", "Savings", "Fun", "Gifts", "Health"]
      .map((label, index) => `{label:"${label}",value:${index + 1}}`)
      .join(",");
    const parse = parseVisualFence(`<Visual summary="Split"><Pie parts={[${parts}]} /></Visual>`);
    const drawing = Pie({
      element: parse.root!.children[0]!,
      surface: {
        palette: tokensForAppearance("dark"),
        colorScheme: "dark",
        narrow: true,
        width: 360,
        unavailable: "Unavailable",
      },
    });
    const strokes = tagged(drawing, "circle").map((circle) => circle.props.stroke);
    const palette = pageKitPalette.dark;
    // The first circle is the track. Slices follow in series order, then grey.
    expect(strokes.slice(1, 8)).toEqual([
      palette.c1,
      palette.c2,
      palette.c3,
      palette.c4,
      palette.c5,
      palette.c6,
      palette.c7,
    ]);
    expect(strokes[8]).toBe(palette.other);
  });
});
