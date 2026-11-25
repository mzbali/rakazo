import type { ReactNode } from "react";
import type { Words } from "../labels.js";
import { wordsFor } from "../labels.js";

// The numbers behind the charts, with no DOM: the phone app draws from the same scales.

export const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const numbers = (values: unknown): number[] =>
  Array.isArray(values) ? values.filter(finite) : [];

/** The series blue, then six muted hues, then one neutral grey. */
export function seriesColor(index: number): string {
  return index >= 0 && index < 7 ? `var(--rk-c${index + 1})` : "var(--rk-other)";
}

/** Round tick steps (1, 2, 2.5 or 5 times a power of ten) covering the domain. */
export function niceStep(low: number, high: number, count = 4): number {
  const raw = (high - low) / count;
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power;
}

const ROUND_TOPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The next round value at or above the data, so the top gridline reads cleanly. */
function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return (ROUND_TOPS.find((factor) => factor * power >= value - 1e-9 * power) ?? 10) * power;
}

/** Floor, middle and top: enough to read the scale without a ruler. */
export function valueScale(values: number[], floor?: number, ceiling?: number) {
  const low = finite(floor) ? floor : Math.min(0, ...values);
  let high = finite(ceiling) ? ceiling : Math.max(low, ...values);
  if (!finite(ceiling)) high = low + niceCeiling(high - low);
  if (!(high > low)) high = low + 1;
  // On a wide scale the middle is a whole number, so it reads 206 rather than 205.5; a
  // round top such as 25 keeps its exact middle, 12.5.
  const middle = (low + high) / 2;
  return { low, high, ticks: [low, high - low >= 100 ? Math.round(middle) : middle, high] };
}

export type Formatter = (value: number) => ReactNode;

export function chartShare(share: number, words: Pick<Words, "number">, digits = 0): string {
  const maximumFractionDigits = Number.isInteger(digits) ? Math.max(0, Math.min(2, digits)) : 0;
  const minimum = 10 ** (-2 - maximumFractionDigits);
  const formatted = words.number(Math.max(share, minimum), {
    style: "percent",
    maximumFractionDigits,
  });
  return share < minimum ? `<${formatted}` : formatted;
}

/** A caller's format wins; otherwise the figure, then the unit after a thin gap ("30 %"). */
export function formatValue(
  value: number,
  unit?: string,
  format?: Formatter,
  words: Pick<Words, "number"> = wordsFor(undefined),
): string {
  if (typeof format === "function") {
    try {
      const out = format(value);
      if (typeof out === "string" || typeof out === "number") return String(out);
    } catch {
      // A broken formatter falls back to the plain figure rather than losing the chart.
    }
  }
  const magnitude = Math.abs(value);
  let options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };
  if (magnitude >= 100_000) {
    options = { notation: "compact", maximumFractionDigits: 1 };
  } else if (magnitude > 0 && magnitude < 0.01) {
    // Keep tiny values distinct from zero without letting their leading zeros fill the axis.
    options = {
      notation: magnitude < 0.000001 ? "scientific" : "standard",
      maximumSignificantDigits: 3,
    };
  }
  const text = words.number(value, options);
  return unit ? withUnit(text, unit) : text;
}

// Currency symbols lead the figure, short scale and percent marks follow it closely, and words
// ("ms", "users") follow after a space: $12, 40%, 80K, 120 ms. A currency goes after any sign
// the locale puts first, including bidi marks and a true minus: -$12, \u200E-$12 (he), \u2212$12 (sv).
function withUnit(text: string, unit: string): string {
  if (/^\p{Sc}$/u.test(unit)) {
    const sign = /^[\u200E\u200F\u061C]*[-\u2212]/.exec(text)?.[0];
    return sign ? `${sign}${unit}${text.slice(sign.length)}` : `${unit}${text}`;
  }
  if (/^(?:%|‰|[kKMBT]|bn)$/.test(unit)) return `${text}${unit}`;
  return `${text} ${unit}`;
}

/** About how wide 12px tick text is, so the axis gutter fits its longest label. */
export const textWidth = (text: string, size = 12) => text.length * size * 0.55;

export const TICK = { size: 12, gap: 8, minLabel: 36 };

export function axisGutter(labels: string[]) {
  const widest = Math.max(TICK.minLabel - 2, ...labels.map((label) => textWidth(label) + 2));
  return Math.ceil(widest + 8 + TICK.gap);
}
