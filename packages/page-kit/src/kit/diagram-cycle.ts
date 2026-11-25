import { iconShapes } from "./diagram-icons.js";
import type { DiagramEdge, DiagramNode, DiagramTone } from "./diagram-layout.js";
import { wrapText } from "./diagram-layout.js";

export type { DiagramTone };

/** A tinted region behind the nodes it names. Two regions split the drawing; more hug their nodes. */
export type DiagramZone = {
  label?: string;
  nodes?: string[];
  tone?: DiagramTone;
};

/** A labelled arrow into or out of a node, from outside the loop. */
export type DiagramFlow = {
  node?: string;
  label?: string;
  direction?: "in" | "out";
  tone?: DiagramTone;
};

export type Box = { x: number; y: number; width: number; height: number };

export type CycleText = {
  text: string;
  /** Horizontal anchor, and the vertical centre of the line. */
  x: number;
  y: number;
  size: number;
  anchor: "start" | "middle" | "end";
  width: number;
  height: number;
  tone?: DiagramTone;
};

export type CycleNodeDraw = {
  id: string;
  box: Box;
  tone?: DiagramTone;
  focused: boolean;
  /** 1-based place around the loop. The focused node wears it as a badge. */
  index: number;
  icon?: string;
  iconAt: [number, number];
  iconSize: number;
  lines: CycleText[];
  badge?: { cx: number; cy: number; r: number; text: string };
};

export type CyclePipe = {
  from: string;
  to: string;
  d: string;
  tone?: DiagramTone;
  arrow: string;
};

export type CycleFlowDraw = {
  tone?: DiagramTone;
  shafts: string[];
  heads: string[];
  label: CycleText;
};

export type CycleZoneDraw = {
  box: Box;
  label: CycleText;
  tone?: DiagramTone;
  nodeIds: string[];
};

export type CycleLayout = {
  width: number;
  height: number;
  nodes: CycleNodeDraw[];
  pipes: CyclePipe[];
  flows: CycleFlowDraw[];
  zones: CycleZoneDraw[];
  center: CycleText[];
};

const TONES = new Set<string>(["info", "warning", "danger"]);
const LABEL = 13;
const LABEL_LINE = 16;
const CENTER = 12;
const FLOW = 11;
const ZONE = 12;
const CHAR_AT_17 = 8.6;

type Point = [number, number];
type Side = "left" | "top" | "right" | "bottom";

const round = (value: number) => Math.round(value * 10) / 10;
const charPx = (size: number) => (size / 17) * CHAR_AT_17;

const toneOf = (value: unknown): DiagramTone | undefined =>
  typeof value === "string" && TONES.has(value) ? (value as DiagramTone) : undefined;

const pxWidth = (text: string, size: number) => {
  let units = 0;
  for (const character of text) units += character.charCodeAt(0) > 0xff ? 2 : 1;
  return units * charPx(size);
};

function linesOf(text: string, maxPx: number, size: number): string[] {
  const per = Math.max(4, Math.floor(maxPx / charPx(size)));
  const lines = wrapText(text, per).filter((line) => line.length > 0);
  return (lines.length ? lines : [text]).slice(0, 2);
}

function textLine(
  text: string,
  x: number,
  y: number,
  size: number,
  anchor: CycleText["anchor"],
  tone?: DiagramTone,
): CycleText {
  return { text, x, y, size, anchor, width: pxWidth(text, size), height: size + 3, tone };
}

/** The rectangle a line occupies, for overlap checks. */
export function cycleTextBox(line: CycleText): Box {
  const x =
    line.anchor === "middle"
      ? line.x - line.width / 2
      : line.anchor === "end"
        ? line.x - line.width
        : line.x;
  return { x, y: line.y - line.height / 2, width: line.width, height: line.height };
}

const hits = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

