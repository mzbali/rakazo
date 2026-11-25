import type { CSSProperties, Ref } from "react";
import { createContext, createElement, useContext } from "react";
import { useWidth } from "./dataviz/shared.js";
import type { CycleText, DiagramFlow, DiagramZone } from "./diagram-cycle.js";
import { layoutCycle } from "./diagram-cycle.js";
import { iconShapes } from "./diagram-icons.js";
import type { DiagramEdge, DiagramNode, DiagramTone } from "./diagram-layout.js";
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
export type { DiagramEdge, DiagramNode, DiagramTone };

const TONE_CSS: Record<DiagramTone, string> = {
  info: "var(--rk-accent)",
  warning: "var(--rk-warning)",
  danger: "var(--rk-danger)",
};

function toneStyle(tone?: DiagramTone): CSSProperties | undefined {
  if (!tone) return undefined;
  return { "--rk-tone": TONE_CSS[tone] } as CSSProperties;
}

function CycleLine({ line, className }: { line: CycleText; className: string }) {
  return (
    <text className={className} x={line.x} y={line.y} dy="0.35em" textAnchor={line.anchor}>
      {line.text}
    </text>
  );
}

function namedFocus(
  nodes: DiagramNode[] | undefined,
  focus: string | undefined,
  fromParent: string | undefined,
): string | undefined {
  const ids = new Set(
    (Array.isArray(nodes) ? nodes : []).flatMap((node) =>
      node && typeof node === "object" && typeof node.id === "string" ? [node.id] : [],
    ),
  );
  return [focus, fromParent].find((id) => typeof id === "string" && ids.has(id));
}

function CycleDiagram({
  nodes,
  edges,
  zones,
  flows,
  center,
  focus,
  width,
  containerRef,
}: {
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  zones?: DiagramZone[];
  flows?: DiagramFlow[];
  center?: string;
  focus?: string;
  width: number;
  containerRef: Ref<HTMLDivElement>;
}) {
  const drawn = layoutCycle(nodes, edges, { zones, flows, center, focus, width });
  if (!drawn.nodes.length) return null;
  const pad = 2;
  const description = [
    drawn.nodes.map((node) => node.lines.map((line) => line.text).join(" ")).join(", "),
    drawn.center.map((line) => line.text).join(" "),
    drawn.zones.map((zone) => zone.label.text).join(", "),
    drawn.flows.map((flow) => flow.label.text).join(", "),
  ]
    .filter((part) => part.length > 0)
    .join(". ");
  return (
    <div className="rk-diagram rk-frame" ref={containerRef}>
      <svg
        role="img"
        viewBox={`${-pad} ${-pad} ${drawn.width + pad * 2} ${drawn.height + pad * 2}`}
        style={{
          maxWidth: drawn.width + pad * 2,
          minWidth: Math.round((drawn.width + pad * 2) * 0.85),
        }}
      >
        <title>{description}</title>
        {drawn.zones.map((zone) => (
          <g key={zone.label.text} style={toneStyle(zone.tone)}>
            <rect
              className="rk-diagram-zone"
              x={zone.box.x}
              y={zone.box.y}
              width={zone.box.width}
              height={zone.box.height}
              rx={16}
            />
            <CycleLine line={zone.label} className="rk-diagram-zone-label" />
          </g>
        ))}
        {drawn.pipes.map((pipe) => (
          <g key={`${pipe.from}-${pipe.to}`} style={toneStyle(pipe.tone)}>
            <path className="rk-diagram-pipe" d={pipe.d} />
            <path className="rk-diagram-pipe-arrow" d={pipe.arrow} />
          </g>
        ))}
        {drawn.flows.map((flow) => (
          <g key={flow.label.text} style={toneStyle(flow.tone)}>
            {flow.shafts.map((d) => (
              <path key={d} className="rk-diagram-pipe" d={d} />
            ))}
            {flow.heads.map((d) => (
              <path key={d} className="rk-diagram-pipe-arrow" d={d} />
            ))}
            <CycleLine line={flow.label} className="rk-diagram-flow-label" />
          </g>
        ))}
        {drawn.nodes.map((node) => (
          <g key={node.id} style={toneStyle(node.tone)}>
            <rect
              className={node.focused ? "rk-diagram-node rk-diagram-focus" : "rk-diagram-node"}
              data-tone={node.tone}
              x={node.box.x}
              y={node.box.y}
              width={node.box.width}
              height={node.box.height}
              rx={visualLanguage.nodeRadius}
            />
            {iconShapes(node.icon) ? (
              <g
                className="rk-diagram-icon"
                data-tone={node.tone}
                transform={`translate(${node.iconAt[0]} ${node.iconAt[1]}) scale(${node.iconSize / 24})`}
              >
                {iconShapes(node.icon)!.map(([tag, attrs], index) =>
                  createElement(tag, { key: index, ...attrs }),
                )}
              </g>
            ) : null}
            {node.lines.map((line) => (
              <CycleLine key={line.text} line={line} className="rk-diagram-cycle-label" />
            ))}
            {node.badge ? (
              <g>
                <circle
                  className="rk-diagram-badge"
                  cx={node.badge.cx}
                  cy={node.badge.cy}
                  r={node.badge.r}
                />
                <text
                  className="rk-diagram-badge-num"
                  x={node.badge.cx}
                  y={node.badge.cy}
                  dy="0.35em"
                  textAnchor="middle"
                >
                  {node.badge.text}
                </text>
              </g>
            ) : null}
          </g>
        ))}
        {drawn.center.map((line) => (
          <CycleLine key={line.text} line={line} className="rk-diagram-centre" />
        ))}
      </svg>
    </div>
  );
}

