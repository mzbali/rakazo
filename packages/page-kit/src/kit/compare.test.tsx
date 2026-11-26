// @vitest-environment jsdom
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMPARE_CSS, Compare } from "./compare.js";
import { HostBridgeContext } from "./host-bridge.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG = "data:image/png;base64,iVBORw0KGgo=";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => host.remove());

function render(element: ReactElement) {
  const root = createRoot(host.appendChild(document.createElement("div")));
  act(() => root.render(element));
}
const all = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];

describe("Compare", () => {
  it("keeps each value under its own product when an untitled item is left out", () => {
    render(
      <Compare
        items={[{ title: "" }, { title: "Phone B" }, {}, { title: "Phone D" }]}
        rows={[{ label: "Battery", values: ["1 h", "2 h", "3 h", "4 h"], best: 3 }]}
      />,
    );
    expect(all("thead th").map((head) => head.textContent)).toEqual(["Phone B", "Phone D"]);
    const cells = all("tbody td");
    expect(cells.map((cell) => cell.firstChild?.textContent)).toEqual(["2 h", "4 h"]);
    expect(cells.map((cell) => cell.hasAttribute("data-best"))).toEqual([false, true]);
  });

  it("heads each column with its photo and name, then lists each spec under its label", () => {
    render(
      <Compare
        items={[
          { title: "Phone A", image: PNG, alt: "Phone A front", note: "£799" },
          { title: "Phone B" },
        ]}
        rows={[
          { label: "Battery", values: ["24 h", "22 h"], best: 0 },
          { label: "Weight", values: ["198 g"], best: [1] },
        ]}
      />,
    );
    const heads = all("thead th");
    expect(heads.map((head) => head.querySelector(".rk-compare-name")?.textContent)).toEqual([
      "Phone A",
      "Phone B",
    ]);
    expect(heads[0]!.querySelector(".rk-compare-photo img")?.getAttribute("alt")).toBe(
      "Phone A front",
    );
    expect(heads[0]!.querySelector(".rk-compare-note")?.textContent).toBe("£799");
    // A column without a photo draws no photo box.
    expect(heads[1]!.querySelector(".rk-compare-photo")).toBeNull();
    expect(all(".rk-compare-label").map((label) => label.textContent)).toEqual([
      "Battery",
      "Weight",
    ]);
    const cells = all("tbody td");
    expect(cells.map((cell) => cell.textContent)).toEqual(["24 h, Best", "22 h", "198 g", "–"]);
    // The best value is marked; a best index with no value is not.
    expect(cells.map((cell) => cell.dataset.best)).toEqual([
      "true",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("shows at most four items and nothing without a named item", () => {
    render(
      <Compare
        items={Array.from({ length: 6 }, (_, index) => ({ title: `Item ${index}` }))}
        rows={[{ label: "Price", values: ["1", "2", "3", "4", "5", "6"] }]}
      />,
    );
    expect(all("thead th")).toHaveLength(4);
    expect(all("tbody td")).toHaveLength(4);
    host.replaceChildren();
    render(<Compare items={[{ image: PNG }]} rows={[]} />);
    expect(host.querySelector(".rk-compare")).toBeNull();
  });

  it("draws a photo the host resolves by id", async () => {
    const bridge = {
      openLink: () => {},
      copy: () => Promise.resolve(false),
      image: (id: string) => Promise.resolve(id === "art-1" ? PNG : null),
    };
    const root = createRoot(host.appendChild(document.createElement("div")));
    await act(async () => {
      root.render(
        <HostBridgeContext.Provider value={bridge}>
          <Compare
            items={[
              { title: "A", image: "rakazo-image:art-1" },
              { title: "B", image: "https://example.com/b.png" },
            ]}
          />
        </HostBridgeContext.Provider>,
      );
    });
    // Only an embedded or host-resolved picture draws; a network address never does.
    expect(all(".rk-compare-photo img")).toHaveLength(1);
  });

  it("keeps four columns inside a phone with a label over its values", () => {
    expect(COMPARE_CSS).toContain("table-layout:fixed");
    expect(COMPARE_CSS).toContain("th.rk-compare-label{");
    expect(COMPARE_CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
