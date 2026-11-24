import type { ReactNode } from "react";
import type { Words } from "../labels.js";
import { useWords } from "../labels.js";
import { describe, finite, seriesColor, text, textWidth, useWidth } from "./shared.js";
import { EmptyChart } from "./status.js";

type VennSet = {
  label: ReactNode;
  count?: number;
  items?: ReactNode[];
  /** A second line under the label. Nested circles use it inside the band. */
  note?: ReactNode;
  tone?: "success" | "warning" | "danger" | "info" | "accent";
};

const TONE_VAR: Record<NonNullable<VennSet["tone"]>, string> = {
  success: "var(--success)",
  warning: "var(--rk-warning)",
  danger: "var(--destructive)",
  info: "var(--rk-accent)",
  accent: "var(--rk-accent)",
};

function toneColor(tone: unknown): string | undefined {
  return typeof tone === "string" && Object.hasOwn(TONE_VAR, tone)
    ? TONE_VAR[tone as NonNullable<VennSet["tone"]>]
    : undefined;
}

const NESTED_NAME = 20;
const NESTED_NOTE = 14;

/** How tall a set's label is, so the circle inside it can leave that band clear. */
function nestedReserve(set: VennSet, room: number, counted: boolean): number {
  const nameLines = Math.min(2, Math.max(1, wrapWords(text(set.label), room).length));
  const noteLines = Math.min(2, wrapWords(text(set.note), room).length);
  const extra = (noteLines + (counted ? 1 : 0)) * NESTED_NOTE;
  return nameLines * NESTED_NAME + extra + 22;
}

/**
 * Circles from the outside in. An inner circle keeps the ratio when the ring already
 * holds the label, and shrinks and drops when the ring would swallow it.
 */
function nestedLayout(
  shown: VennSet[],
  outer: number,
  count: (set: VennSet) => number | undefined,
): { r: number; cy: number }[] {
  const placed: { r: number; cy: number }[] = [];
  let radius = outer;
  let centre = 10 + outer;
  const room = Math.max(48, outer * 1.4);
  for (let index = 0; index < shown.length; index++) {
    placed.push({ r: radius, cy: centre });
    if (index === shown.length - 1) break;
    const reserve = nestedReserve(shown[index]!, room, count(shown[index]!) !== undefined);
    const ratio = shown.length === 2 ? 0.48 : index === 0 ? 0.66 : 0.42;
    const cap = radius - (reserve + 8) / 2;
    const inner = Math.min(radius * ratio, Math.max(radius * 0.34, cap), radius - 14);
    const next = Math.max(12, inner);
    const space = Math.max(0, radius - next - 8);
    const needed = Math.max(0, reserve - (radius - next));
    const shift = Math.min(space, Math.max(needed, space * 0.35));
    centre += shift;
    radius = next;
  }
  return placed;
}

/** Words in lines no wider than `max`, measured as the chart's labels are. */
function wrapWords(words: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of words.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && textWidth(`${last} ${word}`) <= max) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

