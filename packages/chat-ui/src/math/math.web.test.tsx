// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "../markdown.web";

async function draw(markdown: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ChatMarkdown>{markdown}</ChatMarkdown>);
  });
  await vi.waitFor(() => expect(container.querySelector(".rk-math-pending")).toBeNull());
  return {
    container,
    done: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("web markdown maths", () => {
  it("draws formulas with KaTeX and leaves prices as text", async () => {
    const { container, done } = await draw(
      "Energy \\(E=mc^2\\) costs $5 to $10.\n\n$$\\frac{a}{b}$$",
    );
    expect(container.querySelectorAll(".katex").length).toBe(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.textContent).toContain("costs $5 to $10.");
    await done();
  });

  it("shows TeX that KaTeX rejects as code", async () => {
    const { container, done } = await draw("Broken \\(\\frac{\\) here");
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("code.rk-math-source")?.textContent).toBe("\\frac{");
    await done();
  });

  it("keeps maths in code as code and an unclosed delimiter as text", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<ChatMarkdown>{"`\\(x\\)` and $$ still open\n\nmore"}</ChatMarkdown>);
    });
    expect(container.querySelector(".rk-math")).toBeNull();
    expect(container.textContent).toContain("$$ still open");
    await act(async () => root.unmount());
  });
});

describe("web markdown maths changes", () => {
  it("draws a formula once its TeX becomes valid", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ChatMarkdown>{"Edit \\(\\frac{a}{\\) now"}</ChatMarkdown>);
    });
    await vi.waitFor(() => expect(container.querySelector("code.rk-math-source")).not.toBeNull());
    await act(async () => {
      root.render(<ChatMarkdown>{"Edit \\(\\frac{a}{b}\\) now"}</ChatMarkdown>);
    });
    await vi.waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
    expect(container.querySelector("code.rk-math-source")).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not keep a macro one formula defines for the next", async () => {
    const { container, done } = await draw("\\(\\gdef\\x{y}\\x\\) and \\(\\x\\)");
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(container.querySelector("code.rk-math-source")?.textContent).toBe("\\x");
    await done();
  });
});