/** Cards, labels, flow captions, the centre words and zone captions. Pipes may pass behind a label. */
export function cycleOccupancy(layout: CycleLayout): Box[] {
  return [
    ...layout.nodes.flatMap((node) => [node.box, ...node.lines.map(cycleTextBox)]),
    ...layout.flows.map((flow) => cycleTextBox(flow.label)),
    ...layout.center.map(cycleTextBox),
    ...layout.zones.map((zone) => cycleTextBox(zone.label)),
  ];
}

function arrowHead(from: Point, tip: Point, size: number): string {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (turn: number): Point => [
    tip[0] - size * Math.cos(angle + turn),
    tip[1] - size * Math.sin(angle + turn),
  ];
  const [left, right] = [wing(0.42), wing(-0.42)];
  return `M${round(left[0])},${round(left[1])}L${round(tip[0])},${round(tip[1])}L${round(right[0])},${round(right[1])}Z`;
}

function arrowOn(a: Point, b: Point, forward: boolean): string {
  const from = forward ? a : b;
  const to = forward ? b : a;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const ux = dx / len;
  const uy = dy / len;
  return arrowHead([mx - ux * 3, my - uy * 3], [mx + ux * 6, my + uy * 6], 8);
}

function elbow(start: Point, corner: Point, end: Point): string {
  const dist = (p: Point, q: Point) => Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const d1 = dist(start, corner);
  const d2 = dist(corner, end);
  const rad = Math.min(10, d1 / 2, d2 / 2);
  const u1: Point = [(corner[0] - start[0]) / d1, (corner[1] - start[1]) / d1];
  const u2: Point = [(end[0] - corner[0]) / d2, (end[1] - corner[1]) / d2];
  const a: Point = [corner[0] - u1[0] * rad, corner[1] - u1[1] * rad];
  const b: Point = [corner[0] + u2[0] * rad, corner[1] + u2[1] * rad];
  return `M${round(start[0])},${round(start[1])}L${round(a[0])},${round(a[1])}Q${round(corner[0])},${round(corner[1])} ${round(b[0])},${round(b[1])}L${round(end[0])},${round(end[1])}`;
}

function outerCorner(start: Point, end: Point, center: Point): Point {
  const a: Point = [start[0], end[1]];
  const b: Point = [end[0], start[1]];
  const far = (p: Point) => Math.hypot(p[0] - center[0], p[1] - center[1]);
  return far(a) >= far(b) ? a : b;
}

type Prepared = {
  id: string;
  label: string;
  tone?: DiagramTone;
  icon?: string;
};

function prepare(nodes: DiagramNode[]): Prepared[] {
  const seen = new Set<string>();
  const ready: Prepared[] = [];
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !node.id || seen.has(node.id)) continue;
    seen.add(node.id);
    const label = typeof node.label === "string" && node.label.trim() ? node.label : node.id;
    ready.push({
      id: node.id,
      label,
      tone: toneOf(node.tone),
      icon: iconShapes(node.icon) ? node.icon : undefined,
    });
  }
  return ready;
}

type EdgeUse = { tone?: DiagramTone; forward: boolean };

function edgeBetween(edges: DiagramEdge[], from: string, to: string): EdgeUse {
  for (const edge of edges) {
    if (!edge) continue;
    if (edge.from === from && edge.to === to) return { tone: toneOf(edge.tone), forward: true };
    if (edge.from === to && edge.to === from) return { tone: toneOf(edge.tone), forward: false };
  }
  return { forward: true };
}

function iconPlacement(
  box: Box,
  icon: string | undefined,
): Pick<CycleNodeDraw, "iconAt" | "iconSize"> {
  const size = icon ? Math.min(28, box.width - 16, box.height - 16) : 0;
  return {
    iconSize: size,
    iconAt: [box.x + (box.width - size) / 2, box.y + (box.height - size) / 2],
  };
}

function withBadge(node: CycleNodeDraw, focused: boolean): CycleNodeDraw {
  if (!focused) return { ...node, focused: false };
  return {
    ...node,
    focused: true,
    badge: {
      cx: node.box.x + node.box.width / 2,
      cy: node.box.y,
      r: 8,
      text: String(node.index),
    },
  };
}

