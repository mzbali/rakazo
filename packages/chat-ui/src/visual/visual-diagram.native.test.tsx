import { parseVisualFence } from "@rakazo/core/visual-fence";
import { mixHex } from "@rakazo/page-kit/native";
import { tokensForAppearance } from "@rakazo/ui-tokens";
import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Callout, Diagram, drawVisual } from "./visual-view.native";

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

function tagged(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [
      ...(child.type === type ? [child] : []),
      ...tagged(child.props.children as ReactNode, type),
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

  it("stacks a reduction beside its target at a phone width", () => {
    const parse = parseVisualFence(`<Visual summary="Reduction"><Diagram direction="horizontal"
      nodes={[{id:"sudoku",label:"Sudoku"},{id:"subset",label:"Subset Sum"},{id:"tsp",label:"Travelling Salesman"},{id:"colour",label:"Graph Colouring"},{id:"sat",label:"SAT solver",detail:"Polynomial time?"}]}
      edges={[{from:"sudoku",to:"sat"},{from:"subset",to:"sat"},{from:"tsp",to:"sat"},{from:"colour",to:"sat"}]} /></Visual>`);
    const palette = tokensForAppearance("dark");
    const drawing = Diagram({
      element: parse.root!.children[0]!,
      surface: {
        palette,
        colorScheme: "dark",
        narrow: true,
        width: 360,
        unavailable: "Unavailable",
      },
    });
    expect(drawing).not.toBeNull();
    if (!drawing) return;
    const texts = textElements(drawing);
    const label = texts.find((text) => text.props.children === "Travelling Salesman");
    expect(label?.props.fontSize).toBe(17);
    const box = Number(String(drawing.props.viewBox).split(" ")[2]);
    expect((drawing.props.width as number) / box).toBeGreaterThan(0.8);
    const y = (name: string) => texts.find((text) => text.props.children === name)?.props.y;
    expect(y("Sudoku")).not.toBe(y("Subset Sum"));
    const focus = tagged(drawing, "rect").find((rect) => rect.props.strokeWidth === 2);
    expect(focus?.props.stroke).not.toBe(palette.foreground);
    expect(focus?.props.fill).not.toBe(palette.background);
  });

  it("highlights the node the author named, and falls back when that id is missing", () => {
    const source = (focus: string) =>
      parseVisualFence(`<Visual summary="Reduction"><Diagram focus="${focus}" direction="horizontal"
      nodes={[{id:"sudoku",label:"Sudoku"},{id:"subset",label:"Subset Sum"},{id:"sat",label:"SAT"}]}
      edges={[{from:"sudoku",to:"sat"},{from:"subset",to:"sat"}]} /></Visual>`);
    const surface = {
      palette: tokensForAppearance("dark"),
      colorScheme: "dark" as const,
      narrow: true,
      width: 360,
      unavailable: "Unavailable",
    };
    const stroke = (focus: string, label: string) => {
      const drawing = Diagram({ element: source(focus).root!.children[0]!, surface });
      const group = tagged(drawing, "g").find((entry) =>
        textElements(entry).some((text) => text.props.children === label),
      );
      return tagged(group ?? null, "rect")[0]?.props.strokeWidth;
    };
    expect(stroke("sudoku", "Sudoku")).toBe(2);
    expect(stroke("sudoku", "SAT")).toBe(1.25);
    expect(stroke("missing", "SAT")).toBe(2);
    expect(stroke("missing", "Sudoku")).toBe(1.25);
  });
});

describe("native figure card", () => {
  it("draws a diagram inside a hairline card with the caption inside", () => {
    const parse = parseVisualFence(
      `<Visual summary="Flow"><Diagram nodes={[{id:"a",label:"Input"},{id:"b",label:"Output"}]} edges={[{from:"a",to:"b"}]} /></Visual>`,
    );
    const palette = tokensForAppearance("dark");
    const card = drawVisual(
      { ...parse.root!.children[0]!, text: "How it moves" },
      { palette, colorScheme: "dark", narrow: true, width: 360, unavailable: "Unavailable" },
    ) as ReactElement<Record<string, unknown>>;
    expect(card.type).toBe("view");
    const styles = [card.props.style].flat(2) as {
      padding?: number;
      borderRadius?: number;
      borderWidth?: number;
      borderColor?: string;
    }[];
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ padding: 16, borderRadius: 16, borderWidth: 1 }),
        expect.objectContaining({
          borderColor: mixHex(palette.foreground, palette.background, 15),
        }),
      ]),
    );
    expect(tagged(card, "svg").length).toBeGreaterThan(0);
    expect(textElements(card).some((text) => text.props.children === "How it moves")).toBe(true);
  });
});

describe("native callout", () => {
  it("uses a hairline and an ink lead, with the tone only on the icon", () => {
    const parse = parseVisualFence(
      `<Visual summary="S"><Callout tone="success" lead="P equals NP">One circle.</Callout></Visual>`,
    );
    const palette = tokensForAppearance("dark");
    const view = Callout({
      element: parse.root!.children[0]!,
      surface: {
        palette,
        colorScheme: "dark",
        narrow: true,
        width: 360,
        unavailable: "Unavailable",
      },
    });
    const box = tagged(view, "view")[0]!;
    const styles = [box.props.style].flat(2) as {
      borderWidth?: number;
      borderColor?: string;
      backgroundColor?: string;
    }[];
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ borderWidth: 1 }),
        expect.objectContaining({ borderColor: palette.border }),
      ]),
    );
    expect(styles.some((style) => style?.backgroundColor)).toBe(false);
    const lead = textElements(view).find((text) => text.props.children === "P equals NP");
    const leadStyles = [lead?.props.style].flat(2);
    expect(leadStyles).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: palette.foreground })]),
    );
    const icon = [...tagged(view, "path"), ...tagged(view, "circle")].map(
      (shape) => shape.props.stroke,
    );
    expect(icon.length).toBeGreaterThan(0);
    expect(icon.every((stroke) => stroke !== palette.foreground && stroke !== palette.border)).toBe(
      true,
    );
  });
});
