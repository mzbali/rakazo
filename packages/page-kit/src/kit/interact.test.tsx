// @vitest-environment jsdom
import type { ReactElement } from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LineChart } from "./charts.js";
import { Checklist } from "./data.js";
import { Diagram } from "./diagram.js";
import { Choices, Result, Slider, Stages, Timeline } from "./interact.js";
import { Page } from "./layout.js";
import { PAGE_STYLES } from "./styles.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
});
let root: ReturnType<typeof createRoot> | undefined;
function render(element: ReactElement) {
  root ??= createRoot(host);
  act(() => root!.render(element));
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
});

const key = (element: Element, name: string) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });

describe("slider", () => {
  it("shows the value, steps from the keyboard and names itself from the label", () => {
    function Harness() {
      const [value, setValue] = useState(4);
      return (
        <Slider
          label="Rate"
          value={value}
          min={0}
          max={10}
          step={1}
          format={(n) => `${n.toFixed(2)}%`}
          ticks={[
            { value: 0, label: "0" },
            { value: 10, label: "10" },
          ]}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(host.querySelector(".rk-slider-value")!.textContent).toBe("4.00%");
    expect(input.labels?.[0]?.textContent).toBe("Rate");
    expect(input.getAttribute("aria-valuetext")).toBe("4.00%");
    expect(host.querySelectorAll(".rk-slider-ticks span")).toHaveLength(2);
    key(input, "ArrowRight");
    expect(host.querySelector(".rk-slider-value")!.textContent).toBe("5.00%");
    key(input, "ArrowLeft");
    expect(host.querySelector(".rk-slider-value")!.textContent).toBe("4.00%");
    key(input, "Home");
    expect(host.querySelector(".rk-slider-value")!.textContent).toBe("0.00%");
    key(input, "End");
    expect(host.querySelector(".rk-slider-value")!.textContent).toBe("10.00%");
  });

  it("reverses the horizontal arrows when the page is right to left", () => {
    function Harness() {
      const [value, setValue] = useState(4);
      return (
        <Page title="Rate" lang="he">
          <Slider label="Rate" value={value} min={0} max={10} step={1} onChange={setValue} />
        </Page>
      );
    }
    render(<Harness />);
    key(host.querySelector("input")!, "ArrowRight");
    expect(host.querySelector(".rk-slider-value")!.textContent).toBe("3");
  });
});

describe("checklist", () => {
  it("toggles a row and keeps the section counts, then reset restores them", () => {
    const onChange = vi.fn();
    render(
      <Checklist
        interactive
        onChange={onChange}
        sections={[
          {
            title: "Before",
            items: [{ text: "Shoes", done: true }, { text: "Route" }],
          },
          { title: "After", items: [{ text: "Stretch" }] },
        ]}
      />,
    );
    expect(host.querySelector(".rk-check-head")!.textContent).toContain("1 of 3 completed");
    expect([...host.querySelectorAll(".rk-check-section")].map((row) => row.textContent)).toEqual([
      "Before1/2",
      "After0/1",
    ]);
    const boxes = host.querySelectorAll<HTMLInputElement>("input");
    expect(boxes[0]!.disabled).toBe(false);
    act(() => boxes[1]!.click());
    expect(host.querySelector(".rk-check-head")!.textContent).toContain("2 of 3 completed");
    expect(host.querySelectorAll(".rk-check-section")[0]!.textContent).toBe("Before2/2");
    expect(onChange).toHaveBeenCalledWith([true, true, false]);
    act(() => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Reset")!
        .click();
    });
    expect(host.querySelector(".rk-check-head")!.textContent).toContain("1 of 3 completed");
    expect(onChange).toHaveBeenLastCalledWith([true, false, false]);
  });
});

describe("timeline", () => {
  it("hides a row's detail until it is opened and highlights the focused year", () => {
    render(
      <Timeline
        focus="1969"
        groups={[
          {
            label: "1969",
            items: [{ title: "Apollo 11", note: "July", detail: "First landing" }],
          },
          { label: "1972", items: [{ title: "Apollo 17", detail: "Last landing" }] },
        ]}
      />,
    );
    expect(host.textContent).not.toContain("First landing");
    const row = host.querySelector<HTMLButtonElement>(".rk-timeline-row")!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".rk-timeline-group")!.hasAttribute("data-focus")).toBe(true);
    expect(host.querySelectorAll(".rk-timeline-group")[1]!.hasAttribute("data-focus")).toBe(false);
    act(() => row.click());
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("First landing");
  });

  it("draws a flat items list as one row per date", () => {
    render(
      <Timeline
        items={[
          { date: "1969", title: "Apollo 11", detail: "First landing" },
          { date: "1972", title: "Apollo 17", detail: "Last landing" },
        ]}
      />,
    );
    expect(host.querySelectorAll(".rk-timeline-group")).toHaveLength(2);
    expect(host.textContent).toContain("1969");
    expect(host.textContent).toContain("Apollo 11");
  });
});