/**
 * Four nodes sit on the sides of a rectangle, clockwise from the left: the heat pump, the water
 * cycle, a four-stroke engine. Labels sit just outside each card. The pipe runs the long way
 * around and closes.
 */
function layoutQuad(
  nodes: Prepared[],
  edges: DiagramEdge[],
  width: number,
  focus: string | undefined,
  sideFlows: boolean,
): { nodes: CycleNodeDraw[]; pipes: CyclePipe[]; width: number; height: number } {
  const flowW = sideFlows ? Math.round(Math.min(52, Math.max(40, width * 0.125))) : 10;
  const card = Math.round(Math.min(74, Math.max(58, (width - flowW * 2 - 64) / 3)));
  const topH = Math.round(card * 0.86);
  const zoneH = 22;
  const pipeV = Math.max(28, Math.round(card * 0.42));
  const topY = zoneH + 6;
  // The top caption and the side captions share this band, one under the other.
  const labelBand = LABEL_LINE * 2 + 16;
  const sideY = topY + topH + labelBand + 4;
  const bottomY = sideY + card + pipeV;
  const leftX = flowW;
  const midX = Math.round((width - card) / 2);
  const rightX = width - flowW - card;
  const boxes: Record<Side, Box> = {
    left: { x: leftX, y: sideY, width: card, height: card },
    top: { x: midX, y: topY, width: card, height: topH },
    right: { x: rightX, y: sideY, width: card, height: card },
    bottom: { x: midX, y: bottomY, width: card, height: topH },
  };
  const sides: Side[] = ["left", "top", "right", "bottom"];
  const hole = rightX - (leftX + card);
  const placed: CycleNodeDraw[] = nodes.map((node, index) => {
    const side = sides[index]!;
    const box = boxes[side];
    const max =
      side === "top" || side === "bottom" ? Math.max(hole, card) : Math.max(card + 28, 96);
    const lines = linesOf(node.label, max, LABEL);
    const block = lines.length * LABEL_LINE;
    const texts = lines.map((text, line) => {
      const y =
        side === "bottom"
          ? box.y + box.height + 8 + LABEL_LINE * (line + 0.5)
          : side === "top"
            ? box.y + box.height + 6 + LABEL_LINE * (line + 0.5)
            : box.y - 8 - block + LABEL_LINE * (line + 0.5);
      return textLine(text, box.x + box.width / 2, y, LABEL, "middle");
    });
    return withBadge(
      {
        id: node.id,
        box,
        tone: node.tone,
        focused: false,
        index: index + 1,
        icon: node.icon,
        ...iconPlacement(box, node.icon),
        lines: texts,
      },
      node.id === focus,
    );
  });
  const bySide = Object.fromEntries(placed.map((node, index) => [sides[index], node])) as Record<
    Side,
    CycleNodeDraw
  >;
  const center: Point = [width / 2, sideY + card / 2];
  const port = (node: CycleNodeDraw, edge: "top" | "bottom" | "left" | "right"): Point => {
    const { box } = node;
    if (edge === "top") return [box.x + box.width / 2, box.y];
    if (edge === "bottom") return [box.x + box.width / 2, box.y + box.height];
    if (edge === "left") return [box.x, box.y + box.height / 2];
    return [box.x + box.width, box.y + box.height / 2];
  };
  const joins: [
    Side,
    Side,
    "top" | "bottom" | "left" | "right",
    "top" | "bottom" | "left" | "right",
  ][] = [
    ["left", "top", "top", "left"],
    ["top", "right", "right", "top"],
    ["right", "bottom", "bottom", "right"],
    ["bottom", "left", "left", "bottom"],
  ];
  const pipes: CyclePipe[] = joins.map(([fromSide, toSide, out, inn]) => {
    const from = bySide[fromSide];
    const to = bySide[toSide];
    const start = port(from, out);
    const end = port(to, inn);
    const corner = outerCorner(start, end, center);
    const use = edgeBetween(edges, from.id, to.id);
    const first = Math.hypot(corner[0] - start[0], corner[1] - start[1]);
    const second = Math.hypot(end[0] - corner[0], end[1] - corner[1]);
    return {
      from: from.id,
      to: to.id,
      d: elbow(start, corner, end),
      tone: use.tone,
      arrow:
        first >= second ? arrowOn(start, corner, use.forward) : arrowOn(corner, end, use.forward),
    };
  });
  const lowest = Math.max(
    ...placed.flatMap((node) => [
      node.box.y + node.box.height,
      ...node.lines.map((line) => line.y + line.height / 2),
    ]),
  );
  return { nodes: placed, pipes, width, height: Math.ceil(lowest + 10) };
}

