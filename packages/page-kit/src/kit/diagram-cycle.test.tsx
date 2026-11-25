import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Diagram } from "./diagram.js";
import { cycleOccupancy, cycleTextBox, layoutCycle } from "./diagram-cycle.js";
import type { DiagramEdge, DiagramNode } from "./diagram-layout.js";
import { Stages } from "./interact.js";

const heatNodes: DiagramNode[] = [
  { id: "evap", label: "1. Evaporator", icon: "coil", tone: "info" },
  { id: "comp", label: "2. Compressor", icon: "pump", tone: "warning" },
  { id: "cond", label: "3. Condenser", icon: "coil", tone: "danger" },
  { id: "valve", label: "4. Expansion valve", icon: "valve", tone: "info" },
];

const heatEdges: DiagramEdge[] = [
  { from: "evap", to: "comp", tone: "info" },
  { from: "comp", to: "cond", tone: "danger" },
  { from: "cond", to: "valve", tone: "warning" },
  { from: "valve", to: "evap", tone: "info" },
];

const heatOptions = {
  width: 358,
  center: "Refrigerant cycle",
  focus: "evap",
  zones: [
    { label: "Outside", nodes: ["evap"], tone: "info" as const },
    { label: "Inside your home", nodes: ["cond"], tone: "warning" as const },
  ],
  flows: [
    { node: "evap", label: "Heat in", direction: "in" as const, tone: "info" as const },
    { node: "cond", label: "Heat out", direction: "out" as const, tone: "danger" as const },
  ],
};

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

function centre(node: { box: { x: number; y: number; width: number; height: number } }) {
  return { x: node.box.x + node.box.width / 2, y: node.box.y + node.box.height / 2 };
}

function shaft(d: string) {
  const match = /M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)/.exec(d);
  if (!match) throw new Error(d);
  return {
    x1: Number(match[1]),
    y1: Number(match[2]),
    x2: Number(match[3]),
    y2: Number(match[4]),
  };
}

