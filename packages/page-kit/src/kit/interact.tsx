import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { isValidElement, useId, useState } from "react";
import { Button, CopyButton } from "./controls.js";
import { DiagramFocus } from "./diagram.js";
import { Inline } from "./inline.js";
import { objectItems } from "./items.js";
import { useWords } from "./labels.js";

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** A child React can render. Plain objects are dropped so hostile page data does not throw. */
function show(value: unknown): ReactNode {
  if (value == null || typeof value === "boolean") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const parts = value.map(show);
    return parts.every(
      (part) => part == null || typeof part === "string" || typeof part === "number",
    )
      ? parts
      : null;
  }
  return isValidElement(value) ? value : null;
}

function rich(value: unknown): ReactNode {
  const shown = show(value);
  return typeof shown === "string" ? <Inline>{shown}</Inline> : shown;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function number(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return finite(parsed) ? parsed : fallback;
}

/** Decimals a step needs: 0.25 shows two, 0.1 shows one, and a whole step shows none. */
function fractionDigits(step: number): number {
  if (!(step > 0) || step >= 1) return 0;
  const written = String(step);
  const exp = /e-(\d+)$/.exec(written);
  return Math.min(6, exp?.[1] ? Number(exp[1]) : (written.split(".")[1]?.length ?? 0));
}

/**
 * A format string the page can write: "£0,0" or "0.00%". The zeros set the fraction, a comma
 * groups thousands, and the characters around them are the prefix and suffix.
 */
function readingFromPattern(
  pattern: string,
  value: number,
  words: { number: (value: number, options?: Intl.NumberFormatOptions) => string },
): string | undefined {
  const match = /^(.*?)(0(?:,0)*(?:\.0+)?)(.*)$/.exec(pattern.trim());
  if (!match) return undefined;
  const skeleton = match[2] ?? "0";
  const decimals = skeleton.includes(".") ? (skeleton.split(".")[1]?.length ?? 0) : 0;
  const body = words.number(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: skeleton.includes(","),
  });
  return `${match[1] ?? ""}${body}${match[3] ?? ""}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The nearest step at or after `low`, kept inside the range. */
function snap(value: number, low: number, high: number, step: number): number {
  const steps = Math.round((value - low) / step);
  const next = Math.round((low + steps * step) * 1e6) / 1e6;
  return clamp(next, low, high);
}

function plain(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || isValidElement(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

type Tick = { value?: number; label?: ReactNode };
type ResultRow = { label?: ReactNode; value?: ReactNode };
type TimelineItem = {
  title?: ReactNode;
  note?: ReactNode;
  detail?: ReactNode;
  series?: number;
  open?: boolean;
  /** A flat list uses date, year or label as the year column. */
  date?: ReactNode;
  year?: ReactNode;
  label?: ReactNode;
};
type TimelineGroup = { label?: ReactNode; items?: TimelineItem[] };
type Choice = string | number | { value?: string | number; label?: ReactNode };
type Stage = { id?: string; label?: ReactNode; title?: ReactNode; detail?: ReactNode };
type StageGroup = { label?: ReactNode; stages?: Stage[] };

function rowsOf(value: unknown): ResultRow[][] {
  if (!Array.isArray(value)) return [];
  const lists = value.some(Array.isArray) ? value.filter(Array.isArray) : [value];
  return lists
    .map((list) => list.filter((item): item is ResultRow => Boolean(plain(item))))
    .filter((list) => list.length > 0);
}

/**
 * A labelled range. The current value sits at the right of the label, and `ticks` are the small
 * captions under the rail. Arrow keys step it. The rail styling also covers a raw range input.
 */
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  format,
  prefix,
  suffix,
  ticks,
  onChange,
}: {
  label?: ReactNode;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  /** A function, or a pattern such as "£0,0" or "0.00%". Either one replaces prefix and suffix. */
  format?: ((value: number) => string) | string;
  prefix?: string;
  suffix?: string;
  ticks?: Tick[];
  onChange?: (value: number) => void;
}) {
  const words = useWords();
  const id = useId();
  const low = number(min, 0);
  const high = Math.max(low, number(max, 100));
  const size = number(step, 1) > 0 ? number(step, 1) : 1;
  const shown = snap(number(value, low), low, high, size);
  const lead = text(prefix);
  const tail = text(suffix);
  let formatted = words.number(shown);
  if (typeof format === "function") {
    try {
      const custom = format(shown);
      if (typeof custom === "string" || typeof custom === "number") formatted = String(custom);
    } catch {
      // A bad formatter still leaves a number the reader can see.
    }
  } else if (typeof format === "string" && format.trim() !== "") {
    formatted = readingFromPattern(format, shown, words) ?? formatted;
  } else if (lead !== "" || tail !== "") {
    const digits = fractionDigits(size);
    formatted = `${lead}${words.number(shown, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}${tail}`;
  }
  const name = text(label);
  const move = (next: number) => onChange?.(snap(next, low, high, size));
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const rtl = words.dir === "rtl";
    const page = Math.max(size, (high - low) / 10);
    const delta =
      event.key === "ArrowRight"
        ? rtl
          ? -size
          : size
        : event.key === "ArrowLeft"
          ? rtl
            ? size
            : -size
          : event.key === "ArrowUp" || event.key === "PageUp"
            ? event.key === "PageUp"
              ? page
              : size
            : event.key === "ArrowDown" || event.key === "PageDown"
              ? event.key === "PageDown"
                ? -page
                : -size
              : 0;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      move(event.key === "Home" ? low : high);
      return;
    }
    if (delta === 0) return;
    event.preventDefault();
    move(shown + delta);
  };
  const marks = objectItems(ticks).flatMap((tick) => {
    const at = number(tick.value, Number.NaN);
    return finite(at) ? [{ at, label: show(tick.label) ?? words.number(at) }] : [];
  });
  return (
    <div className="rk-slider" dir={words.dir}>
      <div className="rk-slider-head">
        {name ? (
          <label className="rk-slider-label" htmlFor={id}>
            {rich(label)}
          </label>
        ) : null}
        <span className="rk-slider-value">{formatted}</span>
      </div>
      <input
        id={id}
        type="range"
        min={low}
        max={high}
        step={size}
        value={shown}
        aria-valuetext={formatted}
        aria-label={name ? undefined : formatted}
        onChange={(event) => move(number(event.target.value, shown))}
        onKeyDown={onKey}
      />
      {marks.length > 0 ? (
        <div className="rk-slider-ticks">
          {marks.map((mark, index) => {
            const ratio = high > low ? (mark.at - low) / (high - low) : 0;
            const edge = ratio <= 0 ? "start" : ratio >= 1 ? "end" : "mid";
            const style: CSSProperties =
              edge === "start"
                ? { insetInlineStart: 0 }
                : edge === "end"
                  ? { insetInlineEnd: 0 }
                  : {
                      insetInlineStart: `${ratio * 100}%`,
                      transform: words.dir === "rtl" ? "translateX(50%)" : "translateX(-50%)",
                    };
            return (
              <span key={index} style={style}>
                {mark.label}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The answer a calculator leads with. `inset` (the default) sets it one shade off the card.
 * `groups` is one list of label-over-value rows, or several lists separated by hairlines.
 */
export function Result({
  label,
  value,
  unit,
  note,
  tone,
  groups,
  copy,
  inset = true,
}: {
  label?: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  tone?: "success" | "warning" | "danger";
  groups?: ResultRow[] | ResultRow[][];
  copy?: { label?: ReactNode; text?: ReactNode };
  inset?: boolean;
}) {
  const words = useWords();
  const toneName = tone === "success" || tone === "warning" || tone === "danger" ? tone : undefined;
  const blocks = rowsOf(groups);
  const action = plain(copy);
  const copyLabel = text(action?.label) || (action ? words.t("copy") : "");
  const copyText = text(action?.text) || text(value);
  return (
    <div className="rk-result" data-inset={inset === false ? undefined : ""} data-tone={toneName}>
      {show(label) != null ? <div className="rk-result-label">{rich(label)}</div> : null}
      {show(value) != null ? (
        <div className="rk-result-value">
          <span>{show(value)}</span>
          {show(unit) != null ? <span className="rk-result-unit">{show(unit)}</span> : null}
        </div>
      ) : null}
      {show(note) != null ? <div className="rk-result-note">{rich(note)}</div> : null}
      {blocks.map((rows, index) => (
        <div className="rk-result-group" key={index}>
          {rows.map((row, rowIndex) => (
            <div className="rk-result-row" key={rowIndex}>
              {show(row.label) != null ? (
                <div className="rk-result-row-label">{rich(row.label)}</div>
              ) : null}
              {show(row.value) != null ? (
                <div className="rk-result-row-value">{show(row.value)}</div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
      {copyLabel ? (
        <div className="rk-result-copy">
          <CopyButton label={copyLabel} text={copyText || copyLabel} />
        </div>
      ) : null}
    </div>
  );
}

/** A year column and milestone rows. A row with detail opens it. `focus` highlights that year. */
export function Timeline({
  groups = [],
  items,
  focus,
}: {
  groups?: TimelineGroup[];
  /** One row per entry when `groups` is empty. `date`, `year` or `label` is the year. */
  items?: TimelineItem[];
  focus?: ReactNode;
}) {
  const fromGroups = objectItems(groups).map((group) => ({
    label: group.label,
    items: objectItems(group.items).filter((item) => plain(item)),
  }));
  const listed =
    fromGroups.length > 0
      ? fromGroups
      : objectItems(items)
          .filter((item) => plain(item))
          .map((item) => ({
            label: item.date ?? item.year ?? item.label,
            items: [item],
          }));
  const seed = listed
    .flatMap((group, groupIndex) =>
      group.items.map((item, itemIndex) =>
        item.open === true ? `${groupIndex}:${itemIndex}` : "",
      ),
    )
    .filter(Boolean)
    .join(",");
  const [opened, setOpened] = useState(seed);
  const [seen, setSeen] = useState(seed);
  if (seen !== seed) {
    setSeen(seed);
    setOpened(seed);
  }
  const current = seen === seed ? opened : seed;
  const open = new Set(current.split(",").filter(Boolean));
  const focusText = text(focus);
  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSeen(seed);
    setOpened([...next].join(","));
  };
  if (listed.length === 0) return null;
  return (
    <div className="rk-timeline">
      {listed.map((group, groupIndex) => (
        <div
          className="rk-timeline-group"
          key={groupIndex}
          data-focus={focusText !== "" && text(group.label) === focusText ? "" : undefined}
        >
          <div className="rk-timeline-year">{show(group.label)}</div>
          <div className="rk-timeline-items">
            {group.items.map((item, itemIndex) => {
              const key = `${groupIndex}:${itemIndex}`;
              const expanded = open.has(key);
              const series = number(item.series, Number.NaN);
              const dot =
                Number.isInteger(series) && series >= 0
                  ? `var(--rk-c${(series % 7) + 1})`
                  : undefined;
              const body = show(item.detail) != null;
              const copy = (
                <>
                  <span
                    className="rk-timeline-dot"
                    style={dot ? { background: dot } : undefined}
                    aria-hidden="true"
                  />
                  <span className="rk-timeline-copy">
                    <span className="rk-timeline-title">{rich(item.title)}</span>
                    {show(item.note) != null ? (
                      <span className="rk-timeline-note">{rich(item.note)}</span>
                    ) : null}
                  </span>
                </>
              );
              return (
                <div className="rk-timeline-item" key={itemIndex}>
                  {body ? (
                    <button
                      type="button"
                      className="rk-timeline-row"
                      aria-expanded={expanded}
                      onClick={() => toggle(key)}
                    >
                      {copy}
                      <svg className="rk-timeline-chevron" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M6 4l4 4-4 4" />
                      </svg>
                    </button>
                  ) : (
                    <div className="rk-timeline-row" data-static="">
                      {copy}
                    </div>
                  )}
                  {body && expanded ? (
                    <div className="rk-timeline-detail">{rich(item.detail)}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A grid of pill buttons. The chosen one is filled. */
export function Choices({
  options = [],
  value,
  onChange,
  columns = 2,
  label,
  radio,
}: {
  options?: Choice[];
  value?: string | number;
  onChange?: (value: string) => void;
  columns?: number;
  label?: ReactNode;
  radio?: boolean;
}) {
  const group = useId();
  const current = value === undefined || value === null ? undefined : String(value);
  const items = (Array.isArray(options) ? options : []).flatMap((option) => {
    if (typeof option === "string" || typeof option === "number") {
      return [{ value: String(option), label: String(option) }];
    }
    const record = plain(option);
    if (!record || !("value" in record)) return [];
    const id = text(record.value);
    return id ? [{ value: id, label: show(record.label) ?? id }] : [];
  });
  const count = clamp(Math.round(number(columns, 2)) || 2, 1, 4);
  const name = text(label);
  // A phone row that is forced into equal columns breaks "Committee" into "Commit" / "ee".
  // The track is at least a short word, and drops a column before it splits one.
  const tracks = radio
    ? "minmax(0, 1fr)"
    : `repeat(auto-fit, minmax(min(100%, max(8.75rem, calc((100% - ${count - 1} * 8px) / ${count}))), 1fr))`;
  return (
    <fieldset className="rk-choices" style={{ gridTemplateColumns: tracks }}>
      {name ? (
        <legend className={radio ? "rk-choice-question" : "rk-visually-hidden"}>{name}</legend>
      ) : null}
      {items.map((item) => {
        const selected = item.value === current;
        if (radio) {
          return (
            <label className="rk-choice-radio" key={item.value}>
              <input
                type="radio"
                name={group}
                value={item.value}
                checked={selected}
                onChange={() => onChange?.(item.value)}
              />
              <span>{item.label}</span>
            </label>
          );
        }
        return (
          <button
            key={item.value}
            type="button"
            className="rk-button"
            data-variant={selected ? "primary" : undefined}
            aria-pressed={selected}
            onClick={() => onChange?.(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Past this many stages a flat pill grid stops being a picker and becomes a wall of buttons. The
 * grouped path's progress bar with Previous and Next, plus the stage's own title, stays compact
 * and readable on a narrow card.
 */
const STAGE_GRID_MAX = 4;

/**
 * A sequence with a shared detail panel. Groups draw their own selectable path;
 * a flat list can highlight a matching node in a child Diagram.
 */
export function Stages({
  stages = [],
  groups,
  value,
  onChange,
  children,
}: {
  stages?: Stage[];
  groups?: StageGroup[];
  value?: string;
  onChange?: (id: string) => void;
  children?: ReactNode;
}) {
  const words = useWords();
  const groupId = useId();
  const grouped = objectItems(groups).flatMap((group) => {
    const entries = objectItems(group.stages).filter(plain);
    return entries.length ? [{ label: show(group.label), entries }] : [];
  });
  const entries = grouped.length ? grouped.flatMap((group) => group.entries) : objectItems(stages);
  const list = entries.flatMap((stage, index) => {
    if (!plain(stage)) return [];
    const id = text(stage.id) || String(index);
    const authored = show(stage.label) ?? show(stage.title);
    return [{ id, label: authored ?? id, authored, stage }];
  });
  const controlled = value !== undefined && value !== null;
  const [internal, setInternal] = useState(0);
  const selected = controlled ? list.findIndex((item) => item.id === String(value)) : internal;
  const index = list.length === 0 ? 0 : clamp(Math.max(selected, 0), 0, list.length - 1);
  const pick = (next: number) => {
    const id = list[next]?.id;
    if (!id) return;
    if (!controlled) setInternal(next);
    onChange?.(id);
  };
  if (list.length === 0) return <>{children}</>;
  const stage = list[index]!;
  const compact = !grouped.length && list.length > STAGE_GRID_MAX;
  // In the compact picker nothing else names the stage, so a real label stands in for a missing
  // title. A bare position number is not a name.
  const named = stage.authored && !/^\d+$/.test(text(stage.authored)) ? stage.authored : null;
  const title = show(stage.stage.title) ?? (grouped.length ? stage.label : compact ? named : null);
  const position = words.t("stageOf", { n: index + 1, total: list.length });
  let cursor = 0;
  return (
    <div className="rk-stages">
      {grouped.length || compact ? (
        <div className="rk-stage-progress">
          <span id={groupId}>{position}</span>
          <progress
            className="rk-progress"
            aria-labelledby={groupId}
            value={index + 1}
            max={list.length}
          />
        </div>
      ) : null}
      {grouped.length ? (
        <div className="rk-stage-path">
          {grouped.map((group, groupIndex) => {
            const start = cursor;
            cursor += group.entries.length;
            const labelId = `${groupId}-${groupIndex}`;
            return (
              <div className="rk-stage-group" key={groupIndex}>
                {group.label != null ? <p id={labelId}>{group.label}</p> : null}
                <ol start={start + 1} aria-labelledby={group.label != null ? labelId : undefined}>
                  {list.slice(start, cursor).map((item, offset) => {
                    const at = start + offset;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="rk-stage-stop"
                          aria-current={at === index ? "step" : undefined}
                          onClick={() => pick(at)}
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
      ) : compact ? null : (
        <Choices
          label={position}
          options={list.map((item) => ({ value: item.id, label: item.label }))}
          value={stage.id}
          columns={Math.min(2, list.length)}
          onChange={(id) => pick(list.findIndex((item) => item.id === id))}
        />
      )}
      <DiagramFocus.Provider value={stage.id}>{children}</DiagramFocus.Provider>
      <div className="rk-stage">
        {!grouped.length && !compact ? <div className="rk-stage-kicker">{position}</div> : null}
        {title != null ? <div className="rk-stage-title">{rich(title)}</div> : null}
        {show(stage.stage.detail) != null ? (
          <div className="rk-stage-body">{rich(stage.stage.detail)}</div>
        ) : null}
        <div className="rk-stage-nav">
          <Button
            label={words.t("previous")}
            disabled={index === 0}
            onClick={() => pick(index - 1)}
          />
          <Button
            label={words.t("next")}
            variant="primary"
            disabled={index === list.length - 1}
            onClick={() => pick(index + 1)}
          />
        </div>
      </div>
    </div>
  );
}

export const INTERACT_CSS = `
input[type="range"]{-webkit-appearance:none;appearance:none;display:block;width:100%;height:24px;margin:0;background:transparent;accent-color:transparent;cursor:pointer}
input[type="range"]:focus{outline:none}
input[type="range"]:focus-visible{outline:2px solid var(--ring);outline-offset:4px;border-radius:999px}
input[type="range"]::-webkit-slider-runnable-track{height:24px;border:0;border-radius:999px;background:color-mix(in srgb,var(--foreground) 6%,transparent)}
input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;margin-top:2px;border-radius:999px;background:var(--rk-primary);border:1px solid color-mix(in srgb,var(--rk-primary-ink) 18%,transparent);box-shadow:none}
input[type="range"]::-moz-range-track{height:24px;border:0;border-radius:999px;background:color-mix(in srgb,var(--foreground) 6%,transparent)}
input[type="range"]::-moz-range-thumb{width:20px;height:20px;border:0;border-radius:999px;background:var(--rk-primary);border:1px solid color-mix(in srgb,var(--rk-primary-ink) 18%,transparent);box-shadow:none}
input[type="range"]::-moz-range-progress{background:transparent}
.rk-slider{display:flex;flex-direction:column;gap:6px;min-width:0}
.rk-slider-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.rk-slider-label{font-size:15px;line-height:20px;font-weight:600}
.rk-slider-value{margin-inline-start:auto;font-size:15px;line-height:20px;font-weight:650;font-variant-numeric:tabular-nums}
.rk-slider-ticks{position:relative;height:16px}
.rk-slider-ticks span{position:absolute;top:0;font-size:12px;line-height:16px;color:var(--rk-secondary);white-space:nowrap}
.rk-result{display:flex;flex-direction:column;gap:4px;min-width:0}
.rk-result[data-inset]{padding:16px;border-radius:12px;background:color-mix(in srgb,var(--foreground) 6%,transparent)}
.rk-result-label,.rk-result-note,.rk-result-row-label{font-size:13px;line-height:18px;color:var(--rk-secondary)}
.rk-result-value{display:flex;align-items:baseline;gap:6px;font-size:40px;line-height:1.1;font-weight:650;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.rk-result-unit{font-size:16px;line-height:22px;font-weight:500;color:var(--rk-secondary)}
.rk-result[data-tone="success"] .rk-result-value{color:var(--rk-success)}
.rk-result[data-tone="warning"] .rk-result-value{color:var(--rk-warning)}
.rk-result[data-tone="danger"] .rk-result-value{color:var(--rk-danger)}
.rk-result-group{display:flex;flex-direction:column;margin-top:8px}
.rk-result-row{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--rk-hairline)}
.rk-result-row-value{font-size:16px;line-height:22px;font-weight:600}
.rk-result-copy{margin-top:8px}
.rk-result-copy .rk-button{width:100%;max-width:none;align-self:stretch}
.rk-timeline{display:flex;flex-direction:column;gap:18px}
.rk-timeline-group{display:grid;grid-template-columns:3.2rem minmax(0,1fr);gap:10px;align-items:start}
.rk-timeline-year{padding-top:12px;font-size:13px;line-height:18px;color:var(--rk-secondary)}
.rk-timeline-group[data-focus] .rk-timeline-year{color:var(--foreground);font-weight:650}
.rk-timeline-items{display:flex;flex-direction:column;gap:8px}
.rk-timeline-row{display:flex;align-items:flex-start;gap:10px;width:100%;margin:0;padding:12px;border:0;border-radius:12px;background:color-mix(in srgb,var(--foreground) 6%,transparent);color:inherit;font:inherit;text-align:start}
button.rk-timeline-row{appearance:none;cursor:pointer}
.rk-timeline-dot{flex:none;width:8px;height:8px;margin-top:6px;border-radius:999px;background:var(--rk-tertiary)}
.rk-timeline-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
.rk-timeline-title{font-size:15px;line-height:20px;font-weight:600}
.rk-timeline-note,.rk-timeline-detail{font-size:13px;line-height:18px;color:var(--rk-secondary)}
.rk-timeline-detail{padding:2px 12px 4px 30px}
.rk-timeline-chevron{flex:none;width:16px;height:16px;margin-top:2px;fill:none;stroke:var(--rk-secondary);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.rk-timeline-row[aria-expanded="true"] .rk-timeline-chevron{transform:rotate(90deg)}
.rk-choices{display:grid;gap:8px;width:100%;margin:0;padding:0;border:0;min-width:0;min-inline-size:0}
/* A nowrap pill kept its full label as min-content and slid out of its cell. Wrap at spaces. A single word breaks only when it is wider than the pill. */
.rk-choices .rk-button{width:100%;max-width:100%;min-width:0;align-self:stretch;height:auto;min-height:36px;white-space:normal;overflow-wrap:break-word;word-break:normal;text-align:center}
@media (pointer:coarse){.rk-choices .rk-button{min-height:44px;height:auto}}
.rk-choice-question{padding:0;margin-bottom:.35rem;font-weight:600}
.rk-choice-radio{display:flex;align-items:flex-start;gap:.55rem;cursor:pointer;color:var(--foreground);overflow-wrap:anywhere}
.rk-choice-radio input{flex:none;accent-color:var(--rk-primary);margin:.2rem 0 0;width:1rem;height:1rem}
.rk-stages{display:flex;flex-direction:column;gap:16px}
.rk-progress{display:block;width:100%;height:.5rem;accent-color:var(--rk-accent)}
.rk-stage-progress{display:flex;flex-direction:column;gap:.375rem;color:var(--rk-secondary);font-size:1rem}
.rk-stage-path{display:grid;gap:1.25rem}
.rk-stage-group{position:relative;padding:.5rem .75rem;background:var(--rk-fill);border-radius:8px}
.rk-stage-group + .rk-stage-group::before{content:"";position:absolute;inset-block-start:-.875rem;inset-inline-start:1.25rem;width:.4rem;height:.4rem;border-bottom:1px solid var(--rk-tertiary);border-right:1px solid var(--rk-tertiary);transform:rotate(45deg)}
.rk-stage-group > p{margin:0 0 .25rem;font-size:.8125rem;color:var(--rk-secondary)}
.rk-stage-group ol{margin:0;padding-inline-start:1.5rem}
.rk-stage-group li::marker{font-size:.8125rem;color:var(--rk-secondary);font-variant-numeric:tabular-nums}
.rk-stage-stop{display:block;width:100%;min-height:2.25rem;padding:.25rem .5rem;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:start;overflow-wrap:break-word;word-break:normal;cursor:pointer}
.rk-stage-stop:hover{background:var(--rk-track)}
.rk-stage-stop[aria-current="step"]{background:var(--rk-primary);color:var(--rk-primary-ink)}
.rk-stage-stop:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.rk-stage{display:flex;flex-direction:column;gap:6px}
.rk-stage-kicker{font-size:13px;line-height:18px;color:var(--rk-secondary)}
.rk-stage-title{font-size:20px;line-height:26px;font-weight:650}
.rk-stage-body{font-size:15px;line-height:22px}
.rk-stage-nav{display:flex;gap:8px;margin-top:8px}
.rk-stage-nav .rk-button{flex:1}
.rk-check-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:14px;line-height:20px;color:var(--rk-secondary)}
.rk-check-section{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:16px 0 4px;font-size:15px;line-height:20px;font-weight:600}
.rk-check-section span:last-child{color:var(--rk-secondary);font-weight:500;font-variant-numeric:tabular-nums}
.rk-check-disclosure summary{justify-content:flex-start;cursor:pointer}
.rk-check-disclosure summary::-webkit-details-marker{display:none}
.rk-check-disclosure summary::before{content:"";align-self:center;width:.35rem;height:.35rem;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(-45deg)}
.rk-check-disclosure[open] summary::before{transform:rotate(45deg)}
.rk-check-disclosure:dir(rtl):not([open]) summary::before{transform:rotate(135deg)}
.rk-check-disclosure summary span:last-child{margin-inline-start:auto}
.rk-check-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.rk-checklist[data-live] .rk-check{cursor:pointer}
`;