function separated(radius: number, count: number, card: number): boolean {
  const points = Array.from({ length: count }, (_, index) => {
    const angle = Math.PI + (index * 2 * Math.PI) / count;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = Math.abs(points[i]!.x - points[j]!.x);
      const dy = Math.abs(points[i]!.y - points[j]!.y);
      if (dx < card && dy < card) return false;
    }
  }
  return true;
}

function borderToward(box: Box, target: Point): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = target[0] - cx;
  const dy = target[1] - cy;
  const scale = Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2)) || 1;
  return [cx + dx / scale, cy + dy / scale];
}

function layoutRing(
  nodes: Prepared[],
  edges: DiagramEdge[],
  width: number,
  focus: string | undefined,
): { nodes: CycleNodeDraw[]; pipes: CyclePipe[]; width: number; height: number } {
  const count = nodes.length;
  const pad = 44;
  let card = 58;
  let radius = card;
  for (card = 58; card >= 44; card -= 2) {
    radius = card;
    for (let attempt = card; attempt < 480; attempt += 2) {
      if (separated(attempt, count, card + 10)) {
        radius = attempt;
        break;
      }
    }
    if (2 * (radius + card / 2 + pad) <= width) break;
  }
  const span = 2 * (radius + card / 2 + pad);
  const height = Math.ceil(span);
  const cx = width / 2;
  const cy = height / 2;
  const placed: CycleNodeDraw[] = nodes.map((node, index) => {
    const angle = Math.PI + (index * 2 * Math.PI) / count;
    const x = cx + Math.cos(angle) * radius - card / 2;
    const y = cy + Math.sin(angle) * radius - card / 2;
    const box = { x, y, width: card, height: card };
    const lines = linesOf(node.label, Math.max(card, 72), LABEL);
    const outwardX = Math.cos(angle);
    const outwardY = Math.sin(angle);
    let reach = card / 2 + 8;
    let texts: CycleText[] = [];
    for (let step = 0; step < 10; step++) {
      texts = lines.map((text, line) => {
        const along = reach + LABEL_LINE * (line + 0.5);
        return textLine(
          text,
          box.x + card / 2 + outwardX * along,
          box.y + card / 2 + outwardY * along,
          LABEL,
          "middle",
        );
      });
      if (texts.every((line) => !hits(cycleTextBox(line), box))) break;
      reach += 6;
    }
    return withBadge(
      {
        id: node.id,
        box,
        tone: node.tone,
        focused: false,
        index: index + 1,
        icon: node.icon,
        ...iconPlacement(box, node.icon),
        lines: texts,
      },
      node.id === focus,
    );
  });
  // One stage is a card, not a loop. A pipe back to the same card draws a stray arrow.
  if (count < 2) return { nodes: placed, pipes: [], width, height };
  const pipes: CyclePipe[] = placed.map((node, index) => {
    const next = placed[(index + 1) % count]!;
    const start = borderToward(node.box, [
      next.box.x + next.box.width / 2,
      next.box.y + next.box.height / 2,
    ]);
    const end = borderToward(next.box, [
      node.box.x + node.box.width / 2,
      node.box.y + node.box.height / 2,
    ]);
    const mid: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const ox = mid[0] - cx;
    const oy = mid[1] - cy;
    const olen = Math.hypot(ox, oy) || 1;
    const control: Point = [mid[0] + (ox / olen) * 14, mid[1] + (oy / olen) * 14];
    const use = edgeBetween(edges, node.id, next.id);
    const tip: Point = [
      0.25 * start[0] + 0.5 * control[0] + 0.25 * end[0],
      0.25 * start[1] + 0.5 * control[1] + 0.25 * end[1],
    ];
    const toward = use.forward ? end : start;
    return {
      from: node.id,
      to: next.id,
      d: `M${round(start[0])},${round(start[1])}Q${round(control[0])},${round(control[1])} ${round(end[0])},${round(end[1])}`,
      tone: use.tone,
      arrow: arrowHead(
        [tip[0] - (toward[0] - tip[0]) * 0.15, tip[1] - (toward[1] - tip[1]) * 0.15],
        tip,
        8,
      ),
    };
  });
  return { nodes: placed, pipes, width, height };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function centreOf(node: CycleNodeDraw): Point {
  return [node.box.x + node.box.width / 2, node.box.y + node.box.height / 2];
}

function placeZones(
  zones: DiagramZone[] | undefined,
  nodes: CycleNodeDraw[],
  width: number,
  height: number,
): CycleZoneDraw[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ready = (Array.isArray(zones) ? zones : []).flatMap((zone) => {
    if (!zone || typeof zone !== "object") return [];
    const label = typeof zone.label === "string" ? zone.label.trim() : "";
    const ids = (Array.isArray(zone.nodes) ? zone.nodes : []).filter(
      (id): id is string => typeof id === "string" && byId.has(id),
    );
    if (!label || ids.length === 0) return [];
    return [{ label, ids: [...new Set(ids)], tone: toneOf(zone.tone) }];
  });
  if (ready.length === 0) return [];
  const panel = (
    zone: (typeof ready)[number],
    x: number,
    y: number,
    w: number,
    h: number,
  ): CycleZoneDraw => ({
    box: { x, y, width: w, height: h },
    tone: zone.tone,
    nodeIds: zone.ids,
    label: textLine(zone.label, x + w / 2, y + 12, ZONE, "middle", zone.tone),
  });
  if (ready.length === 2) {
    const xs = ready.map((zone) => mean(zone.ids.map((id) => centreOf(byId.get(id)!)[0])));
    const ys = ready.map((zone) => mean(zone.ids.map((id) => centreOf(byId.get(id)!)[1])));
    const inset = 6;
    const gutter = 8;
    const first = ready[0];
    const second = ready[1];
    const x0 = xs[0];
    const x1 = xs[1];
    const y0 = ys[0];
    const y1 = ys[1];
    if (
      first &&
      second &&
      x0 !== undefined &&
      x1 !== undefined &&
      y0 !== undefined &&
      y1 !== undefined
    ) {
      if (Math.abs(x0 - x1) >= Math.abs(y0 - y1) && Math.abs(x0 - x1) > 16) {
        const left = x0 <= x1 ? first : second;
        const right = x0 <= x1 ? second : first;
        const split = Math.round(width / 2);
        return [
          panel(left, inset, inset, split - gutter - inset, height - inset * 2),
          panel(right, split + gutter, inset, width - split - gutter - inset, height - inset * 2),
        ];
      }
      if (Math.abs(y0 - y1) > 16) {
        const top = y0 <= y1 ? first : second;
        const bottom = y0 <= y1 ? second : first;
        const split = Math.round(height / 2);
        return [
          panel(top, inset, inset, width - inset * 2, split - gutter - inset),
          panel(bottom, inset, split + gutter, width - inset * 2, height - split - gutter - inset),
        ];
      }
    }
  }
  return ready.map((zone) => {
    const members = zone.ids.map((id) => byId.get(id)!);
    const x = Math.min(...members.map((node) => node.box.x)) - 12;
    const y = Math.min(...members.map((node) => node.box.y)) - 26;
    const right = Math.max(...members.map((node) => node.box.x + node.box.width)) + 12;
    const bottom = Math.max(...members.map((node) => node.box.y + node.box.height)) + 12;
    return panel(
      zone,
      Math.max(0, x),
      Math.max(0, y),
      Math.min(width, right) - Math.max(0, x),
      Math.min(height, bottom) - Math.max(0, y),
    );
  });
}

function placeCenter(text: string | undefined, nodes: CycleNodeDraw[], width: number): CycleText[] {
  if (typeof text !== "string" || !text.trim() || nodes.length === 0) return [];
  const cx = width / 2;
  const cy = mean(nodes.map((node) => centreOf(node)[1]));
  const gaps = nodes.map((node) => Math.abs(centreOf(node)[0] - cx)).filter((gap) => gap > 8);
  const hole = gaps.length === 0 ? 72 : Math.max(72, Math.min(...gaps) * 2 - 24);
  return linesOf(text.trim(), hole, CENTER).map((line, index, all) =>
    textLine(line, cx, cy + CENTER * (index - (all.length - 1) / 2), CENTER, "middle"),
  );
}

/** How far a side's own labels stick out past the card. Labels on the other sides do not count. */
function outerEdge(node: CycleNodeDraw, side: Side): number {
  const onSide = node.lines.map(cycleTextBox).filter((box) => {
    if (side === "left") return box.x + box.width <= node.box.x + 4;
    if (side === "right") return box.x >= node.box.x + node.box.width - 4;
    if (side === "top") return box.y + box.height <= node.box.y + 4;
    return box.y >= node.box.y + node.box.height - 4;
  });
  const boxes = [node.box, ...onSide];
  if (side === "left") return Math.min(...boxes.map((box) => box.x));
  if (side === "right") return Math.max(...boxes.map((box) => box.x + box.width));
  if (side === "top") return Math.min(...boxes.map((box) => box.y));
  return Math.max(...boxes.map((box) => box.y + box.height));
}

function placeFlows(
  flows: DiagramFlow[] | undefined,
  nodes: CycleNodeDraw[],
  width: number,
): CycleFlowDraw[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const cx = mean(nodes.map((node) => centreOf(node)[0]));
  const cy = mean(nodes.map((node) => centreOf(node)[1]));
  const avoid = nodes.flatMap((node) => [node.box, ...node.lines.map(cycleTextBox)]);
  const drawn: CycleFlowDraw[] = [];
  for (const flow of Array.isArray(flows) ? flows : []) {
    if (!flow || typeof flow.node !== "string" || typeof flow.label !== "string") continue;
    const node = byId.get(flow.node);
    const label = flow.label.trim();
    if (!node || !label) continue;
    const [nx, ny] = centreOf(node);
    const side: Side =
      Math.abs(nx - cx) >= Math.abs(ny - cy)
        ? nx < cx
          ? "left"
          : "right"
        : ny < cy
          ? "top"
          : "bottom";
    const outward = flow.direction === "out";
    const shafts: string[] = [];
    const heads: string[] = [];
    const span = 26;
    const gap = 11;
    const edge = outerEdge(node, side);
    for (let index = 0; index < 3; index++) {
      const shift = (index - 1) * gap;
      let tail: Point;
      let tip: Point;
      if (side === "left" || side === "right") {
        const y = ny + shift;
        const near = side === "left" ? edge - 8 : edge + 8;
        const far = side === "left" ? near - span : near + span;
        // "in" points at the node. "out" points away. The same on every side.
        tail = outward ? [near, y] : [far, y];
        tip = outward ? [far, y] : [near, y];
      } else {
        const x = nx + shift;
        const near = side === "top" ? edge - 8 : edge + 8;
        const far = side === "top" ? near - span : near + span;
        tail = outward ? [x, near] : [x, far];
        tip = outward ? [x, far] : [x, near];
      }
      const run = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]) || 1;
      const end: Point = [
        tip[0] - ((tip[0] - tail[0]) / run) * 7,
        tip[1] - ((tip[1] - tail[1]) / run) * 7,
      ];
      shafts.push(`M${round(tail[0])},${round(tail[1])}L${round(end[0])},${round(end[1])}`);
      heads.push(arrowHead(tail, tip, 8));
    }
    const mid =
      side === "left" || side === "right"
        ? side === "left"
          ? edge - 8 - span / 2
          : edge + 8 + span / 2
        : nx;
    const across =
      side === "top"
        ? edge - 8 - span - 10
        : side === "bottom"
          ? edge + span + 18
          : ny + gap + FLOW + 6;
    let caption = textLine(label, mid, across, FLOW, "middle", toneOf(flow.tone));
    for (let step = 0; step < 8; step++) {
      const box = cycleTextBox(caption);
      const hit =
        avoid.some((other) => hits(box, other)) ||
        drawn.some((placed) => hits(box, cycleTextBox(placed.label)));
      const low = box.x < 2;
      const high = box.x + box.width > width - 2;
      const above = box.y < 2;
      if (!hit && !low && !high && !above) break;
      let dx = 0;
      let dy = 0;
      if (low) dx = 2 - box.x;
      else if (high) dx = width - 2 - (box.x + box.width);
      else if (hit && (side === "left" || side === "right")) dx = side === "left" ? -4 : 4;
      if (above) dy = 2 - box.y;
      else if (hit && (side === "top" || side === "bottom")) dy = side === "top" ? -4 : 4;
      if (dx === 0 && dy === 0) break;
      caption = { ...caption, x: caption.x + dx, y: caption.y + dy };
    }
    drawn.push({ tone: toneOf(flow.tone) ?? node.tone, shafts, heads, label: caption });
  }
  return drawn;
}

