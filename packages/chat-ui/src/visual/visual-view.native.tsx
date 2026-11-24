import type { VisualElement, VisualParse } from "@rakazo/core/visual-fence";
import type { DiagramEdge, DiagramNode, Placed } from "@rakazo/page-kit/native";
import {
  chevron,
  DETAIL_LINE,
  diagramFocusId,
  drawEdges,
  fitDiagramLayout,
  ICON_SIZE,
  iconOrigin,
  iconShapes,
  LABEL_LINE,
  mixHex,
  PAD_Y,
  SERIES_COLORS,
  TONE_PATHS,
  textCentre,
  visualLanguage,
} from "@rakazo/page-kit/native";
import type { ColorTokens, ResolvedAppearance } from "@rakazo/ui-tokens";
import { typeScale } from "@rakazo/ui-tokens";
import type { ReactNode } from "react";
import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { FormulaView } from "../math/math.native";
import { CopyButton, ProsCons, Status, Table } from "./visual-blocks.native";
import { Bars, LineChart, Pie } from "./visual-charts.native";
import { drawPlan, hasUnfinishedPart } from "./visual-draw";
import type { Surface } from "./visual-surface.native";
import { NARROW_WIDTH, toneColor, tones } from "./visual-surface.native";

const MONO = Platform.select({ ios: "ui-monospace", default: "monospace" });

function Note({ surface, children }: { surface: Surface; children: ReactNode }) {
  return <Text style={[styles.note, { color: surface.palette.mutedForeground }]}>{children}</Text>;
}

