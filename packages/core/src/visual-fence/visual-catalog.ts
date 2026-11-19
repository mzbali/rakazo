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
] as const;
export type VisualTag = (typeof VISUAL_TAGS)[number];

export const VISUAL_SUMMARY_MAX_LENGTH = 500;

const STRING_MAX = 2000;
const TEX_MAX = 2000;
const TONES = ["info", "success", "warning", "danger"];
const METRIC_TONES = ["success", "warning", "danger", "accent"];

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
      (series !== undefined &&
        !(Number.isInteger(series) && (series as number) >= 0 && (series as number) <= 4))
    )
      return undefined;
    return pick(node, ["id", "label", "detail", "kind", "series"]);
  });
  if (!nodes) return fail("nodes needs 1 to 24 {id, label, detail?} entries");
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
