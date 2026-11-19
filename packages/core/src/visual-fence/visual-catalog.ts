import type { VisualObject, VisualValue } from "./visual-literal.js";

/** The tags a ```ui fence may use. Anything else draws as "couldn't draw". */
export const VISUAL_TAGS = [
  "Visual",
  "Callout",
  "Steps",
  "Metrics",
  "Diagram",
  "Grid",
  "Formula",
  "Bars",
  "LineChart",
  "Pie",
  "Table",
  "ProsCons",
  "Status",
  "CopyButton",
  "Tabs",
  "Tab",
] as const;
export type VisualTag = (typeof VISUAL_TAGS)[number];

export const VISUAL_SUMMARY_MAX_LENGTH = 500;

const STRING_MAX = 2000;
const TEX_MAX = 2000;
const COPY_MAX = 2000;
const STATUS_MAX = 40;
const TONES = ["info", "success", "warning", "danger"];
const METRIC_TONES = ["success", "warning", "danger", "accent"];
const PILL_TONES = ["neutral", "info", "success", "warning", "danger"];
const ALIGNS = ["start", "end", "center"];

/** The icons a diagram node may name; `DIAGRAM_ICONS` in page-kit draws each of them. */
export const DIAGRAM_ICON_NAMES = [
  "database",
  "server",
  "cloud",
  "user",
  "users",
  "file",
  "folder",
  "globe",
  "lock",
  "key",
  "mail",
  "cpu",
  "code",
  "search",
  "settings",
  "zap",
  "shield",
  "bell",
  "clock",
] as const;

/** What a tag holds: elements, plain text, or nothing but its props. */
type Content = "elements" | "text" | "none";

type Checked = { props: VisualObject } | { error: string };

type TagRule = {
  content: Content;
  /** When the tag's props are known: as soon as its opening tag closes, or at `/>` or its closer. */
  check: (props: VisualObject, text: string) => Checked;
};

const isObject = (value: VisualValue | undefined): value is VisualObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (error: string): Checked => ({ error });

/** A string that fits, or undefined when it is absent; `false` when present but not a string. */
function text(value: VisualValue | undefined, max = STRING_MAX): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= max ? value : false;
}

function oneOf(
  value: VisualValue | undefined,
  allowed: readonly string[],
): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "string" && allowed.includes(value) ? value : false;
}

/** Keeps only the named props, so a prop nobody asked for never reaches a component. */
function pick(source: VisualObject, names: readonly string[]): VisualObject {
  const out: VisualObject = {};
  for (const name of names) if (source[name] !== undefined) out[name] = source[name];
  return out;
}

function list(
  value: VisualValue | undefined,
  max: number,
  entry: (item: VisualObject) => VisualObject | undefined,
): VisualObject[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return undefined;
  const items: VisualObject[] = [];
  for (const item of value) {
    const checked = isObject(item) ? entry(item) : undefined;
    if (!checked) return undefined;
    items.push(checked);
  }
  return items;
}

const finiteNumber = (value: VisualValue | undefined) =>
  typeof value === "number" && Number.isFinite(value);

/** Past this a line chart's axis cannot tell a value from the next one, so it would draw no plot. */
const AXIS_NUMBER_MAX = 1e15;
const axisNumber = (value: VisualValue | undefined) =>
  finiteNumber(value) && Math.abs(value as number) <= AXIS_NUMBER_MAX;

function steps(props: VisualObject): Checked {
  const items = list(props.steps, 20, (step) => {
    const title = text(step.title);
    const detail = text(step.detail);
    if (!title || detail === false) return undefined;
    return pick(step, ["title", "detail"]);
  });
  return items ? { props: { steps: items } } : fail("steps needs 1 to 20 {title, detail?} entries");
}

