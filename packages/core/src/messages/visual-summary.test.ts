import { describe, expect, it } from "vitest";
import { foldVisualFences, visualFenceSummary } from "./visual-summary.js";

const fence = (body: string, close = true) => `\`\`\`ui\n${body}${close ? "\n```" : ""}`;
const BODY = `<Visual summary="NCE: real vs noise">\n<Callout lead="x">a</Callout>\n</Visual>`;

describe("visualFenceSummary", () => {
  it("reads the summary of the opening tag", () => {
    expect(visualFenceSummary(BODY)).toBe("NCE: real vs noise");
    expect(visualFenceSummary(`<Visual summary="a &lt; b &amp; &quot;c&quot;">`)).toBe(
      'a < b & "c"',
    );
    expect(visualFenceSummary(`<Visual flag summary="x > y" n={3}>`)).toBe("x > y");
    expect(visualFenceSummary(`  \n<Visual summary="x"/>`)).toBe("x");
  });

  it("has none while the tag is unfinished or when it is unusable", () => {
    expect(visualFenceSummary(`<Visual summary="NCE`)).toBeUndefined();
    expect(visualFenceSummary(`<Visual summary="NCE"`)).toBeUndefined();
    expect(visualFenceSummary(`<Visual>`)).toBeUndefined();
    expect(visualFenceSummary(`<Visual summary="  ">`)).toBeUndefined();
    expect(visualFenceSummary(`<Visual summary="${"x".repeat(501)}">`)).toBeUndefined();
    expect(visualFenceSummary(`<Visualize summary="x">`)).toBeUndefined();
    expect(visualFenceSummary(`<Callout summary="x">`)).toBeUndefined();
    expect(visualFenceSummary(`<Visual summary={"x"}>`)).toBeUndefined();
    expect(visualFenceSummary("")).toBeUndefined();
  });
});

describe("foldVisualFences", () => {
  it("replaces a ui fence with its summary and keeps the prose around it", () => {
    expect(foldVisualFences(`Intro\n\n${fence(BODY)}\n\nOutro`)).toBe(
      "Intro\n\n[visual: NCE: real vs noise]\n\nOutro",
    );
  });

  it("folds an unclosed or summary-less fence to [visual]", () => {
    expect(foldVisualFences(fence(`<Visual summary="NCE`, false))).toBe("[visual]");
    expect(foldVisualFences(`Hi\n${fence(`<Visual>\n</Visual>`)}`)).toBe("Hi\n[visual]");
    expect(foldVisualFences(fence(BODY, false))).toBe("[visual: NCE: real vs noise]");
  });

  it("leaves other fences and a ui fence quoted inside them alone", () => {
    const code = "```ts\nconst a = 1;\n```";
    expect(foldVisualFences(code)).toBe(code);
    const quoted = `\`\`\`\`md\n${fence(BODY)}\n\`\`\`\``;
    expect(foldVisualFences(quoted)).toBe(quoted);
    expect(foldVisualFences("```uix\nbody\n```")).toBe("```uix\nbody\n```");
  });

  it("folds several fences and tilde fences", () => {
    const two = `${fence(BODY)}\nbetween\n~~~ui\n<Visual summary="B">\n~~~`;
    expect(foldVisualFences(two)).toBe("[visual: NCE: real vs noise]\nbetween\n[visual: B]");
  });

  it("reads tabs around ui and CRLF line ends", () => {
    expect(foldVisualFences(`\`\`\`\tui\t\n<Visual summary="T">\n\`\`\`\nafter`)).toBe(
      "[visual: T]\nafter",
    );
    expect(foldVisualFences('```ui\r\n<Visual summary="C">\r\n```\r\nOutro')).toBe(
      "[visual: C]\nOutro",
    );
  });

  it("returns text without a ui fence untouched", () => {
    expect(foldVisualFences("plain `ui` text")).toBe("plain `ui` text");
  });
});
