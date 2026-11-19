// @vitest-environment jsdom

import { flush } from "@rakazo/core/test-async";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "./markdown.web";

let container: HTMLDivElement;
let root: Root;

const FENCE = `<Visual summary="Real versus noise">
<Callout tone="info" lead="Why">The classifier tells data from noise.</Callout>
<Formula tex="p(x)" />
</Visual>`;
const ui = (body: string, close = true) => `Intro\n\n\`\`\`ui\n${body}${close ? "\n```" : ""}\n`;

async function render(markdown: string, props: { streaming?: boolean; visuals?: boolean }) {
  await act(async () => {
    root.render(<ChatMarkdown {...props}>{markdown}</ChatMarkdown>);
  });
  // The kit loads on demand; the fence's own code block, or a visual, is there once it has.
  if (props.visuals)
    await vi.waitFor(() => expect(host() ?? container.querySelector("pre")).not.toBeNull(), {
      timeout: 5000,
    });
  await act(async () => {
    await flush();
  });
}

const host = () => container.querySelector<HTMLElement>('[data-testid="chat-visual"]');
const shadowText = () => host()?.shadowRoot?.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("a ```ui fence", () => {
  it("draws in an open shadow root when the text is a Space bot's", async () => {
    await render(ui(FENCE), { visuals: true });
    expect(host()?.shadowRoot?.mode).toBe("open");
    expect(host()?.getAttribute("aria-label")).toBe("Real versus noise");
    expect(shadowText()).toContain("The classifier tells data from noise.");
    expect(shadowText()).toContain("p(x)");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("draws a Formula with KaTeX inside the shadow root, with its rules beside it", async () => {
    await render(ui(FENCE), { visuals: true });
    await vi.waitFor(() => expect(host()?.shadowRoot?.querySelector(".katex")).not.toBeNull());
    expect(host()?.shadowRoot?.querySelector(".rkv-formula-source")).toBeNull();
  });

  it("draws a Formula once its TeX becomes valid", async () => {
    const fence = (tex: string) => ui(`<Visual summary="S">\n<Formula tex="${tex}" />\n</Visual>`);
    await render(fence("\\frac{a}{"), { visuals: true });
    await vi.waitFor(() =>
      expect(host()?.shadowRoot?.querySelector(".rkv-formula-source")?.textContent).toBe(
        "\\frac{a}{",
      ),
    );
    await render(fence("\\frac{a}{b}"), { visuals: true });
    await vi.waitFor(() => expect(host()?.shadowRoot?.querySelector(".katex")).not.toBeNull());
    expect(host()?.shadowRoot?.querySelector(".rkv-formula-source")).toBeNull();
  });

  it("stays a code block for anyone else's text", async () => {
    await render(ui(FENCE), {});
    expect(host()).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("<Visual");
  });

  it("stays a code block when it is not a visual", async () => {
    await render(ui('<Callout lead="x" />'), { visuals: true });
    expect(host()).toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("fills in while the reply streams: complete children draw, the unfinished tail is a placeholder", async () => {
    const cut = FENCE.indexOf("<Formula") + 8;
    await render(ui(FENCE.slice(0, cut), false), { visuals: true, streaming: true });
    expect(shadowText()).toContain("The classifier tells data from noise.");
    expect(shadowText()).not.toContain("p(x)");
    expect(host()?.shadowRoot?.querySelector(".rkv-pending")).not.toBeNull();
  });

  it("shows a line for a closed element it cannot draw, and keeps the rest", async () => {
    await render(
      ui(`<Visual summary="S">\n<Callout tone="loud" lead="x" />\n<Formula tex="ok" />\n</Visual>`),
      { visuals: true },
    );
    expect(shadowText()).toContain("Couldn't draw this visual");
    expect(shadowText()).toContain("ok");
  });

  it("draws a bigger fence as a code block once the reply has finished", async () => {
    const big = `<Visual summary="S">${'<Callout lead="x">filler</Callout>'.repeat(1100)}</Visual>`;
    await render(ui(big), { visuals: true });
    expect(host()).toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("holds a middle click on a link so no address skips the prompt", async () => {
    await render(
      ui(`<Visual summary="S">\n<Callout lead="See">https://example.test/a</Callout>\n</Visual>`),
      { visuals: true },
    );
    const link = host()?.shadowRoot?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/a");
    const event = new MouseEvent("auxclick", {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 1,
    });
    await act(async () => {
      link?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain("https://example.test/a");
  });

  describe("the rest of the catalog", () => {
    const shadow = () => host()?.shadowRoot;

    it("draws bars, a line chart, a pie, a table, pros and cons and a status", async () => {
      await render(
        ui(`<Visual summary="S">
<Bars bars={[{label: "Alpha", value: 3}, {label: "Beta", value: 1}]} />
<LineChart points={[{label: "Mon", value: 2}, {label: "Tue", value: 4}]} />
<Pie parts={[{label: "Used", value: 3}, {label: "Free", value: 1}]} total="4 GB" />
<Table columns={["Plan", "Price"]} rows={[["Free", 0], ["Pro", {text: "$9", tone: "success"}]]} />
<ProsCons pros={["Fast"]} cons={["Small"]} />
<Status tone="success">Shipped</Status>
</Visual>`),
        { visuals: true },
      );
      expect(shadow()?.querySelectorAll(".rk-bar")).toHaveLength(2);
      expect(shadow()?.querySelector("svg.rk-focus-ring")).not.toBeNull();
      expect(shadow()?.querySelector(".rk-pie-total")?.textContent).toBe("4 GB");
      expect(shadow()?.querySelectorAll(".rk-table tbody tr")).toHaveLength(2);
      expect(shadowText()).toContain("Fast");
      expect(shadowText()).toContain("Small");
      expect(shadow()?.querySelector(".rk-status")?.textContent).toBe("Shipped");
      expect(shadow()?.querySelector(".rkv-note")).toBeNull();
    });

    it("draws a diagram node's icon", async () => {
      await render(
        ui(
          `<Visual summary="S"><Diagram nodes={[{id: "a", label: "Store", icon: "database"}]} /></Visual>`,
        ),
        { visuals: true },
      );
      expect(shadow()?.querySelector(".rk-diagram-icon")).not.toBeNull();
    });

    it("switches between tabs with its own state, and keeps the others unmounted", async () => {
      await render(
        ui(`<Visual summary="S"><Tabs>
<Tab label="One"><Callout lead="First view">a</Callout></Tab>
<Tab label="Two"><Callout lead="Second view">b</Callout></Tab>
</Tabs></Visual>`),
        { visuals: true },
      );
      expect(shadowText()).toContain("First view");
      expect(shadowText()).not.toContain("Second view");
      const second = [...(shadow()?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Two",
      );
      await act(async () => second?.click());
      expect(shadowText()).toContain("Second view");
      expect(shadowText()).not.toContain("First view");
    });

    it("shows a copy button's text and copies it through the app clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await render(
        ui(`<Visual summary="S"><CopyButton label="Copy command" text="pnpm install" /></Visual>`),
        { visuals: true },
      );
      expect(shadow()?.querySelector(".rkv-copy-text")?.textContent).toBe("pnpm install");
      const button = shadow()?.querySelector<HTMLButtonElement>("button.rk-button");
      expect(button?.textContent).toBe("Copy command");
      await act(async () => button?.click());
      await act(async () => {
        await flush();
      });
      expect(writeText).toHaveBeenCalledWith("pnpm install");
    });

    it("draws the tabs that are done while the reply streams, with the placeholder after", async () => {
      const source = `<Visual summary="S"><Tabs><Tab label="One"><Callout lead="First view">a</Callout></Tab><Tab label="Two"><Callout lead="Sec`;
      await render(ui(source, false), { visuals: true, streaming: true });
      expect(shadowText()).toContain("First view");
      expect(shadowText()).toContain("Two");
      expect(shadow()?.querySelector(".rkv-pending")).not.toBeNull();
    });

    it("shows the line for an invalid tag and keeps the others", async () => {
      await render(ui(`<Visual summary="S"><Pie parts={[]} /><Status>Ok</Status></Visual>`), {
        visuals: true,
      });
      expect(shadowText()).toContain("Couldn't draw this visual");
      expect(shadow()?.querySelector(".rk-status")?.textContent).toBe("Ok");
    });
  });
});
