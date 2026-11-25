import { describe, expect, it } from "vitest";
import type { ChartNote, LabelBounds, LabelRect, PlacedLabel } from "./label-place.js";
import { placeChartLabels } from "./label-place.js";

const phone: LabelBounds = { left: 36, top: 2, right: 320, bottom: 190 };

function overlaps(a: LabelRect, b: LabelRect) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function expectReadable(placed: PlacedLabel[], bounds: LabelBounds) {
  const visible = placed.filter((label) => !label.hidden);
  expect(visible.length).toBeGreaterThan(0);
  for (const label of visible) {
    const rect = label.rect!;
    expect(rect.x).toBeGreaterThanOrEqual(bounds.left - 0.5);
    expect(rect.y).toBeGreaterThanOrEqual(bounds.top - 0.5);
    expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.right + 0.5);
    expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.bottom + 0.5);
  }
  for (let i = 0; i < visible.length; i++) {
    for (const other of visible.slice(i + 1)) {
      expect(overlaps(visible[i]!.rect!, other.rect!)).toBe(false);
    }
  }
}

describe("chart label placement", () => {
  it("keeps a note at the right edge inside the plot, reading inward", () => {
    const bounds: LabelBounds = { left: 40, top: 4, right: 200, bottom: 160 };
    const [label] = placeChartLabels(
      [{ id: "edge", text: "Pricing change", x: 198, y: 80, kind: "point", preferAbove: true }],
      bounds,
    );
    expect(label!.hidden).toBe(false);
    expect(label!.anchor).toBe("end");
    expectReadable([label!], bounds);
  });

  it("flips a note at the left edge so it does not clip", () => {
    const bounds: LabelBounds = { left: 28, top: 4, right: 300, bottom: 160 };
    const [label] = placeChartLabels(
      [{ id: "low", text: "Aug 2020 low 0.2%", x: 30, y: 90, kind: "point", preferAbove: false }],
      bounds,
    );
    expect(label!.hidden).toBe(false);
    expect(label!.anchor).toBe("start");
    expectReadable([label!], bounds);
  });

  it("drops a note that cannot sit clear of another in a short plot", () => {
    const bounds: LabelBounds = { left: 8, top: 0, right: 150, bottom: 48 };
    const notes: ChartNote[] = [
      { id: "a", text: "Oct 2022 peak 11.1%", x: 70, y: 16, kind: "point", preferAbove: false },
      { id: "b", text: "Oct 2026 3.6%", x: 78, y: 18, kind: "point", preferAbove: false },
    ];
    const placed = placeChartLabels(notes, bounds);
    expect(placed.filter((label) => !label.hidden)).toHaveLength(1);
    expectReadable(placed, bounds);
  });

  it("keeps a reference name and a nearby note from covering each other or the edge", () => {
    const notes: ChartNote[] = [
      { id: "peak", text: "Oct 2022 peak 11.1%", x: 150, y: 24, kind: "point", preferAbove: false },
      { id: "now", text: "Oct 2026 3.6%", x: 230, y: 70, kind: "point", preferAbove: true },
      { id: "ref", text: "BoE 2% target", x: 320, y: 140, kind: "rule" },
      { id: "low", text: "Aug 2020 low 0.2%", x: 120, y: 148, kind: "point", preferAbove: true },
    ];
    const placed = placeChartLabels(notes, phone);
    expect(placed.every((label) => !label.hidden)).toBe(true);
    expectReadable(placed, phone);
    const reference = placed.find((label) => label.id === "ref")!;
    expect(reference.anchor).toBe("end");
    expect(reference.rect!.x + reference.rect!.width).toBeLessThanOrEqual(phone.right + 0.5);
  });

  it("never lets a label's background cover a note's own dot or another note's dot", () => {
    const bounds: LabelBounds = { left: 8, top: 0, right: 150, bottom: 60 };
    const notes: ChartNote[] = [
      { id: "a", text: "Oct 2022 peak 11.1%", x: 70, y: 16, kind: "point", preferAbove: false },
      { id: "b", text: "Oct 2026 3.6%", x: 78, y: 30, kind: "point", preferAbove: true },
    ];
    const placed = placeChartLabels(notes, bounds);
    for (const label of placed.filter((item) => !item.hidden)) {
      for (const note of notes) {
        const marker = { x: note.x - 4, y: note.y - 12, width: 8, height: 24 };
        expect(overlaps(label.rect!, marker)).toBe(false);
      }
    }
  });

  it("does not move a clamped label across its own dot", () => {
    const bounds: LabelBounds = { left: 8, top: 0, right: 300, bottom: 100 };
    const [label] = placeChartLabels(
      [{ id: "a", text: "Peak", x: 100, y: 8, kind: "point", preferAbove: true }],
      bounds,
    );
    const marker = { x: 96, y: -4, width: 8, height: 24 };
    expect(label!.hidden || !overlaps(label!.rect!, marker)).toBe(true);
  });
});