/**
 * Nodes in the order given, clockwise from the left, on a closed loop. Four nodes use a
 * rectangle. Any other count uses a ring. Width is the column the drawing has to fit.
 */
export function layoutCycle(
  nodes: DiagramNode[] | undefined,
  edges: DiagramEdge[] | undefined,
  options: {
    zones?: DiagramZone[];
    flows?: DiagramFlow[];
    center?: string;
    focus?: string;
    width?: number;
  } = {},
): CycleLayout {
  const prepared = prepare(Array.isArray(nodes) ? nodes : []);
  const width = options.width && options.width > 0 ? Math.min(options.width, 440) : 360;
  const empty: CycleLayout = {
    width,
    height: 0,
    nodes: [],
    pipes: [],
    flows: [],
    zones: [],
    center: [],
  };
  if (prepared.length === 0) return empty;
  const links = (Array.isArray(edges) ? edges : []).filter(
    (edge) => edge && typeof edge.from === "string" && typeof edge.to === "string",
  );
  const focus = prepared.some((node) => node.id === options.focus) ? options.focus : undefined;
  const sideFlows = (Array.isArray(options.flows) ? options.flows : []).some(
    (flow) => flow && typeof flow.node === "string",
  );
  const body =
    prepared.length === 4
      ? layoutQuad(prepared, links, width, focus, sideFlows)
      : layoutRing(prepared, links, width, focus);
  const center = placeCenter(options.center, body.nodes, body.width);
  const flows = placeFlows(options.flows, body.nodes, body.width);
  const lowest = Math.max(
    body.height,
    ...flows.map((flow) => flow.label.y + flow.label.height / 2 + 6),
    ...center.map((line) => line.y + line.height / 2),
  );
  const height = Math.ceil(lowest);
  const zones = placeZones(options.zones, body.nodes, body.width, height);
  return { width: body.width, height, nodes: body.nodes, pipes: body.pipes, flows, zones, center };
}