describe("cycle diagrams", () => {
  it("places four nodes clockwise from the left and closes the loop", () => {
    const layout = layoutCycle(heatNodes, heatEdges, heatOptions);
    const byId = Object.fromEntries(layout.nodes.map((node) => [node.id, node]));
    const evap = byId.evap!;
    const comp = byId.comp!;
    const cond = byId.cond!;
    const valve = byId.valve!;
    expect(evap.box.x).toBeLessThan(comp.box.x);
    expect(comp.box.x).toBeLessThan(cond.box.x);
    expect(comp.box.y).toBeLessThan(evap.box.y);
    expect(evap.box.y).toBe(cond.box.y);
    expect(evap.box.y).toBeLessThan(valve.box.y);
    expect(layout.pipes.map((pipe) => [pipe.from, pipe.to, pipe.tone])).toEqual([
      ["evap", "comp", "info"],
      ["comp", "cond", "danger"],
      ["cond", "valve", "warning"],
      ["valve", "evap", "info"],
    ]);
    expect(evap.focused).toBe(true);
    expect(evap.badge?.text).toBe("1");
    expect(layout.nodes.filter((node) => node.badge)).toHaveLength(1);
    expect(layout.center.map((line) => line.text).join(" ")).toBe("Refrigerant cycle");
  });

  it("keeps each zone around its nodes and points flows the way they read", () => {
    const layout = layoutCycle(heatNodes, heatEdges, heatOptions);
    expect(layout.zones).toHaveLength(2);
    for (const zone of layout.zones) {
      for (const id of zone.nodeIds) {
        const node = layout.nodes.find((item) => item.id === id)!;
        const at = centre(node);
        expect(at.x).toBeGreaterThanOrEqual(zone.box.x);
        expect(at.x).toBeLessThanOrEqual(zone.box.x + zone.box.width);
        expect(at.y).toBeGreaterThanOrEqual(zone.box.y);
        expect(at.y).toBeLessThanOrEqual(zone.box.y + zone.box.height);
      }
    }
    const into = layout.flows.find((flow) => flow.label.text === "Heat in")!;
    const out = layout.flows.find((flow) => flow.label.text === "Heat out")!;
    const inward = shaft(into.shafts[0]!);
    const outward = shaft(out.shafts[0]!);
    expect(inward.x2).toBeGreaterThan(inward.x1);
    expect(outward.x2).toBeGreaterThan(outward.x1);
  });

  it("keeps cards and labels from overlapping at a phone width", () => {
    const layout = layoutCycle(heatNodes, heatEdges, heatOptions);
    expect(layout.width).toBeLessThanOrEqual(358);
    const boxes = cycleOccupancy(layout);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]!, boxes[j]!), `${i} hits ${j}`).toBe(false);
      }
    }
    const ring = layoutCycle(
      ["Intake", "Compress", "Ignite", "Expand", "Exhaust", "Cool"].map((label) => ({
        id: label,
        label,
      })),
      [],
      { width: 358, center: "Four stroke" },
    );
    expect(ring.nodes).toHaveLength(6);
    expect(ring.pipes).toHaveLength(6);
    const cards = ring.nodes.map((node) => node.box);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        expect(overlaps(cards[i]!, cards[j]!)).toBe(false);
      }
    }
    const occupied = cycleOccupancy(ring);
    for (let i = 0; i < occupied.length; i++) {
      for (let j = i + 1; j < occupied.length; j++) {
        expect(overlaps(occupied[i]!, occupied[j]!), `${occupied[i]!.x} ${occupied[j]!.x}`).toBe(
          false,
        );
      }
    }
  });

  it("does not badge a node just because every edge meets there", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => ({ id, label: id }));
    const layout = layoutCycle(
      nodes,
      [
        { from: "a", to: "b" },
        { from: "c", to: "b" },
        { from: "d", to: "b" },
      ],
      { width: 358 },
    );
    expect(layout.nodes.every((node) => !node.badge)).toBe(true);
  });

  it("draws the centre, the flows and the focused stage", () => {
    const markup = renderToStaticMarkup(
      <Stages
        stages={[
          { id: "evap", label: "Evaporator" },
          { id: "comp", label: "Compressor" },
          { id: "cond", label: "Condenser" },
          { id: "valve", label: "Valve" },
        ]}
        value="evap"
      >
        <Diagram
          layout="cycle"
          maxWidth={358}
          nodes={heatNodes}
          edges={heatEdges}
          center="Refrigerant cycle"
          zones={heatOptions.zones}
          flows={heatOptions.flows}
        />
      </Stages>,
    );
    expect(markup).toContain("Refrigerant cycle");
    expect(markup).toContain("Heat in");
    expect(markup).toContain("Heat out");
    expect(markup).toContain("rk-diagram-focus");
    expect(markup).toContain("rk-diagram-pipe");
    expect(markup).toContain("--rk-tone:var(--rk-accent)");
    expect(markup).toContain("--rk-tone:var(--rk-danger)");
    const layout = layoutCycle(heatNodes, heatEdges, heatOptions);
    expect(cycleTextBox(layout.center[0]!).width).toBeGreaterThan(20);
  });

  it("ignores a zone or a flow that does not name a node", () => {
    const layout = layoutCycle([{ id: "a", label: "A" }], [], {
      width: 358,
      zones: [
        { label: "Missing", nodes: ["nope"] },
        { label: "", nodes: ["a"] },
      ],
      flows: [{ node: "nope", label: "Gone", direction: "in" }],
      center: "   ",
    });
    expect(layout.zones).toEqual([]);
    expect(layout.flows).toEqual([]);
    expect(layout.center).toEqual([]);
    expect(layout.pipes).toEqual([]);
    expect(layoutCycle(undefined, undefined).height).toBe(0);
  });
});
