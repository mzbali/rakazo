import type { VisualElement } from "@rakazo/core/visual-fence";
import { nativeWords } from "@rakazo/page-kit/native";
import { typeScale } from "@rakazo/ui-tokens";
import { useContext } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { CodeCopyButtonContext } from "../native/code";
import type { Surface } from "./visual-surface.native";
import { NARROW_WIDTH, subtle, toneColor, tones } from "./visual-surface.native";

const words = nativeWords;
const MONO = Platform.select({ ios: "ui-monospace", default: "monospace" });
/** A table of this many columns or more scrolls sideways on a phone. */
const WIDE_COLUMNS = 5;
const WIDE_COLUMN_WIDTH = 112;
// Amounts written as text ("$1,200", "4.8%", "12k") line up with the figures, as on the web.
const FIGURE = /^[-+−±]?[$€£¥₹]?\d[\d,.]*(%|[kKMB])?$/;

type Cell = string | number | { text: string; tone?: string };

const cellText = (cell: Cell | undefined) =>
  cell === undefined ? "" : typeof cell === "object" ? cell.text : String(cell);
const isFigure = (cell: Cell | undefined) =>
  typeof cell === "number" || FIGURE.test(cellText(cell).trim());

export function Table({ element, surface }: { element: VisualElement; surface: Surface }) {
  const columns = element.props.columns as string[];
  const rows = element.props.rows as Cell[][];
  const align = (element.props.align ?? []) as string[];
  const emphasis = element.props.emphasis as number | undefined;
  const palette = surface.palette;
  const ends = columns.map((_, index) => {
    if (align[index]) return align[index] === "end";
    const cells = rows.map((row) => row[index]);
    return (
      cells.every((cell) => cell === undefined || cellText(cell) === "" || isFigure(cell)) &&
      cells.some((cell) => isFigure(cell))
    );
  });
  const textAlign = (index: number) =>
    align[index] === "center" ? "center" : ends[index] ? "right" : "left";
  // A grid cell is narrower than the column, so the cell's own width decides.
  const wide = columns.length >= WIDE_COLUMNS && surface.width < NARROW_WIDTH;
  const cell = () => [styles.cell, wide ? { width: WIDE_COLUMN_WIDTH } : null];
  const table = (
    <View style={styles.table}>
      <View style={[styles.row, { borderBottomColor: palette.border }]}>
        {columns.map((column, index) => (
          <View key={index} style={cell()}>
            <Text
              style={[
                typeScale.footnote,
                styles.head,
                { color: palette.mutedForeground, textAlign: textAlign(index) },
              ]}
            >
              {column}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={[styles.row, { borderBottomColor: palette.border }]}>
          {columns.map((_, index) => {
            const value = row[index];
            const color =
              typeof value === "object"
                ? (toneColor(surface, value.tone === "neutral" ? undefined : value.tone) ??
                  palette.foreground)
                : palette.foreground;
            return (
              <View key={index} style={cell()}>
                <Text
                  style={[
                    typeScale.secondary,
                    {
                      color,
                      textAlign: textAlign(index),
                      fontWeight: emphasis === index ? "600" : "400",
                    },
                  ]}
                >
                  {cellText(value)}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
  return wide ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {table}
    </ScrollView>
  ) : (
    table
  );
}

export function ProsCons({ element, surface }: { element: VisualElement; surface: Surface }) {
  const palette = surface.palette;
  const columns = [
    {
      heading: (element.props.prosHeading as string | undefined) ?? words.t("pros"),
      items: element.props.pros as string[] | undefined,
      mark: "+",
      color: tones(surface).success,
    },
    {
      heading: (element.props.consHeading as string | undefined) ?? words.t("cons"),
      items: element.props.cons as string[] | undefined,
      mark: "−",
      color: tones(surface).danger,
    },
  ].filter((column) => column.items?.length);
  return (
    <View style={[styles.proscons, surface.narrow ? null : styles.prosconsWide]}>
      {columns.map((column) => (
        <View
          key={column.mark}
          style={[
            styles.card,
            surface.narrow ? null : styles.cardWide,
            { backgroundColor: palette.muted },
          ]}
        >
          <Text style={[typeScale.cardTitle, { color: palette.foreground }]}>{column.heading}</Text>
          {column.items!.map((item, index) => (
            <View key={index} style={styles.point}>
              <Text style={[typeScale.body, styles.mark, { color: column.color }]}>
                {column.mark}
              </Text>
              <Text style={[typeScale.body, styles.pointText, { color: palette.foreground }]}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function Status({ element, surface }: { element: VisualElement; surface: Surface }) {
  const color = toneColor(surface, element.props.tone as string | undefined);
  const palette = surface.palette;
  return (
    <View
      style={[styles.pill, { backgroundColor: color ? subtle(color, surface) : palette.muted }]}
    >
      <View style={[styles.dot, { backgroundColor: color ?? palette.faintForeground }]} />
      <Text style={[typeScale.caption, styles.pillText, { color: color ?? palette.foreground }]}>
        {element.text}
      </Text>
    </View>
  );
}

/** The text is always shown; the app's own copy control, when it has one, sits beside it. */
export function CopyButton({ element, surface }: { element: VisualElement; surface: Surface }) {
  const Copy = useContext(CodeCopyButtonContext);
  const text = element.props.text as string;
  const palette = surface.palette;
  return (
    <View style={styles.copy}>
      <Text style={[typeScale.footnote, { color: palette.mutedForeground }]}>
        {element.props.label as string}
      </Text>
      <View style={[styles.copyRow, { backgroundColor: palette.muted }]}>
        <Text
          selectable
          style={[
            typeScale.secondary,
            styles.copyText,
            { color: palette.foreground, fontFamily: MONO },
          ]}
        >
          {text}
        </Text>
        {Copy ? <Copy code={text} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { alignSelf: "stretch" },
  row: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cell: { flex: 1, minWidth: 0 },
  head: { fontWeight: "500" },
  proscons: { gap: 12 },
  prosconsWide: { flexDirection: "row" },
  card: { borderRadius: 12, padding: 14, gap: 8 },
  cardWide: { flex: 1 },
  point: { flexDirection: "row", gap: 8 },
  mark: { width: 14, fontWeight: "600" },
  pointText: { flex: 1 },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontWeight: "500" },
  copy: { gap: 4 },
  copyRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 10 },
  copyText: { flex: 1 },
});
