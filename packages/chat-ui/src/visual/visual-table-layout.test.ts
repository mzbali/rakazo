import { expect, it } from "vitest";
import { visualStyles } from "./visual-styles";
import {
  columnFloor,
  columnsNeedScroll,
  TABLE_COLUMN_GAP,
  TABLE_FONT_SIZE,
} from "./visual-table-layout";

const CLASS_COLUMNS = ["Class", "Easy to solve?", "Easy to check?", "Examples"];
const CLASS_ROWS = [
  ["P", "Yes", "Yes", "Sorting, shortest path, primality testing"],
  ["NP (not known to be in P)", "Unknown", "Yes", "Factoring, graph isomorphism"],
  [
    "NP-complete",
    "Unknown, probably not",
    "Yes",
    "SAT, Sudoku, traveling salesman (decision version), graph coloring",
  ],
];

const floors = CLASS_COLUMNS.map((column, index) =>
  columnFloor([column, ...CLASS_ROWS.map((row) => row[index] ?? "")], TABLE_FONT_SIZE),
);

it("keeps a column at least as wide as its longest word", () => {
  // Measured on the system font at 15px: isomorphism 88, NP-complete 91, Unknown, 68.
  expect(columnFloor(["isomorphism"], TABLE_FONT_SIZE)).toBeGreaterThanOrEqual(88);
  expect(columnFloor(["NP-complete"], TABLE_FONT_SIZE)).toBeGreaterThanOrEqual(91);
  expect(columnFloor(["Unknown,"], TABLE_FONT_SIZE)).toBeGreaterThanOrEqual(68);
  expect(floors[0]).toBe(columnFloor(["NP-complete"], TABLE_FONT_SIZE));
  expect(floors[0]).toBeGreaterThan(columnFloor(["Class"], TABLE_FONT_SIZE));
  expect(floors[3]).toBe(columnFloor(["isomorphism"], TABLE_FONT_SIZE));
  // A space is a wrap. The phrase's floor is its longest word, not the whole phrase.
  expect(columnFloor(["NP (not known to be in P)"], TABLE_FONT_SIZE)).toBe(
    columnFloor(["known"], TABLE_FONT_SIZE),
  );
  // A wide letter is about an em. Counting it as a mark clips the column.
  expect(columnFloor(["字"], TABLE_FONT_SIZE)).toBeGreaterThanOrEqual(TABLE_FONT_SIZE);
  expect(columnFloor(["Привет"], TABLE_FONT_SIZE)).toBeGreaterThan(
    columnFloor(["pppppp"], TABLE_FONT_SIZE),
  );
});

it("scrolls a phone table only when a word cannot fit", () => {
  // The chat column on a 390px phone is about 358px.
  expect(columnsNeedScroll(floors, 358)).toBe(false);
  expect(columnsNeedScroll(floors, 280)).toBe(true);
  expect(columnsNeedScroll(floors, 0)).toBe(false);
  const short = Array.from({ length: 5 }, () => columnFloor(["Yes"], TABLE_FONT_SIZE));
  expect(columnsNeedScroll(short, 390, TABLE_COLUMN_GAP)).toBe(false);
  expect(
    columnsNeedScroll([columnFloor(["Supercalifragilisticexpialidocious"], TABLE_FONT_SIZE)], 200),
  ).toBe(true);
});

it("draws the chat table as hairline rows across the column", () => {
  const css = visualStyles();
  expect(css).toContain(".rkv-root .rk-table-box{border:0");
  expect(css).toContain(".rkv-root .rk-table-scroll{mask-image:none;-webkit-mask-image:none}");
  expect(css).toContain("border-bottom:1px solid var(--rk-hairline)");
  expect(css).toContain(
    ".rkv-root .rk-table th{font-size:.9375rem;line-height:1.375rem;font-weight:600}",
  );
  expect(css).toContain(".rkv-root .rk-table tbody tr:last-child td{border-bottom:0}");
  expect(css).not.toMatch(/\.rkv-root \.rk-table th\{[^}]*overflow-wrap:anywhere/);
});
