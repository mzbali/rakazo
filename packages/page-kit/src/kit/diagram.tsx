import { createElement } from "react";
import { iconShapes } from "./diagram-icons.js";
import type { DiagramEdge, DiagramNode } from "./diagram-layout.js";
import {
  chevron,
  DETAIL_LINE,
  diagramFocusId,
  drawEdges,
  fitDiagramLayout,
  ICON_SIZE,
  iconOrigin,
  LABEL_LINE,
  PAD_Y,
  SERIES_COLORS,
  textCentre,
} from "./diagram-layout.js";
import { objectItems } from "./items.js";
import { useWords } from "./labels.js";
import { visualLanguage } from "./visual-language.js";

export { fitDiagramLayout, layoutDiagram, wrapText } from "./diagram-layout.js";
export type { DiagramEdge, DiagramNode };

export function Diagram({
  nodes = [],
  edges = [],
  direction = "vertical",
  maxWidth,
}: {
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  direction?: "horizontal" | "vertical";
  /** The column the drawing has to fit. When it is set, the other direction is used if it is narrower. */
  maxWidth?: number;
}) {
  const words = useWords();
  const links = objectItems(edges);
  const placed = objectItems(nodes);
  const labeled = links.some((edge) => edge.label);
  const layout = fitDiagramLayout(
    placed,
    links,
    direction === "horizontal",
    labeled,
    maxWidth ?? 0,
  );
  const { horizontal } = layout;
  const focus = diagramFocusId(layout.nodes);
  if (!layout.nodes.length) return null;
  const drawn = drawEdges(layout.edges, horizontal);
  const pad = 2;
  const name = (id: string) => layout.nodes.find((node) => node.id === id)?.label ?? id;
  const description = [
    layout.nodes.map((node) => node.label).join(", "),
    ...layout.edges.map(({ edge }) =>
      words.t(edge.label ? "edgeLabeled" : "edge", {
        from: name(edge.from),
        to: name(edge.to),
        label: edge.label ?? "",
      }),
    ),
  ].join(". ");
  return (
    <div className="rk-diagram rk-frame">
      <svg
        role="img"
        viewBox={`${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`}
        // Below 85% its text gets too small to read, so a narrow column scrolls it instead.
        style={{
          maxWidth: layout.width + pad * 2,
          minWidth: Math.round((layout.width + pad * 2) * 0.85),
        }}
      >
        <title>{description}</title>
        {drawn.map((edge, index) => (
          <g key={index}>
            <path
              className="rk-diagram-edge"
              d={edge.d}
              strokeDasharray={edge.dashed ? "5 4" : undefined}
            />
            {edge.arrow ? (
              <path className="rk-diagram-arrow" d={chevron(edge.arrow.from, edge.arrow.tip)} />
            ) : null}
            {edge.label && edge.labelAt ? (
              <text
                className="rk-diagram-edge-label"
                x={edge.labelAt[0]}
                y={edge.labelAt[1]}
                dy="0.32em"
                textAnchor="middle"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        ))}
        {layout.nodes.map((node) => {
          const accent =
            Number.isInteger(node.series) && node.series! >= 0
              ? `var(${SERIES_COLORS[node.series! % SERIES_COLORS.length]})`
              : undefined;
          const focused = node.id === focus;
          return (
            <g key={node.id}>
              <rect
                className={focused ? "rk-diagram-node rk-diagram-focus" : "rk-diagram-node"}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={
                  node.kind === "terminal"
                    ? Math.min(node.height / 2, 22)
                    : visualLanguage.nodeRadius
                }
                style={focused || !accent ? undefined : { stroke: accent }}
              />
              {iconShapes(node.icon) ? (
                <g
                  className="rk-diagram-icon"
                  transform={`translate(${iconOrigin(node)[0]} ${iconOrigin(node)[1]}) scale(${ICON_SIZE / 24})`}
                >
                  {iconShapes(node.icon)!.map(([tag, attrs], index) =>
                    createElement(tag, { key: index, ...attrs }),
                  )}
                </g>
              ) : null}
              {node.labelLines.map((line, index) => (
                <text
                  key={`l${index}`}
                  className={
                    focused ? "rk-diagram-label rk-diagram-focus-label" : "rk-diagram-label"
                  }
                  x={textCentre(node)}
                  y={node.y + PAD_Y + LABEL_LINE * (index + 0.5)}
                  dy="0.35em"
                  textAnchor="middle"
                >
                  {line}
                </text>
              ))}
              {node.detailLines.map((line, index) => (
                <text
                  key={`d${index}`}
                  className="rk-diagram-detail"
                  x={textCentre(node)}
                  y={
                    node.y +
                    PAD_Y +
                    LABEL_LINE * node.labelLines.length +
                    DETAIL_LINE * (index + 0.5)
                  }
                  dy="0.35em"
                  textAnchor="middle"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