function metrics(props: VisualObject): Checked {
  const items = list(props.metrics, 8, (metric) => {
    const value = metric.value;
    const shown = typeof value === "string" ? value.length <= STRING_MAX : finiteNumber(value);
    const trend = metric.trend;
    const goodTrend =
      trend === undefined ||
      (Array.isArray(trend) && trend.length <= 60 && trend.every(finiteNumber));
    const delta = metric.delta;
    const goodDelta =
      delta === undefined ||
      finiteNumber(delta) ||
      (typeof delta === "string" && delta.length <= 40);
    if (
      !shown ||
      !text(metric.label) ||
      text(metric.detail) === false ||
      !goodTrend ||
      !goodDelta ||
      oneOf(metric.better, ["up", "down"]) === false ||
      oneOf(metric.tone, METRIC_TONES) === false
    )
      return undefined;
    return pick(metric, ["value", "label", "delta", "better", "detail", "tone", "trend"]);
  });
  return items
    ? { props: { metrics: items } }
    : fail("metrics needs 1 to 8 {value, label, delta?, better?, detail?, tone?, trend?} entries");
}

function diagram(props: VisualObject): Checked {
  const nodes = list(props.nodes, 24, (node) => {
    const series = node.series;
    if (
      !text(node.id, 80) ||
      !text(node.label) ||
      text(node.detail) === false ||
      oneOf(node.kind, ["box", "terminal"]) === false ||
      oneOf(node.icon, DIAGRAM_ICON_NAMES) === false ||
      (series !== undefined &&
        !(Number.isInteger(series) && (series as number) >= 0 && (series as number) <= 4))
    )
      return undefined;
    return pick(node, ["id", "label", "detail", "kind", "series", "icon"]);
  });
  if (!nodes) return fail("nodes needs 1 to 24 {id, label, detail?, icon?} entries");
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) return fail("node ids must be unique");
  let edges: VisualObject[] = [];
  if (props.edges !== undefined) {
    const checked =
      Array.isArray(props.edges) && props.edges.length === 0
        ? []
        : list(props.edges, 40, (edge) => {
            if (
              typeof edge.from !== "string" ||
              typeof edge.to !== "string" ||
              !ids.has(edge.from) ||
              !ids.has(edge.to) ||
              edge.from === edge.to ||
              text(edge.label, 200) === false ||
              (edge.dashed !== undefined && typeof edge.dashed !== "boolean")
            )
              return undefined;
            return pick(edge, ["from", "to", "label", "dashed"]);
          });
    if (!checked) return fail("edges needs up to 40 {from, to, label?} entries naming node ids");
    edges = checked;
  }
  const direction = oneOf(props.direction, ["horizontal", "vertical"]);
  if (direction === false) return fail("direction is horizontal or vertical");
  return { props: { nodes, edges, ...(direction ? { direction } : {}) } };
}

const numberInRange = (value: VisualValue | undefined, low: number, high: number) =>
  axisNumber(value) && (value as number) >= low && (value as number) <= high;

/** Up to `max` finite numbers, at least one. */
function numbers(value: VisualValue | undefined, max: number): number[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.length <= max && value.every(axisNumber)
    ? (value as number[])
    : undefined;
}

function bars(props: VisualObject): Checked {
  const items = list(props.bars, 20, (bar) =>
    text(bar.label, 120) && finiteNumber(bar.value) && text(bar.display, 40) !== false
      ? pick(bar, ["label", "value", "display"])
      : undefined,
  );
  if (!items) return fail("bars needs 1 to 20 {label, value, display?} entries");
  const emphasis = props.emphasis;
  if (
    emphasis !== undefined &&
    emphasis !== "none" &&
    !(Number.isInteger(emphasis) && numberInRange(emphasis, 0, items.length - 1))
  )
    return fail('emphasis is a bar number or "none"');
  return { props: { bars: items, ...pick(props, ["emphasis"]) } };
}

