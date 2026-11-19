import type { VisualElement, VisualParse } from "@rakazo/core/visual-fence";
import type { DiagramEdge, DiagramNode, Placed, Point } from "@rakazo/page-kit/native";
import {
  curveMid,
  DETAIL_LINE,
  edgePoints,
  LABEL_LINE,
  layoutDiagram,
  PAD_Y,
  SERIES_COLORS,
  TONE_PATHS,
} from "@rakazo/page-kit/native";
import type { ColorTokens, ResolvedAppearance } from "@rakazo/ui-tokens";
import { pageKitPalette, typeScale } from "@rakazo/ui-tokens";
import type { ReactNode } from "react";
import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";
import { FormulaView } from "../math/math.native";
import { drawPlan, hasUnfinishedPart } from "./visual-draw";

/** Below this width a wide figure lays out as a narrow one. */
const NARROW_WIDTH = 480;
const MONO = Platform.select({ ios: "ui-monospace", default: "monospace" });
const SUBTLE_ALPHA = { dark: "2c", light: "17" };

type Surface = {
  palette: ColorTokens;
  colorScheme: ResolvedAppearance;
  narrow: boolean;
  width: number;
  unavailable: string;
};

const tones = (surface: Surface) =>
  pageKitPalette[surface.colorScheme === "light" ? "light" : "dark"];

function toneColor(surface: Surface, tone: string | undefined): string | undefined {
  const palette = tones(surface);
  if (tone === "info" || tone === "accent") return palette.accent;
  if (tone === "success") return palette.success;
  if (tone === "warning") return palette.warning;
  if (tone === "danger") return palette.danger;
  return undefined;
}

const subtle = (color: string, surface: Surface) =>
  `${color.slice(0, 7)}${SUBTLE_ALPHA[surface.colorScheme === "light" ? "light" : "dark"]}`;

function Note({ surface, children }: { surface: Surface; children: ReactNode }) {
  return <Text style={[styles.note, { color: surface.palette.mutedForeground }]}>{children}</Text>;
}

