import { expect, it } from "vitest";
import { PAGE_STYLES } from "./styles.js";

const rule = (selector: string) =>
  PAGE_STYLES.match(new RegExp(`${selector.replaceAll(".", "\\.")}\\{[^}]*\\}`))?.[0] ?? "";

it("sizes a column to its longest word instead of breaking the word", () => {
  const cells = rule(".rk-table th,.rk-table td");
  // anywhere would count every character toward min-content, so a short header
  // becomes the column and "known" breaks into "kno" / "wn".
  expect(cells).toContain("overflow-wrap:normal");
  expect(cells).toContain("word-break:normal");
  expect(cells).toContain("white-space:normal");
  expect(cells).toContain("min-width:min-content");
  expect(cells).not.toContain("anywhere");
  expect(rule(".rk-table th")).not.toContain("nowrap");
  expect(rule(".rk-table th")).toContain("font-weight:600");
  expect(PAGE_STYLES).toContain("min-width:min-content");
  // The scrollport must be allowed to be narrower than the table, or the card clips the last column.
  expect(rule(".rk-table-scroll")).toContain("min-width:0");
  expect(rule(".rk-table-scroll")).toContain("max-width:100%");
  expect(PAGE_STYLES).not.toContain(".rk-table th,.rk-table[data-wide] td{white-space:nowrap}");
  // Figures stay on one line. Their own rule is more specific than the cell wrap.
  expect(PAGE_STYLES).toContain(".rk-table .rk-align-end{text-align:right");
  expect(rule(".rk-table .rk-align-end")).toContain("white-space:nowrap");
  // A hyphen is a break point, so the whole token is held and the column grows to fit it.
  const word = rule(".rk-table .rk-word");
  expect(word).toContain("white-space:nowrap");
  expect(word).toContain("overflow-wrap:normal");
});
