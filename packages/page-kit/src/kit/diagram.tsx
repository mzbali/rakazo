import { useId } from "react";
import type { DiagramEdge, DiagramNode } from "./diagram-layout.js";
import {
  curveMid,
  DETAIL_LINE,
  edgePoints,
  LABEL_LINE,
  layoutDiagram,
  PAD_Y,
  SERIES_COLORS,
} from "./diagram-layout.js";
import { objectItems } from "./items.js";
import { useWords } from "./labels.js";

export { layoutDiagram, wrapText } from "./diagram-layout.js";
export type { DiagramEdge, DiagramNode };

export function Diagram({
  nodes = [],
  edges = [],
  direction = "vertical",
}: {
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  direction?: "horizontal" | "vertical";
}) {
  const arrow = `rk-arrow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const words = useWords();
  const horizontal = direction === "horizontal";
  const links = objectItems(edges);
  const layout = layoutDiagram(
    objectItems(nodes),
    links,
    horizontal,
    links.some((edge) => edge.label),
  );
  if (!layout.nodes.length) return null;
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
    <div className="rk-diagram">
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
        <defs>
          <marker
            id={arrow}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path className="rk-diagram-arrow" d="M1 1L9 5L1 9" />
          </marker>
        </defs>
        {layout.edges.map(({ edge, from, to, backward }, index) => {
          const points = edgePoints(from, to, backward, horizontal);
          const [a, b, c, d] = points;
          const label = curveMid(a, b, c, d);
          return (
            <g key={index}>
              <path
                className="rk-diagram-edge"
                d={`M${a[0]},${a[1]}C${b[0]},${b[1]} ${c[0]},${c[1]} ${d[0]},${d[1]}`}
                strokeDasharray={edge.dashed ? "5 4" : undefined}
                markerEnd={`url(#${arrow})`}
              />
              {edge.label ? (
                <text
                  className="rk-diagram-edge-label"
                  x={label[0]}
                  y={label[1]}
                  dy="0.32em"
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {layout.nodes.map((node) => {
          const accent =
            Number.isInteger(node.series) && node.series! >= 0
              ? `var(${SERIES_COLORS[node.series! % SERIES_COLORS.length]})`
              : undefined;
          return (
            <g key={node.id}>
              <rect
                className="rk-diagram-node"
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={node.kind === "terminal" ? Math.min(node.height / 2, 22) : 10}
                style={accent ? { stroke: accent } : undefined}
              />
              {node.labelLines.map((line, index) => (
                <text
                  key={`l${index}`}
                  className="rk-diagram-label"
                  x={node.x + node.width / 2}
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
                  x={node.x + node.width / 2}
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