describe("stages and chart marker", () => {
  it("moves the stage and the diagram focus together", () => {
    render(
      <Stages
        stages={[
          { id: "evap", label: "Evaporator", title: "Evaporator", detail: "Takes heat" },
          { id: "comp", label: "Compressor", title: "Compressor", detail: "Raises pressure" },
        ]}
      >
        <Diagram
          nodes={[
            { id: "evap", label: "Evaporator" },
            { id: "comp", label: "Compressor" },
          ]}
          edges={[{ from: "evap", to: "comp" }]}
        />
      </Stages>,
    );
    const nav = [...host.querySelectorAll<HTMLButtonElement>(".rk-stage-nav button")];
    expect(nav[0]!.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector(".rk-stage-title")!.textContent).toBe("Evaporator");
    expect(host.querySelector(".rk-diagram-focus")!.parentElement!.textContent).toContain(
      "Evaporator",
    );
    act(() => nav[1]!.click());
    expect(host.querySelector(".rk-stage-title")!.textContent).toBe("Compressor");
    expect(host.querySelector(".rk-diagram-focus")!.parentElement!.textContent).toContain(
      "Compressor",
    );
    expect(host.textContent).toContain("Stage 2 of 2");
  });

  it("pins the chart guide on the chosen point and draws the reference", () => {
    const xAt = (marker: number) => {
      render(
        <LineChart
          points={[
            { label: "A", value: 2 },
            { label: "B", value: 5 },
            { label: "C", value: 3 },
          ]}
          marker={marker}
          reference={{ value: 4, label: "Target" }}
        />,
      );
      return Number(host.querySelector(".rk-crosshair")!.getAttribute("x1"));
    };
    const first = xAt(0);
    expect(host.querySelector(".rk-hover-dot")).not.toBeNull();
    expect(host.querySelector(".rk-reference-label")!.textContent).toBe("Target");
    expect(xAt(2)).toBeGreaterThan(first);
    render(<LineChart points={[{ value: 1 }, { value: 2 }]} marker={9} />);
    expect(host.querySelector(".rk-crosshair")).toBeNull();
  });
});

describe("choices, result and raw range", () => {
  it("uses separately named radio groups with visible question labels", () => {
    const onChange = vi.fn();
    render(
      <>
        <Choices
          radio
          label="Ownership"
          options={["Rent", "Buy"]}
          value="Buy"
          onChange={onChange}
        />
        <Choices radio label="Duration" options={["Short", "Long"]} />
      </>,
    );
    const [rent, buy, short, long] = host.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(buy!.checked).toBe(true);
    expect(short!.checked).toBe(false);
    expect(rent!.name).toBe(buy!.name);
    expect(short!.name).toBe(long!.name);
    expect(rent!.name).not.toBe(short!.name);
    expect(host.querySelector("legend")?.textContent).toBe("Ownership");
    act(() => rent!.click());
    expect(onChange).toHaveBeenCalledWith("Rent");
  });

  it("fills the chosen pill and stacks a result with a full-width copy", () => {
    const onChange = vi.fn();
    render(
      <>
        <Choices options={["Lease", "Buy"]} value="Buy" columns={2} onChange={onChange} />
        <Result
          label="Each person pays"
          value="£41.85"
          tone="success"
          inset={false}
          groups={[{ label: "Bill", value: "£80" }]}
          copy={{ label: "Copy amount", text: "£41.85" }}
        />
      </>,
    );
    const [lease, buy] = [...host.querySelectorAll<HTMLButtonElement>(".rk-choices button")];
    expect(buy!.dataset.variant).toBe("primary");
    expect(lease!.getAttribute("aria-pressed")).toBe("false");
    act(() => lease!.click());
    expect(onChange).toHaveBeenCalledWith("Lease");
    expect(host.querySelector(".rk-result")!.hasAttribute("data-inset")).toBe(false);
    expect(host.querySelector(".rk-result-value")!.textContent).toBe("£41.85");
    expect(host.querySelector(".rk-result-copy .rk-button")!.textContent).toBe("Copy amount");
  });

  it("styles a hand-rolled range like the slider", () => {
    expect(PAGE_STYLES).toContain('input[type="range"]');
    expect(PAGE_STYLES).toContain("::-webkit-slider-thumb");
    expect(PAGE_STYLES).toContain("accent-color:transparent");
    expect(PAGE_STYLES).toContain("::-moz-range-progress{background:transparent}");
  });
});
