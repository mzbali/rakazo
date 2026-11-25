import { DIAGRAM_ICON_NAMES } from "@rakazo/core/visual-fence";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Diagram } from "./diagram.js";
import { DIAGRAM_ICONS, iconShapes } from "./diagram-icons.js";
import { layoutDiagram, textCentre } from "./diagram-layout.js";

describe("diagram icons", () => {
  it("draw every icon the catalog names, and nothing else", () => {
    expect(Object.keys(DIAGRAM_ICONS).sort()).toEqual([...DIAGRAM_ICON_NAMES].sort());
    for (const name of DIAGRAM_ICON_NAMES) expect(iconShapes(name)?.length).toBeGreaterThan(0);
    expect(iconShapes("constructor")).toBeUndefined();
    expect(iconShapes(undefined)).toBeUndefined();
  });

  it("leave a node without an icon exactly as it was", () => {
    const { nodes } = layoutDiagram([{ id: "a", label: "Classifier" }], [], false, false);
    expect(nodes[0]?.inset).toBe(0);
    expect(textCentre(nodes[0]!)).toBe(nodes[0]!.x + nodes[0]!.width / 2);
  });

  it("make room for the icon and centre the text in what is left", () => {
    const plain = layoutDiagram([{ id: "a", label: "Classifier" }], [], false, false).nodes[0]!;
    const iconed = layoutDiagram([{ id: "a", label: "Classifier", icon: "cpu" }], [], false, false)
      .nodes[0]!;
    expect(iconed.width).toBeGreaterThan(plain.width);
    expect(textCentre(iconed)).toBeGreaterThan(iconed.x + iconed.width / 2);
    // An unknown name draws no icon and takes no room.
    expect(
      layoutDiagram([{ id: "a", label: "Classifier", icon: "rocket" }], [], false, false).nodes[0]
        ?.inset,
    ).toBe(0);
  });

  it("draw the icon beside the label, and no icon for an unknown name", () => {
    const html = (icon: string) =>
      renderToStaticMarkup(<Diagram nodes={[{ id: "a", label: "Store", icon }]} />);
    expect(html("database")).toContain("rk-diagram-icon");
    expect(html("rocket")).not.toContain("rk-diagram-icon");
  });
});
