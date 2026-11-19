import type { VisualElement } from "@rakazo/core/visual-fence";
import { axisGutter, finite, formatValue, valueScale, wordsFor } from "@rakazo/page-kit/native";
import { typeScale } from "@rakazo/ui-tokens";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import type { Surface } from "./visual-surface.native";
import { tones } from "./visual-surface.native";

const words = wordsFor(undefined);

/** Three named hues, then everything else in one neutral grey, as the web kit draws them. */
function seriesColor(surface: Surface, index: number): string {
  const palette = tones(surface);
  return [palette.c1, palette.c2, palette.c3][index] ?? palette.other;
}

type Bar = { label: string; value: number; display?: string };

export function Bars({ element, surface }: { element: VisualElement; surface: Surface }) {
  const bars = element.props.bars as Bar[];
  const values = bars.map((bar) => bar.value);
  const max = Math.max(0, ...values.map(Math.abs));
  const emphasis = element.props.emphasis as number | "none" | undefined;
  // The longest bar, negative or not, since a bar's length is its size.
  const chosen = emphasis ?? values.map(Math.abs).indexOf(max);
  const palette = surface.palette;
  return (
    <View style={styles.bars}>
      {bars.map((bar, index) => {
        const share = max > 0 ? Math.min(1, Math.abs(bar.value) / max) : 0;
        const inked = chosen === "none" || chosen === index;
        return (
          <View key={index} style={styles.bar}>
            <Text
              style={[typeScale.caption, styles.barLabel, { color: palette.foreground }]}
              numberOfLines={2}
            >
              {bar.label}
            </Text>
            <View style={[styles.track, { backgroundColor: palette.muted }]}>
              <View
                style={{
                  width: `${share * 100}%`,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor:
                    bar.value < 0
                      ? tones(surface).negative
                      : inked
                        ? palette.foreground
                        : palette.faintForeground,
                }}
              />
            </View>
            <Text
              style={[
                typeScale.caption,
                styles.barValue,
                { color: bar.value < 0 ? tones(surface).danger : palette.mutedForeground },
              ]}
            >
              {bar.display ?? formatValue(bar.value, undefined, undefined, words)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

type Series = { name?: string; values: (number | undefined)[] };

/** Path through the finite values; a missing value breaks the line instead of bridging it. */
function linePath(
  values: (number | undefined)[],
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let path = "";
  let pen = false;
  values.forEach((value, index) => {
    if (!finite(value)) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}

const PLOT = { top: 10, bottom: 22, right: 4 };

export function LineChart({ element, surface }: { element: VisualElement; surface: Surface }) {
  const points = element.props.points as { label?: string; value: number }[];
  const extra = (element.props.lines ?? []) as { label?: string; values: number[] }[];
  const names = (element.props.labels ?? []) as string[];
  const unit = element.props.unit as string | undefined;
  const series: Series[] = [
    { name: names[0], values: points.map((point) => point.value) },
    ...extra.map((line, index) => ({ name: line.label ?? names[index + 1], values: line.values })),
  ];
  const count = Math.max(...series.map((entry) => entry.values.length));
  const scale = valueScale(
    series.flatMap((entry) => entry.values.filter(finite)),
    element.props.floor as number | undefined,
    element.props.ceiling as number | undefined,
  );
  const label = (value: number) => formatValue(value, unit, undefined, words);
  const palette = surface.palette;
  const width = Math.max(surface.width, 160);
  const height = width >= 480 ? 264 : 220;
  const left = axisGutter(scale.ticks.map(label));
  const right = width - PLOT.right;
  const baseline = height - PLOT.bottom;
  const x = (index: number) =>
    left + (count > 1 ? (index / (count - 1)) * (right - left) : (right - left) / 2);
  const y = (value: number) =>
    baseline -
    ((Math.min(scale.high, Math.max(scale.low, value)) - scale.low) / (scale.high - scale.low)) *
      (baseline - PLOT.top);
  const tickLabels = points.map((point) => point.label ?? "");
  // First, last and a few between that fit, never two crowded together.
  const room = Math.max(1, Math.floor((right - left) / 64));
  const step = Math.max(1, Math.ceil((count - 1) / Math.max(1, room - 1)));
  const shown = tickLabels.flatMap((text, index) =>
    text && (index === count - 1 || (index % step === 0 && count - 1 - index >= step / 2))
      ? [index]
      : [],
  );
  const primary = series[0]!.values;
  const whole = series.length === 1 && primary.length > 1;
  const area = whole
    ? `${linePath(primary, x, y)}L${x(primary.length - 1)} ${y(Math.max(scale.low, Math.min(scale.high, 0)))}L${x(0)} ${y(Math.max(scale.low, Math.min(scale.high, 0)))}Z`
    : "";
  const summary = series
    .map(
      (entry, index) =>
        `${entry.name ?? (index ? `${index + 1}` : "")}: ${entry.values
          .map((value, at) => `${tickLabels[at] || at + 1} ${finite(value) ? label(value) : ""}`)
          .join(", ")}`,
    )
    .join(". ");
  const named = series.filter((entry) => entry.name);
  return (
    <View style={styles.chart}>
      {named.length > 0 ? (
        <View style={styles.legend}>
          {series.map((entry, index) =>
            entry.name ? (
              <View key={index} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: seriesColor(surface, index) }]} />
                <Text style={[typeScale.footnote, { color: palette.mutedForeground }]}>
                  {entry.name}
                </Text>
              </View>
            ) : null,
          )}
        </View>
      ) : null}
      <Svg width={width} height={height} accessibilityLabel={summary}>
        {scale.ticks.map((tick) => (
          <Gridline
            key={tick}
            y={y(tick)}
            left={left}
            right={right}
            label={label(tick)}
            surface={surface}
          />
        ))}
        {shown.map((index) => (
          <SvgText
            key={index}
            x={x(index)}
            y={height - 6}
            fontSize={11}
            fill={palette.mutedForeground}
            textAnchor={index === 0 && count > 1 ? "start" : index === count - 1 ? "end" : "middle"}
          >
            {tickLabels[index]}
          </SvgText>
        ))}
        {area ? (
          <Path d={area} fill={seriesColor(surface, 0)} fillOpacity={Number(tones(surface).area)} />
        ) : null}
        {series.map((entry, index) => (
          <Path
            key={index}
            d={linePath(entry.values, x, y)}
            stroke={seriesColor(surface, index)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {series.map((entry, index) =>
          entry.values.map((value, at) =>
            finite(value) && (series.length > 1 || entry.values.length === 1) ? (
              <Circle
                key={`${index}-${at}`}
                cx={x(at)}
                cy={y(value)}
                r={entry.values.length === 1 ? 3.5 : 2.5}
                fill={seriesColor(surface, index)}
              />
            ) : null,
          ),
        )}
      </Svg>
    </View>
  );
}

/** One horizontal gridline with its value at the start. */
function Gridline({
  y,
  left,
  right,
  label,
  surface,
}: {
  y: number;
  left: number;
  right: number;
  label: string;
  surface: Surface;
}) {
  return (
    <>
      <Line
        x1={left}
        x2={right}
        y1={y}
        y2={y}
        stroke={surface.palette.border}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <SvgText
        x={left - 8}
        y={y + 4}
        fontSize={11}
        fill={surface.palette.mutedForeground}
        textAnchor="end"
      >
        {label}
      </SvgText>
    </>
  );
}

type PiePart = { label: string; value: number; display?: string };

const PIE_SIZE = 120;
const PIE_RING = 24;
const PIE_GAP = 2;
/** With many parts, slivers under 2% fold into one "Other" slice, as on the web. */
const FOLD_OVER = 8;

export function Pie({ element, surface }: { element: VisualElement; surface: Surface }) {
  const valid = (element.props.parts as PiePart[]).filter((part) => part.value > 0);
  const sum = valid.reduce((total, part) => total + part.value, 0);
  let parts = valid;
  if (valid.length > FOLD_OVER) {
    const small = valid.filter((part) => part.value / sum < 0.02);
    if (small.length > 1)
      parts = [
        ...valid.filter((part) => part.value / sum >= 0.02),
        { label: words.t("other"), value: small.reduce((total, part) => total + part.value, 0) },
      ];
  }
  if (parts.length === 0 || !Number.isFinite(sum)) return null;
  const palette = surface.palette;
  const radius = (PIE_SIZE - PIE_RING) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = element.props.total as true | string | undefined;
  const heading = element.props.label as string | undefined;
  const percent = (share: number) =>
    share < 0.01
      ? `<${words.number(0.01, { style: "percent" })}`
      : words.number(share, { style: "percent", maximumFractionDigits: 0 });
  let start = 0;
  const slices = parts.map((part, index) => {
    const share = part.value / sum;
    const slice = { part, share, start, color: seriesColor(surface, index) };
    start += share;
    return slice;
  });
  const largest = parts.reduce(
    (best, part, index) => (part.value > parts[best]!.value ? index : best),
    0,
  );
  return (
    <View style={styles.pie}>
      <Svg
        width={PIE_SIZE}
        height={PIE_SIZE}
        accessibilityLabel={`${heading ? `${heading}: ` : ""}${slices
          .map(
            ({ part, share }) => `${part.label} ${part.display ?? part.value}, ${percent(share)}`,
          )
          .join("; ")}`}
      >
        <Circle
          cx={PIE_SIZE / 2}
          cy={PIE_SIZE / 2}
          r={radius}
          fill="none"
          stroke={palette.muted}
          strokeWidth={PIE_RING}
        />
        {slices.map(({ share, start: from, color }, index) => (
          <Circle
            key={index}
            cx={PIE_SIZE / 2}
            cy={PIE_SIZE / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={PIE_RING}
            strokeDasharray={`${Math.max(share * circumference - (slices.length > 1 ? PIE_GAP : 0), 0.5)} ${circumference}`}
            strokeDashoffset={-from * circumference}
            transform={`rotate(-90 ${PIE_SIZE / 2} ${PIE_SIZE / 2})`}
          />
        ))}
        {total !== undefined ? (
          <SvgText
            x={PIE_SIZE / 2}
            y={PIE_SIZE / 2 + (heading ? 0 : 5)}
            fontSize={15}
            fontWeight="500"
            fill={palette.foreground}
            textAnchor="middle"
          >
            {total === true ? formatValue(sum, undefined, undefined, words) : total}
          </SvgText>
        ) : null}
        {total !== undefined && heading ? (
          <SvgText
            x={PIE_SIZE / 2}
            y={PIE_SIZE / 2 + 15}
            fontSize={11}
            fill={palette.mutedForeground}
            textAnchor="middle"
          >
            {heading}
          </SvgText>
        ) : null}
      </Svg>
      <View style={styles.pieLegend}>
        {slices.map(({ part, share, color }, index) => (
          <View key={index} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: color }]} />
            <Text
              style={[
                typeScale.caption,
                styles.pieLabel,
                {
                  color: palette.foreground,
                  fontWeight: index === largest ? "600" : "400",
                },
              ]}
              numberOfLines={2}
            >
              {part.display ?? formatValue(part.value, undefined, undefined, words)} {part.label}
            </Text>
            <Text style={[typeScale.caption, { color: palette.mutedForeground }]}>
              {percent(share)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { gap: 10 },
  bar: { flexDirection: "row", alignItems: "center", gap: 10 },
  barLabel: { width: "28%" },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  barValue: { minWidth: 44, textAlign: "right" },
  chart: { gap: 8 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  pie: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" },
  pieLegend: { flex: 1, minWidth: 140, gap: 6 },
  pieLabel: { flex: 1 },
});
