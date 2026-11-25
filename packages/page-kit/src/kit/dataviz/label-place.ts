import { textWidth } from "./scale.js";

/** 12px notes. The box is the text; the knockout is that box plus padding. */
const LINE = 14;
const PAD = 3;
const GAP = 4;
const CLEARANCE = 14;

export type LabelAnchor = "start" | "middle" | "end";

export type LabelRect = { x: number; y: number; width: number; height: number };

export type LabelBounds = { left: number; top: number; right: number; bottom: number };

export type ChartNote = {
  id: string;
  text: string;
  /** The point, or the right end of a horizontal rule. */
  x: number;
  y: number;
  /** A point note tries above and below. A rule note slides along its line. */
  kind: "point" | "rule";
  /** For a point, whether above is the first choice. */
  preferAbove?: boolean;
  /** A point note draws a dot and a tick at its point. False when it has none. */
  marker?: boolean;
};

export type PlacedLabel = {
  id: string;
  x: number;
  y: number;
  anchor: LabelAnchor;
  /** No spot was clear of the others and inside the plot. The marker still stands. */
  hidden: boolean;
  rect: LabelRect | null;
};

/** The card-coloured knockout behind a note, so a line cannot run through the words. */
export function labelBack(
  x: number,
  baseline: number,
  anchor: LabelAnchor,
  width: number,
): LabelRect {
  const textLeft = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  const textTop = baseline - (LINE - 3);
  return {
    x: textLeft - PAD,
    y: textTop - 1,
    width: width + PAD * 2,
    height: LINE + 2,
  };
}

type Candidate = { x: number; y: number; anchor: LabelAnchor; rect: LabelRect };

const round = (value: number) => Math.round(value * 10) / 10;

function overlaps(a: LabelRect, b: LabelRect) {
  return !(
    a.x + a.width + GAP <= b.x ||
    b.x + b.width + GAP <= a.x ||
    a.y + a.height + GAP <= b.y ||
    b.y + b.height + GAP <= a.y
  );
}

/** The dot and its tick, which a label's knockout must never cover. */
function markerRect(note: ChartNote): LabelRect {
  return { x: note.x - 4, y: note.y - 12, width: 8, height: 24 };
}

function covers(a: LabelRect, b: LabelRect) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function inside(rect: LabelRect, bounds: LabelBounds) {
  return (
    rect.x >= bounds.left - 0.5 &&
    rect.y >= bounds.top - 0.5 &&
    rect.x + rect.width <= bounds.right + 0.5 &&
    rect.y + rect.height <= bounds.bottom + 0.5
  );
}

function candidate(textLeft: number, textTop: number, width: number, nearX: number): Candidate {
  const centre = textLeft + width / 2;
  const anchor: LabelAnchor = centre < nearX - 6 ? "end" : centre > nearX + 6 ? "start" : "middle";
  const x = anchor === "start" ? textLeft : anchor === "end" ? textLeft + width : centre;
  const y = textTop + LINE - 3;
  return { x: round(x), y: round(y), anchor, rect: labelBack(x, y, anchor, width) };
}

/** The same spot shifted fully inside the plot, when the natural spot would clip. */
function clamped(
  textLeft: number,
  textTop: number,
  width: number,
  nearX: number,
  bounds: LabelBounds,
): Candidate | undefined {
  const minLeft = bounds.left + PAD;
  const maxLeft = bounds.right - PAD - width;
  const minTop = bounds.top + 1;
  const maxTop = bounds.bottom - (LINE + 2);
  if (maxLeft < minLeft || maxTop < minTop) return undefined;
  const left = Math.min(Math.max(textLeft, minLeft), maxLeft);
  const top = Math.min(Math.max(textTop, minTop), maxTop);
  if (left === textLeft && top === textTop) return undefined;
  return candidate(left, top, width, nearX);
}

function consider(
  out: Candidate[],
  textLeft: number,
  textTop: number,
  width: number,
  nearX: number,
  bounds: LabelBounds,
) {
  out.push(candidate(textLeft, textTop, width, nearX));
  const shifted = clamped(textLeft, textTop, width, nearX, bounds);
  if (shifted) out.push(shifted);
}

function pointCandidates(note: ChartNote, width: number, bounds: LabelBounds): Candidate[] {
  const out: Candidate[] = [];
  const sides: Array<"above" | "below"> = note.preferAbove
    ? ["above", "below"]
    : ["below", "above"];
  for (const side of sides) {
    for (const step of [0, 1, 2]) {
      const extra = step * (LINE + GAP);
      const textTop =
        side === "above" ? note.y - CLEARANCE - LINE - extra : note.y + CLEARANCE + extra;
      for (const shift of [0, -0.5, 0.5, -1, 1]) {
        consider(out, note.x - width / 2 + shift * width, textTop, width, note.x, bounds);
      }
    }
  }
  return out;
}

function ruleCandidates(note: ChartNote, width: number, bounds: LabelBounds): Candidate[] {
  const out: Candidate[] = [];
  const end = Math.min(note.x, bounds.right - PAD);
  const step = Math.max(24, width / 2);
  for (const side of ["above", "below"] as const) {
    for (let at = end; at >= bounds.left + PAD + width; at -= step) {
      const textTop = side === "above" ? note.y - 8 - LINE : note.y + 8;
      consider(out, at - width, textTop, width, at, bounds);
    }
  }
  return out;
}

/**
 * Puts each note where it can be read: inside the plot, clear of the others.
 * A note with no such spot is dropped. Its marker still names the value.
 */
export function placeChartLabels(notes: ChartNote[], bounds: LabelBounds): PlacedLabel[] {
  const taken: LabelRect[] = [];
  const markers = notes
    .filter((note) => note.kind === "point" && note.marker !== false)
    .map(markerRect);
  const byId = new Map<string, PlacedLabel>();
  const ordered = [
    ...notes.filter((note) => note.kind === "rule"),
    ...notes.filter((note) => note.kind !== "rule"),
  ];
  for (const note of ordered) {
    const text = note.text.trim();
    const width = textWidth(text);
    const hide = (): PlacedLabel => ({
      id: note.id,
      x: note.x,
      y: note.y,
      anchor: "middle",
      hidden: true,
      rect: null,
    });
    if (!text || width + PAD * 2 > bounds.right - bounds.left) {
      byId.set(note.id, hide());
      continue;
    }
    const spots =
      note.kind === "rule"
        ? ruleCandidates(note, width, bounds)
        : pointCandidates(note, width, bounds);
    const spot = spots.find(
      (item) =>
        inside(item.rect, bounds) &&
        taken.every((rect) => !overlaps(item.rect, rect)) &&
        markers.every((rect) => !covers(item.rect, rect)),
    );
    if (!spot) {
      byId.set(note.id, hide());
      continue;
    }
    taken.push(spot.rect);
    byId.set(note.id, {
      id: note.id,
      x: spot.x,
      y: spot.y,
      anchor: spot.anchor,
      hidden: false,
      rect: spot.rect,
    });
  }
  return notes.map(
    (note) =>
      byId.get(note.id) ?? {
        id: note.id,
        x: note.x,
        y: note.y,
        anchor: "middle",
        hidden: true,
        rect: null,
      },
  );
}
