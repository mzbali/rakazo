/**
 * One set of sizes for every drawn visual, on the web and on the phone.
 * Colour stays in tokens: a mix of `--success` for the one highlight, `--rk-c1` for a series.
 */

export const visualLanguage = {
  cardRadius: 16,
  metricRadius: 16,
  cardPadding: 16,
  nodeRadius: 12,
  nodeGap: 18,
  nodePadY: 16,
  labelLine: 24,
  detailLine: 20,
  labelSize: 17,
  detailSize: 14,
  /** Gap between layers when the diagram runs sideways and edges have no labels. */
  layerGapHorizontal: 28,
  layerGapVertical: 36,
  edgeWidth: 1.5,
  focusStroke: 2,
  /** Success mixed over the page, so the fill stays a dark tint. */
  focusFill: 10,
  /** Success mixed into the page, so the stroke stays muted. */
  focusStrokeMix: 62,
  arrowSize: 7,
  /** How far a shared arrowhead sits from the node it enters. */
  arrowStem: 18,
  vennName: 20,
  vennNote: 14,
} as const;

/** Column slots. A handful of bars are wide; a dense plot keeps the narrow measure. */
export function columnBands(count: number, width: number) {
  const safe = Math.max(1, count);
  const few = safe <= 8;
  const gap = few ? Math.min(16, width / (2 * safe)) : Math.min(8, width / (2 * safe));
  const slot = (width - gap * (safe - 1)) / safe;
  const column = few
    ? Math.min(slot, Math.max(2, Math.min(120, slot * 0.82)))
    : Math.min(slot, Math.max(2, Math.min(28, slot * 0.7)));
  const radius = Math.min(6, column / 2);
  return { gap, slot, column, radius, few };
}

const channel = (hex: string) => {
  const body = hex.replace("#", "");
  const full = body.length === 3 ? [...body].map((part) => part + part).join("") : body.slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16));
};

/** `percent` of `color` laid over `base`. Both are `#rgb` or `#rrggbb`. */
export function mixHex(color: string, base: string, percent: number): string {
  const [r1, g1, b1] = channel(color);
  const [r2, g2, b2] = channel(base);
  const mix = percent / 100;
  const blend = (from: number, to: number) => Math.round(from * mix + to * (1 - mix));
  const byte = (value: number) => value.toString(16).padStart(2, "0");
  return `#${byte(blend(r1!, r2!))}${byte(blend(g1!, g2!))}${byte(blend(b1!, b2!))}`;
}
