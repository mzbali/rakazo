import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { TICK } from "./scale.js";

/** Drawn at the container's real width, so tick text keeps its size on a phone. */
export function useWidth(fallback: number) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => setElement(node), []);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, width };
}

type TipRow = { name?: ReactNode; value: ReactNode; color?: string };
type TipState = { x: number; y: number; title?: ReactNode; rows: TipRow[] };

/** The exact figures under the pointer or keyboard focus, in a small card above the point. */
export function ChartTip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 64), Math.max(64, width - 64));
  return (
    <div className="rk-tip" style={{ left, top: tip.y }} role="presentation">
      {tip.title != null && tip.title !== "" ? (
        <div className="rk-tip-title">{tip.title}</div>
      ) : null}
      {tip.rows.map((row, index) => (
        <div className="rk-tip-row" key={index}>
          {row.color ? <span className="rk-tip-swatch" style={{ background: row.color }} /> : null}
          {row.name != null && row.name !== "" ? <span>{row.name}</span> : null}
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * One highlighted item at a time, picked by pointer or by the arrow keys once the chart has
 * focus, so the figures in the tip are reachable without a mouse.
 */
export function useActive(count: number, indexAt: (x: number, y: number) => number | null) {
  const [active, setActive] = useState<number | null>(null);
  const [pointerTarget, setPointerTarget] = useState<Element | null>(null);
  useEffect(() => {
    const target = pointerTarget;
    if (active === null || !target) return;
    const dismissOutside = (event: globalThis.PointerEvent) => {
      if (!event.composedPath().includes(target)) setActive(null);
    };
    const document = target.ownerDocument;
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [active, pointerTarget]);
  const current = active !== null && active < count ? active : null;
  const onPointerMove = (event: PointerEvent<Element>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(indexAt(event.clientX - box.left, event.clientY - box.top));
  };
  const onKeyDown = (event: KeyboardEvent<Element>) => {
    if (count === 0) return;
    const keys: Record<string, number> = {
      ArrowRight: (current ?? -1) + 1,
      ArrowDown: (current ?? -1) + 1,
      ArrowLeft: (current ?? count) - 1,
      ArrowUp: (current ?? count) - 1,
      Home: 0,
      End: count - 1,
    };
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(count - 1, Math.max(0, next)));
  };
  return {
    active: current,
    setActive,
    props: {
      tabIndex: count > 0 ? 0 : undefined,
      onPointerMove,
      // A tap on a touch screen picks the item under the finger, as hovering does.
      onPointerDown: (event: PointerEvent<Element>) => {
        setPointerTarget(event.currentTarget);
        onPointerMove(event);
      },
      onPointerLeave: (event: PointerEvent<Element>) => {
        // Touch pointers leave when the finger lifts, not just when leaving the chart.
        if (event.pointerType !== "touch") setActive(null);
      },
      onPointerCancel: () => setActive(null),
      onKeyDown,
      onBlur: () => setActive(null),
    },
  };
}

export type { Formatter } from "./scale.js";
export {
  axisGutter,
  finite,
  formatValue,
  niceStep,
  numbers,
  seriesColor,
  TICK,
  textWidth,
  valueScale,
} from "./scale.js";

/** Which x labels to print: every nth, always the last, never two crowded together. */
export function thinLabels(count: number, room: number, labelWidth: number, most = 6): number[] {
  if (count <= 0) return [];
  const fits = Math.max(2, Math.min(most, Math.floor(room / Math.max(labelWidth, 1))));
  const step = Math.max(1, Math.ceil(count / fits));
  const shown: number[] = [];
  for (let index = 0; index < count; index += step) shown.push(index);
  const last = count - 1;
  if (shown[shown.length - 1] !== last) {
    if (shown.length > 1 && last - shown[shown.length - 1]! < step * 0.75) shown.pop();
    shown.push(last);
  }
  return shown;
}

export type LegendItem = { name: ReactNode; color: string; mark?: "dot" | "line" | "dash" };

/** The series key above a chart: dots for filled marks, short strokes for lines. */
export function SeriesLegend({ items, small }: { items: LegendItem[]; small?: boolean }) {
  if (items.length < 1) return null;
  return (
    <ul className="rk-key">
      {items.map((item, index) => (
        <li className="rk-key-item" key={index}>
          {item.mark === "line" || item.mark === "dash" ? (
            <svg className="rk-key-line" width="14" height="2" aria-hidden="true">
              <line
                x1="0"
                x2="14"
                y1="1"
                y2="1"
                style={{ stroke: item.color }}
                strokeWidth="2"
                strokeDasharray={item.mark === "dash" ? "3 2" : undefined}
              />
            </svg>
          ) : (
            <span
              className="rk-key-dot"
              data-small={small || undefined}
              style={{ background: item.color }}
              aria-hidden="true"
            />
          )}
          {item.name}
        </li>
      ))}
    </ul>
  );
}

/** The y axis: a faint gridline and a label for each tick, labels right-aligned in the gutter. */
export function ValueGrid({
  ticks,
  y,
  left,
  right,
  label,
}: {
  ticks: number[];
  y: (value: number) => number;
  left: number;
  right: number;
  label: (value: number) => string;
}) {
  return (
    <>
      {ticks.map((tick, index) => (
        <g key={index}>
          <line className="rk-grid-line" x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
          <text className="rk-tick" x={left - TICK.gap} y={y(tick)} dy="0.35em" textAnchor="end">
            {label(tick)}
          </text>
        </g>
      ))}
    </>
  );
}

export const describe = (parts: string[]) => parts.filter(Boolean).join("; ");
export const text = (node: unknown) =>
  typeof node === "string" || typeof node === "number" ? String(node) : "";

// Charts have a fixed plot height so a grid of them lines up; labels sit below the plot.
export const PLOT = { height: 264, top: 10, bottom: 22, right: 4 };
