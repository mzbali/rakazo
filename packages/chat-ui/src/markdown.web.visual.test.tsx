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
});