function lineChart(props: VisualObject): Checked {
  const points = list(props.points, 120, (point) =>
    text(point.label, 40) !== false && axisNumber(point.value)
      ? pick(point, ["label", "value"])
      : undefined,
  );
  if (!points) return fail("points needs 1 to 120 {label?, value} entries");
  let lines: VisualObject[] | undefined;
  if (props.lines !== undefined) {
    lines = list(props.lines, 4, (line) =>
      text(line.label, 60) !== false && numbers(line.values, 120)
        ? pick(line, ["label", "values"])
        : undefined,
    );
    if (!lines) return fail("lines needs up to 4 {label?, values} entries of numbers");
  }
  const names = props.labels;
  if (
    names !== undefined &&
    !(
      Array.isArray(names) &&
      names.length <= 5 &&
      names.every((name) => typeof name === "string" && name.length <= 60)
    )
  )
    return fail("labels is up to 5 series names");
  if (
    (props.floor !== undefined && !axisNumber(props.floor)) ||
    (props.ceiling !== undefined && !axisNumber(props.ceiling)) ||
    text(props.unit, 12) === false
  )
    return fail("floor and ceiling are numbers; unit is a short text");
  return {
    props: {
      points,
      ...(lines ? { lines } : {}),
      ...pick(props, ["floor", "ceiling", "unit", "labels"]),
    },
  };
}

function pie(props: VisualObject): Checked {
  const parts = list(props.parts, 12, (part) =>
    text(part.label, 80) &&
    finiteNumber(part.value) &&
    (part.value as number) >= 0 &&
    text(part.display, 40) !== false
      ? pick(part, ["label", "value", "display"])
      : undefined,
  );
  if (!parts) return fail("parts needs 1 to 12 {label, value, display?} entries");
  const total = props.total;
  if (total !== undefined && total !== true && !(typeof total === "string" && total.length <= 40))
    return fail("total is true or a short text");
  if (text(props.label, 40) === false) return fail("label is a short text");
  return { props: { parts, ...pick(props, ["total", "label"]) } };
}

/** A cell as the table draws it, or undefined when it is not usable. */
function tableCell(cell: VisualValue | undefined): VisualValue | undefined {
  if ((typeof cell === "string" && cell.length <= 200) || finiteNumber(cell)) return cell;
  if (!isObject(cell) || typeof cell.text !== "string" || cell.text.length > 200) return undefined;
  return oneOf(cell.tone, PILL_TONES) === false ? undefined : pick(cell, ["text", "tone"]);
}

function table(props: VisualObject): Checked {
  const columns = props.columns;
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > 8 ||
    !columns.every((column) => typeof column === "string" && column.length <= 80)
  )
    return fail("columns needs 1 to 8 short texts");
  const rows: VisualValue[][] = [];
  if (!Array.isArray(props.rows) || props.rows.length === 0 || props.rows.length > 50)
    return fail("rows needs 1 to 50 rows");
  for (const row of props.rows) {
    const cells = Array.isArray(row) ? row.map(tableCell) : [];
    if (!Array.isArray(row) || row.length > columns.length || cells.includes(undefined))
      return fail("each row is up to one text, number or {text, tone?} per column");
    rows.push(cells as VisualValue[]);
  }
  const align = props.align;
  if (
    align !== undefined &&
    !(
      Array.isArray(align) &&
      align.length <= columns.length &&
      align.every((entry) => typeof entry === "string" && ALIGNS.includes(entry))
    )
  )
    return fail("align is start, end or center per column");
  const emphasis = props.emphasis;
  if (
    emphasis !== undefined &&
    !(Number.isInteger(emphasis) && numberInRange(emphasis, 0, columns.length - 1))
  )
    return fail("emphasis is a column number");
  return { props: { columns, rows, ...pick(props, ["align", "emphasis"]) } };
}

/** Up to eight short points, or undefined when one is not usable. */
function points(value: VisualValue | undefined): string[] | undefined | false {
  if (value === undefined) return undefined;
  return Array.isArray(value) &&
    value.length <= 8 &&
    value.every((item) => typeof item === "string" && item.trim() !== "" && item.length <= 300)
    ? (value as string[])
    : false;
}