/** The node id a Stages (or any parent) wants highlighted. A `focus` prop wins when it names a node. */
export const DiagramFocus = createContext<string | undefined>(undefined);

export function Diagram({
  nodes = [],
  edges = [],
  direction = "vertical",
  maxWidth,
  focus,
  layout: layoutName,
  zones,
  flows,
  center,
}: {
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  direction?: "horizontal" | "vertical";
  /** The column the drawing has to fit. When it is set, the other direction is used if it is narrower. */
  maxWidth?: number;
  /** Highlights this node. Otherwise a parent DiagramFocus, otherwise the layout's own focus. */
  focus?: string;
  /** "cycle" draws a closed loop. Anything else stays a flow. */
  layout?: "flow" | "cycle";
  /** Tinted regions behind the nodes they name. Used when layout is "cycle". */
  zones?: DiagramZone[];
  /** Labelled arrows into or out of a node. Used when layout is "cycle". */
  flows?: DiagramFlow[];
  /** Words in the middle of a cycle. */
  center?: string;
}) {
  const words = useWords();
  const fromParent = useContext(DiagramFocus);
  const measured = useWidth(360);
  if (layoutName === "cycle") {
    const width = typeof maxWidth === "number" && maxWidth > 0 ? maxWidth : measured.width;
    return (
      <CycleDiagram
        nodes={nodes}
        edges={edges}
        zones={zones}
        flows={flows}
        center={typeof center === "string" ? center : undefined}
        focus={namedFocus(nodes, focus, fromParent)}
        width={width}
        containerRef={measured.ref}
      />
    );
  }
  const links = objectItems(edges);
  const placed = objectItems(nodes);
  const labeled = links.some((edge) => edge.label);
  // The column the drawing has to fit: the author's maxWidth, else the measured card. Fitting it
  // reflows a row too wide to read into a stack, instead of letting the card scale its text down.
  // The viewBox adds `pad` on every side, so the layout uses the room inside that pad.
  const pad = 2;
  const outer = typeof maxWidth === "number" && maxWidth > 0 ? maxWidth : measured.width;
  const layout = fitDiagramLayout(
    placed,
    links,
    direction === "horizontal",
    labeled,
    Math.max(0, outer - pad * 2),
  );
  const { horizontal } = layout;
  const named = [focus, fromParent].find(
    (id) => typeof id === "string" && layout.nodes.some((node) => node.id === id),
  );
  const focusId = named ?? diagramFocusId(layout.nodes);
  if (!layout.nodes.length) return null;
  const drawn = drawEdges(layout.edges, horizontal, layout.width);

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
    <div className="rk-diagram rk-frame" ref={measured.ref}>
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
          </g>
        ))}
        {drawn.map((edge, index) => (
          <g key={`label-${index}`}>
            {edge.label && edge.labelAt ? (
              <>
                {edge.labelBox ? (
                  <rect
                    className="rk-label-back"
                    x={edge.labelBox.x}
                    y={edge.labelBox.y}
                    width={edge.labelBox.width}
                    height={edge.labelBox.height}
                    rx={4}
                  />
                ) : null}
                <text
                  className="rk-diagram-edge-label"
                  x={edge.labelAt[0]}
                  y={edge.labelAt[1]}
                  dy="0.32em"
                  textAnchor={edge.labelAnchor ?? "middle"}
                >
                  {edge.label}
                </text>
              </>
            ) : null}
          </g>
        ))}
        {layout.nodes.map((node) => {
          const accent =
            Number.isInteger(node.series) && node.series! >= 0
              ? `var(${SERIES_COLORS[node.series! % SERIES_COLORS.length]})`
              : undefined;
          const focused = node.id === focusId;
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
