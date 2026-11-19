export type DiagramNode = {
  id: string;
  label: string;
  detail?: string;
  kind?: "box" | "terminal";
  series?: number;
};
export type DiagramEdge = { from: string; to: string; label?: string; dashed?: boolean };

const LABEL_CHAR = 7.8;
const DETAIL_CHAR = 6.9;
const PAD_X = 14;
export const PAD_Y = 10;
export const LABEL_LINE = 19;
export const DETAIL_LINE = 17;
const MIN_WIDTH = 88;
const MAX_WIDTH = 208;
const NODE_GAP = 24;
export const LOOP_ROOM = 36;
/** Node accents for `series` 0 to 4, in chart colour order. */
export const SERIES_COLORS = ["--rk-c1", "--rk-c2", "--rk-c3", "--rk-c4", "--rk-c5"];

// Estimate full-width glyphs as two Latin characters, consistently for wrapping and sizing.
const wideGlyph =
  /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;
const graphemes =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;
const segments = (text: string) =>
  graphemes ? [...graphemes.segment(text)].map(({ segment }) => segment) : [...text];
const characterWidth = (character: string) => {
  if (/\p{Emoji_Presentation}|\uFE0F|\u20E3/u.test(character)) return 2;
  return [...character].reduce(
    (width, point) =>
      width + (/\p{Nonspacing_Mark}/u.test(point) ? 0 : wideGlyph.test(point) ? 2 : 1),
    0,
  );
};
const textWidth = (text: string) =>
  segments(text).reduce((width, segment) => width + characterWidth(segment), 0);

/** Greedy word wrap; a word longer than a line is split rather than clipped. */
export function wrapText(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.normalize("NFC").split(/\s+/).filter(Boolean)) {
    let remainder = "";
    let width = 0;
    for (const character of segments(word)) {
      const nextWidth = characterWidth(character);
      if (remainder && width + nextWidth > perLine) {
        if (line) lines.push(line);
        line = "";
        lines.push(remainder);
        remainder = "";
        width = 0;
      }
      remainder += character;
      width += nextWidth;
    }
    if (line && textWidth(line) + 1 + width > perLine) {
      lines.push(line);
      line = remainder;
    } else line = line ? `${line} ${remainder}` : remainder;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export type Placed = DiagramNode & {
  labelLines: string[];
  detailLines: string[];
  width: number;
  height: number;
  layer: number;
  x: number;
  y: number;
};

/**
 * Layers by longest path along the edges, after setting aside edges that close a cycle, then
 * orders each layer by its parents' positions.
 */
export function layoutDiagram(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  horizontal: boolean,
  edgeLabels: boolean,
) {
  const perLabel = Math.floor((MAX_WIDTH - PAD_X * 2) / LABEL_CHAR);
  const perDetail = Math.floor((MAX_WIDTH - PAD_X * 2) / DETAIL_CHAR);
  const byId = new Map<string, Placed>();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || byId.has(node.id)) continue;
    const labelLines = wrapText(String(node.label ?? node.id), perLabel);
    const detailLines = node.detail ? wrapText(String(node.detail), perDetail) : [];
    const measuredWidth = Math.max(
      ...labelLines.map((line) => textWidth(line) * LABEL_CHAR),
      ...detailLines.map((line) => textWidth(line) * DETAIL_CHAR),
    );
    byId.set(node.id, {
      ...node,
      labelLines,
      detailLines,
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(measuredWidth + PAD_X * 2))),
      height: PAD_Y * 2 + labelLines.length * LABEL_LINE + detailLines.length * DETAIL_LINE,
      layer: 0,
      x: 0,
      y: 0,
    });
  }
  const valid = edges.filter(
    (edge) => edge && byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to,
  );
  // Edges are taken in the order given; one that would close a cycle with those already taken
  // is drawn as a loop back instead of deciding the layers, so the author's main path wins.
  const kept = new Map<string, string[]>();
  const reaches = (from: string, target: string) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === target) return true;
      for (const next of kept.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return false;
  };
  const forward: DiagramEdge[] = [];
  for (const edge of valid) {
    if (reaches(edge.to, edge.from)) continue;
    forward.push(edge);
    kept.set(edge.from, [...(kept.get(edge.from) ?? []), edge.to]);
  }
  const incoming = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
  for (const edge of forward) incoming.set(edge.to, incoming.get(edge.to)! + 1);
  const queue = [...byId.keys()].filter((id) => incoming.get(id) === 0);
  for (let index = 0; index < queue.length; index++) {
    const from = byId.get(queue[index]!)!;
    for (const edge of forward) {
      if (edge.from !== from.id) continue;
      const to = byId.get(edge.to)!;
      to.layer = Math.max(to.layer, from.layer + 1);
      incoming.set(edge.to, incoming.get(edge.to)! - 1);
      if (incoming.get(edge.to) === 0) queue.push(edge.to);
    }
  }

  const layers: Placed[][] = [];
  for (const node of byId.values()) {
    layers[node.layer] = [...(layers[node.layer] ?? []), node];
  }
  const rank = new Map<string, number>();
  for (const layer of layers) {
    if (!layer) continue;
    const parentRank = (node: Placed) => {
      const ranks = forward
        .filter((edge) => edge.to === node.id)
        .map((edge) => rank.get(edge.from) ?? 0);
      return ranks.length ? ranks.reduce((sum, value) => sum + value, 0) / ranks.length : 0;
    };
    const keyed = layer.map((node, index) => ({ node, key: parentRank(node), index }));
    keyed.sort((a, b) => a.key - b.key || a.index - b.index);
    keyed.forEach(({ node }, index) => {
      layer[index] = node;
      rank.set(node.id, index);
    });
  }

  // Across layers: the room each layer takes; along a layer: nodes stacked and centred.
  const gap = edgeLabels ? (horizontal ? 88 : 56) : horizontal ? 56 : 40;
  const across = (node: Placed) => (horizontal ? node.width : node.height);
  const along = (node: Placed) => (horizontal ? node.height : node.width);
  const spans = layers.map((layer) =>
    layer ? layer.reduce((sum, node) => sum + along(node), 0) + NODE_GAP * (layer.length - 1) : 0,
  );
  const longest = Math.max(0, ...spans);
  let offset = 0;
  layers.forEach((layer, index) => {
    if (!layer) return;
    const size = Math.max(...layer.map(across));
    let cursor = (longest - spans[index]!) / 2;
    for (const node of layer) {
      const centre = offset + (size - across(node)) / 2;
      if (horizontal) {
        node.x = centre;
        node.y = cursor;
      } else {
        node.x = cursor;
        node.y = centre;
      }
      cursor += along(node) + NODE_GAP;
    }
    offset += size + gap;
  });
  const extent = Math.max(0, offset - gap);
  const loops =
    valid.length > forward.length ||
    valid.some((edge) => byId.get(edge.from)!.layer === byId.get(edge.to)!.layer);
  return {
    nodes: [...byId.values()],
    edges: valid.map((edge) => ({
      edge,
      from: byId.get(edge.from)!,
      to: byId.get(edge.to)!,
      backward: byId.get(edge.to)!.layer <= byId.get(edge.from)!.layer,
    })),
    width: horizontal ? extent : longest + (loops ? LOOP_ROOM : 0),
    height: horizontal ? longest + (loops ? LOOP_ROOM : 0) : extent,
  };
}