function prosCons(props: VisualObject): Checked {
  const pros = points(props.pros);
  const cons = points(props.cons);
  if (
    pros === false ||
    cons === false ||
    !(pros?.length || cons?.length) ||
    text(props.prosHeading, 60) === false ||
    text(props.consHeading, 60) === false
  )
    return fail(
      "pros and cons are up to 8 short points each, one of them filled; headings are text",
    );
  return { props: pick(props, ["pros", "cons", "prosHeading", "consHeading"]) };
}

function copyButton(props: VisualObject): Checked {
  const label = text(props.label, 40);
  const copy = text(props.text, COPY_MAX);
  if (!label || !copy) return fail(`label (40) and text (${COPY_MAX} characters) are required`);
  return { props: { label, text: copy } };
}

const RULES: Record<VisualTag, TagRule> = {
  Visual: {
    content: "elements",
    check(props) {
      const summary = props.summary;
      if (
        typeof summary !== "string" ||
        !summary.trim() ||
        summary.length > VISUAL_SUMMARY_MAX_LENGTH
      )
        return fail(`summary is required, at most ${VISUAL_SUMMARY_MAX_LENGTH} characters`);
      return { props: { summary } };
    },
  },
  Callout: {
    content: "text",
    check(props, body) {
      const lead = text(props.lead, 200);
      const tone = oneOf(props.tone, TONES);
      if (lead === false || tone === false)
        return fail("lead is text; tone is info, success, warning or danger");
      if (!lead && !body) return fail("a callout needs a lead or text");
      return { props: pick(props, ["lead", "tone"]) };
    },
  },
  Steps: { content: "none", check: steps },
  Metrics: { content: "none", check: metrics },
  Diagram: { content: "none", check: diagram },
  Grid: {
    content: "elements",
    check(props) {
      const columns = props.columns;
      if (columns === undefined) return { props: {} };
      if (!Number.isInteger(columns) || (columns as number) < 1 || (columns as number) > 4)
        return fail("columns is 1 to 4");
      return { props: { columns } };
    },
  },
  Bars: { content: "none", check: bars },
  LineChart: { content: "none", check: lineChart },
  Pie: { content: "none", check: pie },
  Table: { content: "none", check: table },
  ProsCons: { content: "none", check: prosCons },
  Status: {
    content: "text",
    check(props, body) {
      const tone = oneOf(props.tone, PILL_TONES);
      if (tone === false || !body || body.length > STATUS_MAX)
        return fail(
          `a status is up to ${STATUS_MAX} characters; tone is neutral, info, success, warning or danger`,
        );
      return { props: pick(props, ["tone"]) };
    },
  },
  CopyButton: { content: "none", check: copyButton },
  Tabs: { content: "elements", check: () => ({ props: {} }) },
  Tab: {
    content: "elements",
    check(props) {
      const label = text(props.label, 60);
      return label ? { props: { label } } : fail("label is required, at most 60 characters");
    },
  },
  Formula: {
    content: "none",
    check(props) {
      const tex = text(props.tex, TEX_MAX);
      return tex ? { props: { tex } } : fail(`tex is required, at most ${TEX_MAX} characters`);
    },
  },
};

export function isVisualTag(name: string): name is VisualTag {
  return Object.hasOwn(RULES, name);
}

/** Whether the tag holds elements, so its complete children draw while it is still open. */
export function visualContent(tag: VisualTag): Content {
  return RULES[tag].content;
}

export function checkVisualTag(tag: VisualTag, props: VisualObject, body: string): Checked {
  return RULES[tag].check(props, body);
}

/** Whether the tag's children are elements, by tag name; an unknown tag holds none. */
export function holdsVisualElements(tag: string): boolean {
  return isVisualTag(tag) && RULES[tag].content === "elements";
}
