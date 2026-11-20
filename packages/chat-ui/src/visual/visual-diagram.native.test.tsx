import { parseVisualFence } from "@rakazo/core/visual-fence";
import { tokensForAppearance } from "@rakazo/ui-tokens";
import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Diagram } from "./visual-view.native";

vi.mock("react-native", () => ({
  Platform: { select: (options: { ios: string }) => options.ios },
  StyleSheet: { create: (styles: unknown) => styles },
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
vi.mock("../math/math.native", () => ({ FormulaView: () => null }));
vi.mock("./visual-blocks.native", () => ({
  CopyButton: () => null,
  ProsCons: () => null,
  Status: () => null,
  Table: () => null,
}));

function textElements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [
      ...(child.type === "text" ? [child] : []),
      ...textElements(child.props.children as ReactNode),
    ];
  });
}

describe("native diagram edge labels", () => {
  it.each(["dark", "light"] as const)("paints readable ink over each halo in %s", (colorScheme) => {
    // The reported phone topology, with generic names for a public fixture.
    const parse = parseVisualFence(`<Visual summary="Infrastructure"><Diagram direction="vertical"
      nodes={[{id:"app",label:"App",detail:"Test VM",icon:"cpu"},{id:"dns",label:"DNS",detail:"Production VM",icon:"shield"},{id:"proxy",label:"Proxy",detail:"Reverse proxy",icon:"globe"},{id:"crawler",label:"Crawler",detail:"Proposed",icon:"file"}]}
      edges={[{from:"app",to:"dns",label:"DNS lookup"},{from:"app",to:"proxy",label:"HTTPS request"},{from:"proxy",to:"crawler",label:"Proposed route"}]} /></Visual>`);
    const palette = tokensForAppearance(colorScheme);
    const drawing = Diagram({
      element: parse.root!.children[0]!,
      surface: { palette, colorScheme, narrow: true, width: 340, unavailable: "Unavailable" },
    });
    const texts = textElements(drawing);
    for (const label of ["DNS lookup", "HTTPS request", "Proposed route"]) {
      const layers = texts.filter((text) => text.props.children === label);
      expect(layers).toHaveLength(2);
      const halo = layers[0]!.props;
      const ink = layers.at(-1)!.props;
      expect(halo.fill).toBe("none");
      expect(halo.stroke).toBe(palette.background);
      expect(halo.strokeWidth).toBe(5);
      expect(halo.accessible).toBe(false);
      expect([ink.x, ink.y, ink.fontSize]).toEqual([halo.x, halo.y, halo.fontSize]);
      // A thick stroke painted after the fill covers the letters on iOS.
      expect(ink.fill).toBe(palette.mutedForeground);
      expect(ink.stroke ?? "none").toBe("none");
      expect(ink.strokeWidth ?? 0).toBe(0);
    }
  });
});