/** Nested circles. The first set is the outside one, and each label sits in its own band. */
function nestedCircles(
  shown: VennSet[],
  width: number,
  count: (set: VennSet) => number | undefined,
  words: Words,
) {
  const outer = Math.max(48, (width - 16) / 2);
  const placed = nestedLayout(shown, outer, count);
  const cx = width / 2;
  const height = Math.round(outer * 2 + 20);
  const described = shown.map((set) => {
    const note = text(set.note);
    const total = count(set);
    return [text(set.label), note, total !== undefined ? words.number(total) : ""]
      .filter(Boolean)
      .join(", ");
  });
  return (
    <svg
      role="img"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={describe(described)}
    >
      {placed.map(({ r, cy }, i) => {
        const tone = toneColor(shown[i]?.tone);
        const innermost = i === placed.length - 1;
        const emphasised = Boolean(innermost && tone);
        const stroke = emphasised
          ? `color-mix(in srgb, ${tone} 62%, var(--background))`
          : tone
            ? `color-mix(in srgb, ${tone} 40%, var(--background))`
            : "color-mix(in srgb, var(--foreground) 28%, transparent)";
        const fill = emphasised
          ? `color-mix(in srgb, ${tone} 10%, var(--background))`
          : "color-mix(in srgb, var(--foreground) 4%, var(--background))";
        return (
          <circle
            key={i}
            className="rk-venn-set"
            cx={cx}
            cy={cy}
            r={r}
            style={{
              fill,
              stroke,
              fillOpacity: 1,
              strokeWidth: emphasised ? 2 : 1.5,
            }}
          />
        );
      })}
      {placed.map(({ r, cy: centre }, i) => {
        const set = shown[i]!;
        const room = Math.max(48, r * 1.6);
        const name = wrapWords(text(set.label), room).slice(0, 2);
        const note = wrapWords(text(set.note), room).slice(0, 2);
        const total = count(set);
        const nameSize = outer >= 56 ? 20 : 16;
        const noteSize = 14;
        const lines = name.length + note.length + (total !== undefined ? 1 : 0);
        const block = name.length * nameSize + (lines - name.length) * noteSize;
        const last = i === placed.length - 1;
        // Outer names sit in the top of their circle. The innermost name is centred.
        const y = (last ? centre - block / 2 : centre - r + 8) + nameSize * 0.8;
        const noteY = y + name.length * nameSize;
        const countY = noteY + note.length * noteSize;
        return (
          <g key={`l${i}`}>
            {name.length > 0 ? (
              <text
                className="rk-venn-name"
                x={cx}
                y={y}
                textAnchor="middle"
                style={{ fontSize: nameSize }}
              >
                {name.map((line, index) => (
                  <tspan key={index} x={cx} dy={index === 0 ? 0 : nameSize}>
                    {line}
                  </tspan>
                ))}
              </text>
            ) : null}
            {note.length > 0 ? (
              <text
                className="rk-venn-count"
                x={cx}
                y={noteY}
                textAnchor="middle"
                style={{ fontSize: noteSize }}
              >
                {note.map((line, index) => (
                  <tspan key={index} x={cx} dy={index === 0 ? 0 : noteSize}>
                    {line}
                  </tspan>
                ))}
              </text>
            ) : null}
            {total !== undefined ? (
              <text className="rk-venn-count" x={cx} y={countY} textAnchor="middle">
                {words.number(total)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** Two or three overlapping sets, or with `nested` one circle inside the next. */
export function Venn({
  sets = [],
  overlap,
  nested = false,
}: {
  sets?: VennSet[];
  overlap?: ReactNode;
  nested?: boolean;
}) {
  const words = useWords();
  const { ref, width } = useWidth(560);
  const shown = (Array.isArray(sets) ? sets : [])
    .filter((set) => set && set.label != null)
    .slice(0, 3);
  if (shown.length === 0) return <EmptyChart />;
  const count = (set: VennSet) =>
    finite(set.count) ? set.count : Array.isArray(set.items) ? set.items.length : undefined;
  if (nested === true) {
    return (
      <div className="rk-chart rk-frame rk-venn" data-layout="nested" ref={ref}>
        {nestedCircles(shown, width, count, words)}
      </div>
    );
  }
  const r = Math.max(40, Math.min(79, (width - 160) / 3.2));
  const center = width / 2;
  const three = shown.length === 3;
  const dx = shown.length === 1 ? 0 : r * 0.754;
  const height = three ? Math.round(r * 3.16) : Math.round(r * 2 + 20);
  const cy = 10 + r;
  const circles = [
    { cx: center - dx, cy },
    { cx: center + dx, cy },
    { cx: center, cy: cy + r * 0.98 },
  ].slice(0, shown.length);
  const middle = three ? { x: center, y: (cy * 2 + cy + r * 0.98) / 3 } : { x: center, y: cy };
  return (
    <div className="rk-chart rk-frame rk-venn" ref={ref}>
      <svg
        role="img"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label={describe([
          ...shown.map(
            (set) =>
              `${text(set.label)}${count(set) !== undefined ? ` ${words.number(count(set)!)}` : ""}`,
          ),
          overlap != null ? words.t("shared", { value: text(overlap) }) : "",
        ])}
      >
        {circles.map((c, i) => (
          <circle
            key={i}
            className="rk-venn-set"
            cx={c.cx}
            cy={c.cy}
            r={r}
            style={{ fill: seriesColor(i), stroke: seriesColor(i) }}
          />
        ))}
        {circles.map((c, i) => {
          const set = shown[i]!;
          const leftSide = i === 0;
          const x = leftSide ? c.cx - r - 8 : c.cx + r * (i === 2 ? 0.55 : 1) + 8;
          const yText = i === 2 ? c.cy + r * 0.75 : c.cy - r * 0.5;
          const anchor = leftSide ? "end" : "start";
          return (
            <g key={`l${i}`}>
              <text className="rk-venn-name" x={x} y={yText} textAnchor={anchor}>
                {text(set.label)}
              </text>
              {count(set) !== undefined ? (
                <text className="rk-venn-count" x={x} y={yText + 16} textAnchor={anchor}>
                  {words.number(count(set)!)}
                </text>
              ) : null}
            </g>
          );
        })}
        {overlap != null && overlap !== "" && shown.length > 1
          ? (() => {
              // Wrapped to the shared middle, so a long note stays between the circles.
              const lines = wrapWords(text(overlap), Math.max(56, r * 1.1)).slice(0, 3);
              return (
                <text
                  className="rk-venn-overlap"
                  x={middle.x}
                  y={middle.y - ((lines.length - 1) * 15) / 2}
                  textAnchor="middle"
                >
                  {lines.map((line, index) => (
                    <tspan key={index} x={middle.x} dy={index === 0 ? "0.35em" : 15}>
                      {line}
                    </tspan>
                  ))}
                </text>
              );
            })()
          : null}
      </svg>
    </div>
  );
}

/** A small drawn arrow pointing to the high end of an axis. */
function Arrow() {
  return (
    <svg className="rk-axis-arrow" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h7.5M5.5 2l3 3-3 3" />
    </svg>
  );
}

type MatrixPoint = { label: ReactNode; x: number; y: number };

const axisEnds = (axis: unknown): [string, string] => {
  if (Array.isArray(axis)) return [text(axis[0]), text(axis[1])];
  return ["", text(axis)];
};

/** Four quadrants on two axes from low to high, with items placed by their 0 to 1 position. */
export function Matrix2x2({
  axes,
  quadrants = [],
  points = [],
}: {
  axes?: { x?: string | [string, string]; y?: string | [string, string] };
  quadrants?: ReactNode[];
  points?: MatrixPoint[];
}) {
  const words = useWords();
  const [xLow, xHigh] = axisEnds(axes?.x);
  const [yLow, yHigh] = axisEnds(axes?.y);
  const names = Array.isArray(quadrants) ? quadrants.slice(0, 4) : [];
  const shown = (Array.isArray(points) ? points : []).filter(
    (p) => p && finite(p.x) && finite(p.y),
  );
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const percent = (v: number) => Math.round(v * 10_000) / 100;
  return (
    <div className="rk-matrix rk-frame" dir="ltr">
      <div className="rk-matrix-y" aria-hidden="true">
        <span dir="auto">{yLow}</span>
        <span>
          <bdi>{yHigh}</bdi>
          {yHigh ? <Arrow /> : null}
        </span>
      </div>
      <div className="rk-matrix-body">
        <div
          className="rk-matrix-plot"
          role="img"
          aria-label={describe([
            words.t("matrixAxes", { x: xHigh || "x", y: yHigh || "y" }),
            ...names.map(
              (name, i) =>
                `${words.t((["topLeft", "topRight", "bottomLeft", "bottomRight"] as const)[i]!)}: ${text(name)}`,
            ),
            ...shown.map((p) =>
              words.t("pointAt", {
                label: text(p.label),
                x: words.number(clamp(p.x), { style: "percent", maximumFractionDigits: 0 }),
                y: words.number(clamp(p.y), { style: "percent", maximumFractionDigits: 0 }),
              }),
            ),
          ])}
        >
          {names.map((name, i) => (
            <span
              key={i}
              className="rk-matrix-quadrant"
              dir="auto"
              data-corner={i}
              title={text(name)}
            >
              {name}
            </span>
          ))}
          {shown.map((p, i) => (
            <span
              key={`p${i}`}
              className="rk-matrix-point"
              data-flip={clamp(p.x) > 0.75 || undefined}
              style={{ left: `${percent(clamp(p.x))}%`, top: `${percent(1 - clamp(p.y))}%` }}
            >
              <span className="rk-matrix-dot" />
              <span className="rk-matrix-label" dir="auto" title={text(p.label)}>
                {p.label}
              </span>
            </span>
          ))}
        </div>
        <div className="rk-matrix-x" aria-hidden="true">
          <span dir="auto">{xLow}</span>
          <span>
            <bdi>{xHigh}</bdi>
            {xHigh ? <Arrow /> : null}
          </span>
        </div>
      </div>
    </div>
  );
}