function Callout({ element, surface }: { element: VisualElement; surface: Surface }) {
  const tone = element.props.tone as string | undefined;
  const color = toneColor(surface, tone);
  const lead = element.props.lead as string | undefined;
  return (
    <View
      style={[
        styles.callout,
        { backgroundColor: color ? subtle(color, surface) : surface.palette.muted },
      ]}
    >
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
          <Text
            style={[typeScale.body, styles.lead, { color: color ?? surface.palette.foreground }]}
          >
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
          <View style={[styles.stepNumber, { backgroundColor: surface.palette.muted }]}>
            <Text style={[styles.stepNumberText, { color: surface.palette.foreground }]}>
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
              <View key={index} style={styles.metric}>
                {metric ? (
                  <>
                    <Text
                      style={[
                        typeScale.title,
                        styles.metricValue,
                        { color: surface.palette.foreground },
                      ]}
                    >
                      {String(metric.value)}
                    </Text>
                    <Text style={[typeScale.caption, { color: surface.palette.foreground }]}>
                      {metric.label}
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
                      <Text
                        style={[
                          typeScale.caption,
                          {
                            color:
                              toneColor(surface, metric.tone) ?? surface.palette.mutedForeground,
                          },
                        ]}
                      >
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

const ARROW = 7;
const GRID_GAP = 16;

function Diagram({ element, surface }: { element: VisualElement; surface: Surface }) {
  const nodes = element.props.nodes as DiagramNode[];
  const edges = (element.props.edges ?? []) as DiagramEdge[];
  // A flow written left to right reads top to bottom in a narrow column.
  const horizontal = !surface.narrow && element.props.direction === "horizontal";
  const layout = layoutDiagram(
    nodes,
    edges,
    horizontal,
    edges.some((edge) => edge.label),
  );
  const pad = 2;
  const full = layout.width + pad * 2;
  const high = layout.height + pad * 2;
  // The drawing scales down to the column and never up, so text keeps its drawn size.
  const scale = surface.width > 0 ? Math.min(1, surface.width / full) : 1;
  const palette = surface.palette;
  const line = palette.faintForeground;
  const series = tones(surface);
  const seriesColors = [series.c1, series.c2, series.c3, series.c4, series.c5];
  return (
    <Svg
      width={full * scale}
      height={high * scale}
      viewBox={`${-pad} ${-pad} ${full} ${high}`}
      accessibilityLabel={layout.nodes.map((node) => node.label).join(", ")}
    >
      {layout.edges.map(({ edge, from, to, backward }, index) => {
        const [a, b, c, d] = edgePoints(from, to, backward, horizontal);
        const label = curveMid(a, b, c, d);
        const angle = Math.atan2(d[1] - c[1], d[0] - c[0]);
        const wing = (turn: number): Point => [
          d[0] - ARROW * Math.cos(angle + turn),
          d[1] - ARROW * Math.sin(angle + turn),
        ];
        const [left, right] = [wing(0.5), wing(-0.5)];
        return (
          <G key={index}>
            <Path
              d={`M${a[0]},${a[1]}C${b[0]},${b[1]} ${c[0]},${c[1]} ${d[0]},${d[1]}`}
              stroke={line}
              strokeWidth={1.5}
              fill="none"
              strokeDasharray={edge.dashed ? "5 4" : undefined}
            />
            <Path
              d={`M${left[0]},${left[1]}L${d[0]},${d[1]}L${right[0]},${right[1]}`}
              stroke={line}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {edge.label ? (
              <SvgText
                x={label[0]}
                y={label[1] + 4}
                fontSize={12}
                fill={palette.mutedForeground}
                textAnchor="middle"
                stroke={palette.background}
                strokeWidth={5}
                strokeLinejoin="round"
                // The halo keeps the label readable where it crosses a curve.
                fillOpacity={1}
              >
                {edge.label}
              </SvgText>
            ) : null}
          </G>
        );
      })}
      {layout.nodes.map((node: Placed) => {
        const accent =
          Number.isInteger(node.series) && node.series! >= 0
            ? seriesColors[node.series! % SERIES_COLORS.length]
            : undefined;
        return (
          <G key={node.id}>
            <Rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={node.kind === "terminal" ? Math.min(node.height / 2, 22) : 10}
              fill={palette.background}
              stroke={accent ?? palette.border}
              strokeWidth={1.25}
            />
            {node.labelLines.map((text, index) => (
              <SvgText
                key={`l${index}`}
                x={node.x + node.width / 2}
                y={node.y + PAD_Y + LABEL_LINE * (index + 0.5) + 5}
                fontSize={14}
                fontWeight="500"
                fill={palette.foreground}
                textAnchor="middle"
              >
                {text}
              </SvgText>
            ))}
            {node.detailLines.map((text, index) => (
              <SvgText
                key={`d${index}`}
                x={node.x + node.width / 2}
                y={
                  node.y +
                  PAD_Y +
                  LABEL_LINE * node.labelLines.length +
                  DETAIL_LINE * (index + 0.5) +
                  4
                }
                fontSize={12.5}
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
  callout: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12 },
  calloutIcon: { marginTop: 3 },
  calloutText: { flex: 1, gap: 2 },
  lead: { fontWeight: "600" },
  steps: { gap: 14 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { fontSize: 13, fontWeight: "500" },
  stepText: { flex: 1 },
  metrics: { gap: 18 },
  metricRow: { flexDirection: "row", gap: 16 },
  metric: { flex: 1, minWidth: 0 },
  metricValue: { fontWeight: "500" },
  gridRow: { flexDirection: "row", gap: GRID_GAP },
  gridCell: { flex: 1, minWidth: 0 },
  formula: { fontSize: 15, lineHeight: 24 },
});