export function Callout({ element, surface }: { element: VisualElement; surface: Surface }) {
  const tone = element.props.tone as string | undefined;
  const color = toneColor(surface, tone);
  const lead = element.props.lead as string | undefined;
  return (
    <View style={[styles.callout, { borderColor: surface.palette.border }]}>
      {color && tone ? (
        <Svg width={16} height={16} viewBox="0 0 16 16" style={styles.calloutIcon}>
          {tone === "warning" ? (
            <Path
              d="M7.13 2.5a1 1 0 011.74 0l5.5 9.75a1 1 0 01-.87 1.5H2.5a1 1 0 01-.87-1.5z"
              stroke={color}
              strokeWidth={1.2}
              fill="none"
            />
          ) : (
            <Circle cx={8} cy={8} r={6.25} stroke={color} strokeWidth={1.2} fill="none" />
          )}
          <Path
            d={TONE_PATHS[tone] ?? ""}
            stroke={color}
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      ) : null}
      <View style={styles.calloutText}>
        {lead ? (
          <Text style={[typeScale.body, styles.lead, { color: surface.palette.foreground }]}>
            {lead}
          </Text>
        ) : null}
        {element.text ? (
          <Text style={[typeScale.body, { color: surface.palette.foreground }]}>
            {element.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Steps({ element, surface }: { element: VisualElement; surface: Surface }) {
  const steps = element.props.steps as { title: string; detail?: string }[];
  return (
    <View style={styles.steps}>
      {steps.map((step, index) => (
        <View key={index} style={styles.step}>
          <View style={[styles.stepNumber, { borderColor: surface.palette.border }]}>
            <Text style={[styles.stepNumberText, { color: surface.palette.mutedForeground }]}>
              {index + 1}
            </Text>
          </View>
          <View style={styles.stepText}>
            <Text style={[typeScale.cardTitle, { color: surface.palette.foreground }]}>
              {step.title}
            </Text>
            {step.detail ? (
              <Text style={[typeScale.secondary, { color: surface.palette.mutedForeground }]}>
                {step.detail}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

type Metric = {
  value: string | number;
  label: string;
  delta?: string | number;
  better?: "up" | "down";
  detail?: string;
  tone?: string;
};

function deltaColor(metric: Metric, surface: Surface): string {
  const palette = tones(surface);
  const delta = metric.delta;
  const sign =
    typeof delta === "number" ? Math.sign(delta) : String(delta).trim().startsWith("-") ? -1 : 1;
  if (!metric.better) return surface.palette.mutedForeground;
  const good = (metric.better === "up") === sign > 0;
  return good ? palette.success : palette.danger;
}

function Metrics({ element, surface }: { element: VisualElement; surface: Surface }) {
  const metrics = element.props.metrics as Metric[];
  const columns = Math.min(metrics.length, surface.narrow ? 2 : 4);
  const rows: Metric[][] = [];
  for (let at = 0; at < metrics.length; at += columns) rows.push(metrics.slice(at, at + columns));
  return (
    <View style={styles.metrics}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.metricRow}>
          {Array.from({ length: columns }, (_, index) => {
            const metric = row[index];
            return (
              <View key={index} style={[styles.metric, { borderColor: surface.palette.border }]}>
                {metric ? (
                  <>
                    <Text style={[styles.metricLabel, { color: surface.palette.mutedForeground }]}>
                      {metric.label}
                    </Text>
                    <Text
                      style={[
                        styles.metricValue,
                        {
                          color:
                            metric.tone === "success" ||
                            metric.tone === "warning" ||
                            metric.tone === "danger"
                              ? (toneColor(surface, metric.tone) ?? surface.palette.foreground)
                              : surface.palette.foreground,
                        },
                      ]}
                    >
                      {String(metric.value)}
                    </Text>
                    {metric.delta !== undefined ? (
                      <Text style={[typeScale.caption, { color: deltaColor(metric, surface) }]}>
                        {String(metric.delta)}
                        {metric.detail ? (
                          <Text style={{ color: surface.palette.mutedForeground }}>
                            {` ${metric.detail}`}
                          </Text>
                        ) : null}
                      </Text>
                    ) : metric.detail ? (
                      <Text style={[typeScale.caption, { color: surface.palette.mutedForeground }]}>
                        {metric.detail}
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const GRID_GAP = 16;

export function Diagram({ element, surface }: { element: VisualElement; surface: Surface }) {
  const nodes = element.props.nodes as DiagramNode[];
  const edges = (element.props.edges ?? []) as DiagramEdge[];
  // The author's direction when it fits. A column of sources beside one target fits a phone;
  // the same sources in a row do not, and scaling that row makes the words unreadably small.
  const layout = fitDiagramLayout(
    nodes,
    edges,
    element.props.direction === "horizontal",
    edges.some((edge) => edge.label),
    surface.width,
  );
  const { horizontal } = layout;
  const focus = diagramFocusId(layout.nodes);
  const pad = 2;
  const full = layout.width + pad * 2;
  const high = layout.height + pad * 2;
  // The drawing scales down to the column and never up, so text keeps its drawn size.
  const scale = surface.width > 0 ? Math.min(1, surface.width / full) : 1;
  const palette = surface.palette;
  const line = palette.faintForeground;
  const series = tones(surface);
  const seriesColors = [series.c1, series.c2, series.c3, series.c4, series.c5];
  const nodeFill = mixHex(palette.foreground, palette.background, 6);
  const focusFill = mixHex(palette.success, palette.background, visualLanguage.focusFill);
  const focusStroke = mixHex(palette.success, palette.background, visualLanguage.focusStrokeMix);
  return (
    <Svg
      width={full * scale}
      height={high * scale}
      viewBox={`${-pad} ${-pad} ${full} ${high}`}
      accessibilityLabel={layout.nodes.map((node) => node.label).join(", ")}
    >
      {drawEdges(layout.edges, horizontal).map((edge, index) => (
        <G key={index}>
          <Path
            d={edge.d}
            stroke={line}
            strokeWidth={visualLanguage.edgeWidth}
            fill="none"
            strokeDasharray={edge.dashed ? "5 4" : undefined}
          />
          {edge.arrow ? (
            <Path
              d={chevron(edge.arrow.from, edge.arrow.tip)}
              stroke={line}
              strokeWidth={visualLanguage.edgeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
          {edge.label && edge.labelAt ? (
            <G>
              {/* Native SVG paints strokes over fills: draw the halo before the ink. */}
              <SvgText
                x={edge.labelAt[0]}
                y={edge.labelAt[1] + 4}
                fontSize={12}
                fill="none"
                textAnchor="middle"
                stroke={palette.background}
                strokeWidth={5}
                strokeLinejoin="round"
                accessible={false}
              >
                {edge.label}
              </SvgText>
              <SvgText
                x={edge.labelAt[0]}
                y={edge.labelAt[1] + 4}
                fontSize={12}
                fill={palette.mutedForeground}
                textAnchor="middle"
              >
                {edge.label}
              </SvgText>
            </G>
          ) : null}
        </G>
      ))}
      {layout.nodes.map((node: Placed) => {
        const accent =
          Number.isInteger(node.series) && node.series! >= 0
            ? seriesColors[node.series! % SERIES_COLORS.length]
            : undefined;
        const focused = node.id === focus;
        return (
          <G key={node.id}>
            <Rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={
                node.kind === "terminal" ? Math.min(node.height / 2, 22) : visualLanguage.nodeRadius
              }
              fill={focused ? focusFill : nodeFill}
              stroke={focused ? focusStroke : (accent ?? palette.border)}
              strokeWidth={focused ? visualLanguage.focusStroke : 1.25}
            />
            <NodeIcon node={node} color={palette.mutedForeground} />
            {node.labelLines.map((text, index) => (
              <SvgText
                key={`l${index}`}
                x={textCentre(node)}
                y={node.y + PAD_Y + LABEL_LINE * (index + 0.5) + 5}
                fontSize={visualLanguage.labelSize}
                fontWeight={node.id === focus ? "700" : "500"}
                fill={palette.foreground}
                textAnchor="middle"
              >
                {text}
              </SvgText>
            ))}
            {node.detailLines.map((text, index) => (
              <SvgText
                key={`d${index}`}
                x={textCentre(node)}
                y={
                  node.y +
                  PAD_Y +
                  LABEL_LINE * node.labelLines.length +
                  DETAIL_LINE * (index + 0.5) +
                  4
                }
                fontSize={14}
                fill={palette.mutedForeground}
                textAnchor="middle"
              >
                {text}
              </SvgText>
            ))}
          </G>
        );
      })}
    </Svg>
  );
}

/** The icon a node names, in the same Lucide shapes the web draws, on the first label line. */
function NodeIcon({ node, color }: { node: Placed; color: string }) {
  const shapes = iconShapes(node.icon);
  if (!shapes) return null;
  const [x, y] = iconOrigin(node);
  return (
    <G
      transform={`translate(${x} ${y}) scale(${ICON_SIZE / 24})`}
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {shapes.map(([tag, attrs], index) => {
        const props = { ...attrs, ...(attrs.fill === "currentColor" ? { fill: color } : {}) };
        if (tag === "path") return <Path key={index} {...props} />;
        if (tag === "circle") return <Circle key={index} {...props} />;
        if (tag === "rect") return <Rect key={index} {...props} />;
        if (tag === "line") return <Line key={index} {...props} />;
        return <Ellipse key={index} {...props} />;
      })}
    </G>
  );
}

/** A formula in a visual, drawn by the same maths renderer as the chat's text. */
function Formula({ tex, surface }: { tex: string; surface: Surface }) {
  return (
    <FormulaView
      tex={tex}
      display
      color={surface.palette.foreground}
      fontSize={styles.formula.fontSize}
      source={
        <Text
          accessibilityLabel={tex}
          style={[styles.formula, { color: surface.palette.foreground, fontFamily: MONO }]}
        >
          {tex}
        </Text>
      }
    />
  );
}

/** The tabs that can show, a switch between them, and the chosen tab's own elements. */
function Tabs({ element, surface }: { element: VisualElement; surface: Surface }) {
  const [chosen, setChosen] = useState<string>();
  const tabs = element.children.filter((tab) => tab.state !== "invalid");
  const shown = tabs.find((tab) => tab.key === chosen) ?? tabs[0];
  const palette = surface.palette;
  return (
    <View style={styles.root}>
      {tabs.length > 0 ? (
        <View style={[styles.tabs, { backgroundColor: palette.muted }]} accessibilityRole="tablist">
          {tabs.map((tab) => {
            const on = tab === shown;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setChosen(tab.key)}
                style={[styles.tab, on ? { backgroundColor: palette.background } : null]}
              >
                <Text
                  style={[
                    typeScale.caption,
                    styles.tabText,
                    { color: on ? palette.foreground : palette.mutedForeground },
                  ]}
                >
                  {String(tab.props.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {shown ? <Draw key={shown.key} element={shown} surface={surface} /> : null}
      {element.children.some((tab) => tab.state === "invalid") ? (
        <Note surface={surface}>{surface.unavailable}</Note>
      ) : null}
    </View>
  );
}

function Draw({ element, surface }: { element: VisualElement; surface: Surface }): ReactNode {
  const plan = drawPlan(element);
  if (plan === "skip") return null;
  if (plan === "unavailable") return <Note surface={surface}>{surface.unavailable}</Note>;
  // A grid cell is narrower than the column it sits in, so a diagram scales to the cell.
  const columns =
    element.tag === "Grid"
      ? surface.narrow
        ? 1
        : ((element.props.columns as number | undefined) ?? 2)
      : 1;
  const inner =
    columns > 1
      ? { ...surface, width: (surface.width - GRID_GAP * (columns - 1)) / columns }
      : surface;
  const drawn = element.children.map((child) => (
    <Draw key={child.key} element={child} surface={inner} />
  ));
  switch (element.tag) {
    case "Visual":
      return <View style={styles.root}>{drawn}</View>;
    case "Grid": {
      const rows: ReactNode[][] = [];
      for (let at = 0; at < drawn.length; at += columns) rows.push(drawn.slice(at, at + columns));
      return (
        <View style={styles.root}>
          {rows.map((row, index) => (
            <View key={index} style={styles.gridRow}>
              {row.map((cell, cellIndex) => (
                <View key={cellIndex} style={styles.gridCell}>
                  {cell}
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }
    case "Callout":
      return <Callout element={element} surface={surface} />;
    case "Steps":
      return <Steps element={element} surface={surface} />;
    case "Metrics":
      return <Metrics element={element} surface={surface} />;
    case "Diagram":
      return <Diagram element={element} surface={surface} />;
    case "Formula":
      return <Formula tex={element.props.tex as string} surface={surface} />;
    case "Bars":
      return <Bars element={element} surface={surface} />;
    case "LineChart":
      return <LineChart element={element} surface={surface} />;
    case "Pie":
      return <Pie element={element} surface={surface} />;
    case "Table":
      return <Table element={element} surface={surface} />;
    case "ProsCons":
      return <ProsCons element={element} surface={surface} />;
    case "Status":
      return <Status element={element} surface={surface} />;
    case "CopyButton":
      return <CopyButton element={element} surface={surface} />;
    case "Tabs":
      return <Tabs element={element} surface={surface} />;
    case "Tab":
      return <View style={styles.root}>{drawn}</View>;
    default:
      return null;
  }
}

/** The visual a ```ui fence describes, drawn with native views on the chat background. */
export default function VisualView({
  parse,
  streaming,
  palette,
  colorScheme,
  unavailable,
}: {
  parse: VisualParse & { root: VisualElement };
  streaming: boolean;
  palette: ColorTokens;
  colorScheme: ResolvedAppearance;
  unavailable: string;
}) {
  const [width, setWidth] = useState(0);
  const surface: Surface = {
    palette,
    colorScheme,
    narrow: width > 0 && width < NARROW_WIDTH,
    width,
    unavailable,
  };
  const unfinished = hasUnfinishedPart(parse);
  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={styles.host}
    >
      {width > 0 ? (
        <>
          <Draw element={parse.root} surface={surface} />
          {streaming && !parse.truncated && unfinished ? (
            <View style={[styles.pending, { backgroundColor: palette.muted }]} />
          ) : null}
          {parse.truncated || (!streaming && unfinished) ? (
            <Note surface={surface}>{unavailable}</Note>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { alignSelf: "stretch", marginVertical: 8, gap: 16 },
  root: { gap: 16 },
  note: { fontSize: typeScale.caption.fontSize, lineHeight: typeScale.caption.lineHeight },
  pending: { height: 24, borderRadius: 6 },
  callout: {
    flexDirection: "row",
    gap: 10,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
  },
  calloutIcon: { marginTop: 3 },
  calloutText: { flex: 1, gap: 2 },
  lead: { fontWeight: "600" },
  steps: { gap: 18 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  stepNumberText: { fontSize: 14, fontWeight: "500" },
  stepText: { flex: 1 },
  metrics: { gap: 12 },
  metricRow: { flexDirection: "row", gap: 12 },
  metric: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  metricValue: { fontSize: 40, lineHeight: 44, fontWeight: "600", marginTop: 6 },
  gridRow: { flexDirection: "row", gap: GRID_GAP },
  gridCell: { flex: 1, minWidth: 0 },
  formula: { fontSize: 15, lineHeight: 24 },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignSelf: "flex-start",
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  tab: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  tabText: { fontWeight: "500" },
});
