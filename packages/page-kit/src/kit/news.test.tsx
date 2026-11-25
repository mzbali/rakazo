// @vitest-environment jsdom
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NEWS_CSS, NewsRows, Upcoming } from "./news.js";

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

describe("NewsRows", () => {
  it("draws a photo, label, headline, summary and a source chip for each story", () => {
    render(
      <NewsRows
        items={[
          {
            label: "Freedonia",
            title: "Talks resume",
            summary: "Unions return to the table.",
            image: PNG,
            alt: "Crowd in a square",
            sources: [
              { name: "Wire One", href: "https://wire.example/story" },
              { name: "Daily Two" },
            ],
          },
          { title: "Second story", sources: ["Wire One"] },
        ]}
      />,
    );
    const rows = all(".rk-news-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector(".rk-news-photo img")?.getAttribute("alt")).toBe(
      "Crowd in a square",
    );
    expect(rows[0]!.querySelector(".rk-news-label")?.textContent).toBe("Freedonia");
    expect(rows[0]!.querySelector(".rk-news-title")?.textContent).toBe("Talks resume");
    const chip = rows[0]!.querySelector<HTMLAnchorElement>("a.rk-source-chip");
    expect(chip?.textContent).toBe("WWire One+1");
    expect(chip?.href).toBe("https://wire.example/story");
    // A story without a photo or link still reads: no photo box, a chip that is not a link.
    expect(rows[1]!.querySelector(".rk-news-photo")).toBeNull();
    expect(rows[1]!.querySelector("span.rk-source-chip")?.textContent).toContain("Wire One");
  });

  it("names a source by its site and ignores a link that is not web", () => {
    render(
      <NewsRows
        items={[
          { title: "A", sources: [{ href: "https://www.news.example/a" }] },
          { title: "B", sources: [{ name: "Bad", href: "javascript:alert(1)" }] },
        ]}
      />,
    );
    expect(all(".rk-source-chip")[0]!.textContent).toContain("news.example");
    expect(all("a.rk-source-chip")).toHaveLength(1);
    expect(all(".rk-source-chip")[1]!.tagName).toBe("SPAN");
  });

  it("draws nothing without a headline, and no frame of its own", () => {
    render(<NewsRows items={[{ summary: "no title" }, null as never]} />);
    expect(all(".rk-news")).toHaveLength(0);
    expect(NEWS_CSS).not.toMatch(/\.rk-news\{[^}]*(border|background|box-shadow)/);
  });
});

describe("Upcoming", () => {
  it("shows the day and month large with the weekday under it", () => {
    render(
      <Upcoming
        items={[
          {
            date: "2026-12-04",
            title: "Rally planned",
            detail: "Organisers expect large crowds.",
            sources: [{ name: "Wire One" }],
          },
          { date: "not a date", title: "Skipped" },
        ]}
      />,
    );
    const tiles = all(".rk-date-tile");
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.querySelector(".rk-date-day")?.textContent).toBe("Dec 4");
    expect(tiles[0]!.querySelector(".rk-date-weekday")?.textContent).toBe("Friday");
    expect(tiles[0]!.getAttribute("datetime")).toBe("2026-12-04");
    expect(all(".rk-news-title")[0]!.textContent).toBe("Rally planned");
  });
});