export type Point = [number, number];
export const curveMid = (a: Point, b: Point, c: Point, d: Point): Point => [
  (a[0] + 3 * b[0] + 3 * c[0] + d[0]) / 8,
  (a[1] + 3 * b[1] + 3 * c[1] + d[1]) / 8,
];

/** The four control points of the curve an edge is drawn along. */
export function edgePoints(
  from: Placed,
  to: Placed,
  backward: boolean,
  horizontal: boolean,
): [Point, Point, Point, Point] {
  if (!backward && horizontal) {
    const a: Point = [from.x + from.width, from.y + from.height / 2];
    const d: Point = [to.x, to.y + to.height / 2];
    const bend = (d[0] - a[0]) / 2;
    return [a, [a[0] + bend, a[1]], [d[0] - bend, d[1]], d];
  }
  if (!backward) {
    const a: Point = [from.x + from.width / 2, from.y + from.height];
    const d: Point = [to.x + to.width / 2, to.y];
    const bend = (d[1] - a[1]) / 2;
    return [a, [a[0], a[1] + bend], [d[0], d[1] - bend], d];
  }
  if (horizontal) {
    // Edges that loop back run under the nodes they join.
    const a: Point = [from.x + from.width / 2, from.y + from.height];
    const d: Point = [to.x + to.width / 2, to.y + to.height];
    const low = Math.max(a[1], d[1]) + LOOP_ROOM - 6;
    return [a, [a[0], low], [d[0], low], d];
  }
  const a: Point = [from.x + from.width, from.y + from.height / 2];
  const d: Point = [to.x + to.width, to.y + to.height / 2];
  const right = Math.max(a[0], d[0]) + LOOP_ROOM - 6;
  return [a, [right, a[1]], [right, d[1]], d];
}
