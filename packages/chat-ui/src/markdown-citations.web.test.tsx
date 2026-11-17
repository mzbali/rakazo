// @vitest-environment jsdom

import type { SourceItem } from "@rakazo/core/answer-sources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "./markdown.web";

const NASA = "https://science.nasa.gov/mars/facts/";
const ESA = "https://www.esa.int/Science_Exploration/Space_Science/Mars_Express";
const sources: SourceItem[] = [
  { url: NASA, title: "Mars Facts", site: "nasa" },
  { url: ESA, title: "Mars Express", site: "esa" },
];
const answer = `A day lasts 24 hours [NASA](${NASA}). A year is 687 days [nasa.gov](${NASA}) [ESA](${ESA}). See [notes](https://notes.example.test/mars).`;

function labels(container: ParentNode, selector: string) {
  return [...container.querySelectorAll(selector)].map((node) => node.textContent);
}

describe("web citation pills", () => {
  it("draws one pill, a +1 pill and the sources row, and leaves another link underlined", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ChatMarkdown sources={sources} sourcesRow>
          {answer}
        </ChatMarkdown>,
      );
    });
    expect(labels(container, "button.rk-chat-cite")).toEqual(["nasa", "nasa +1"]);
    expect(container.querySelector("button.rk-chat-sources")?.textContent).toBe("2 sources");
    const plain = container.querySelector("a.rk-chat-link");
    expect(plain?.getAttribute("href")).toBe("https://notes.example.test/mars");
    expect(plain?.textContent).toBe("notes");

    await act(async () => {
      container
        .querySelectorAll("button.rk-chat-cite")[1]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Mars Facts");
    expect(document.body.textContent).toContain("Mars Express");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps links as written while streaming and hides the row when there is one source", () => {
    const streaming = renderToStaticMarkup(
      <ChatMarkdown sources={sources} sourcesRow streaming>
        {answer}
      </ChatMarkdown>,
    );
    expect(streaming).not.toContain("rk-chat-cite");
    expect(streaming).not.toContain("2 sources");
    expect(streaming).toContain("science.nasa.gov");

    const one = renderToStaticMarkup(
      <ChatMarkdown sources={[sources[0]!]} sourcesRow>
        {`A day lasts 24 hours [NASA](${NASA}).`}
      </ChatMarkdown>,
    );
    expect(one).toContain("rk-chat-cite");
    expect(one).not.toContain("rk-chat-sources");
    expect(one).not.toContain("1 source");
  });
});
