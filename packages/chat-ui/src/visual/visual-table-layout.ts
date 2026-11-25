import { typeScale } from "@rakazo/ui-tokens";

/** Body size of a fence table. Headers use it too, so a column floor covers both. */
export const TABLE_FONT_SIZE = typeScale.secondary.fontSize;

/** Space between columns. The scroll check uses the same gap the rows draw. */
export const TABLE_COLUMN_GAP = 12;

// Advances for the system font at this size, rounded up from measured words
// ("isomorphism" 88px, "NP-complete" 91px, "Unknown," 68px) so a word is never
// clipped and a phone column is not asked to scroll for a word that fits.
const UPPER = 0.74;
const LOWER = 0.55;
const DIGIT = 0.62;
const MARK = 0.5;

/** Width of one whitespace-delimited token. The column is at least this wide. */
export function tokenWidth(token: string, fontSize: number): number {
  let width = 0;
  for (const char of token) {
    const code = char.codePointAt(0) ?? 0;
    // Accented Latin is about a capital. Anything past Latin Extended-B is at
    // least an em, so a wide word is never given a column narrower than itself.
    const ratio =
      code >= 48 && code <= 57
        ? DIGIT
        : code >= 65 && code <= 90
          ? UPPER
          : code >= 97 && code <= 122
            ? LOWER
            : code <= 127
              ? MARK
              : code <= 0x024f
                ? UPPER
                : 1;
    width += fontSize * ratio;
  }
  return Math.ceil(width);
}

/** The longest word in the cells, in pixels. Wrapping happens at spaces. */
export function columnFloor(texts: readonly string[], fontSize: number): number {
  let floor = 0;
  for (const text of texts) {
    for (const token of text.split(/\s+/)) {
      if (token) floor = Math.max(floor, tokenWidth(token, fontSize));
    }
  }
  return floor;
}

/** Scroll only when the longest words, plus the gaps between them, exceed the column. */
export function columnsNeedScroll(
  floors: readonly number[],
  width: number,
  gap = TABLE_COLUMN_GAP,
): boolean {
  if (width <= 0 || floors.length === 0) return false;
  const content =
    floors.reduce((sum, floor) => sum + floor, 0) + gap * Math.max(0, floors.length - 1);
  return content > width;
}
