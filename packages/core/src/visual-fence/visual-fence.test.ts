import { VISUAL_CODE_MAX_BYTES } from "@rakazo/contracts";
import { expectLinearTime } from "@rakazo/contracts/test-timing";
import { describe, expect, it } from "vitest";
import type { VisualElement } from "./visual-fence.js";
import { parseVisualFence } from "./visual-fence.js";
import { parseVisualLiteral } from "./visual-literal.js";

const NCE = `<Visual summary="NCE turns density estimation into real-vs-noise classification.">
  <Formula tex="p(x) = \\frac{\\phi(x;\\theta)}{Z(\\theta)}" />
  <Diagram nodes={[{id: "real", label: "Real samples", detail: "Observed data"}, {id: "noise", label: "Noise samples"}, {id: "clf", label: "Binary classifier"}, {id: "out", label: "Learn θ and estimate Z"}]} edges={[{from: "real", to: "clf"}, {from: "noise", to: "clf"}, {from: "clf", to: "out"}]} />
  <Callout tone="info" lead="Why it works">
    The classifier only has to tell data from noise, so Z(θ) becomes a parameter.
  </Callout>
</Visual>`;

const children = (element: VisualElement | undefined) => element?.children ?? [];
const tags = (element: VisualElement | undefined) => children(element).map((child) => child.tag);

describe("parseVisualFence", () => {
  it("reads a finished fence into complete elements", () => {
    const { root, tail } = parseVisualFence(NCE);
    expect(root?.state).toBe("complete");
    expect(root?.props.summary).toBe(
      "NCE turns density estimation into real-vs-noise classification.",
    );
    expect(tags(root)).toEqual(["Formula", "Diagram", "Callout"]);
    expect(children(root).every((child) => child.state === "complete")).toBe(true);
    expect(children(root)[0]?.props.tex).toBe("p(x) = \\frac{\\phi(x;\\theta)}{Z(\\theta)}");
    expect(children(root)[2]?.text).toBe(
      "The classifier only has to tell data from noise, so Z(θ) becomes a parameter.",
    );
    expect(tail).toBe(false);
  });

  it("keeps every child's key as more of the reply arrives", () => {
    const keys = new Map<string, string>();
    let drawn = 0;
    for (let cut = 1; cut <= NCE.length; cut++) {
      const { root } = parseVisualFence(NCE.slice(0, cut));
      if (!root) continue;
      const done = children(root).filter((child) => child.state === "complete");
      // Whole elements only: what has drawn never goes away or changes its key.
      expect(done.length).toBeGreaterThanOrEqual(drawn);
      drawn = done.length;
      for (const child of children(root)) {
        const seen = keys.get(child.key);
        if (seen) expect(child.tag).toBe(seen);
        keys.set(child.key, child.tag);
      }
      expect(root.key).toBe("0");
    }
    expect([...keys.keys()]).toEqual(["0.0", "0.1", "0.2"]);
  });

  it("never throws at any cut, and a cut inside a tag is the tail", () => {
    for (let cut = 0; cut <= NCE.length; cut++) parseVisualFence(NCE.slice(0, cut));
    const midDiagram = NCE.indexOf("edges=") + 12;
    const { root, tail } = parseVisualFence(NCE.slice(0, midDiagram));
    expect(tags(root)).toEqual(["Formula"]);
    expect(tail).toBe(true);
  });

  it("lets complete children draw while their parent is still open", () => {
    const { root, tail } = parseVisualFence(
      `<Visual summary="S">\n<Callout lead="A">one</Callout>\n<Callout lead="B">tw`,
    );
    expect(root?.state).toBe("open");
    expect(children(root).map((child) => child.state)).toEqual(["complete", "open"]);
    expect(tail).toBe(true);
  });

  it("has no tail between complete siblings", () => {
    const { tail } = parseVisualFence(`<Visual summary="S">\n<Callout lead="A">one</Callout>\n`);
    expect(tail).toBe(false);
  });

  it("treats > inside a string as text, not the end of the tag", () => {
    const { root } = parseVisualFence(
      `<Visual summary="a > b"><Steps steps={[{title: "x -> y", detail: 'p > q'}]} /></Visual>`,
    );
    expect(root?.props.summary).toBe("a > b");
    expect(children(root)[0]?.state).toBe("complete");
    expect(children(root)[0]?.props.steps).toEqual([{ title: "x -> y", detail: "p > q" }]);
  });

  it("holds an unclosed { as an unfinished tag", () => {
    const { root, tail } = parseVisualFence(`<Visual summary="S"><Steps steps={[{title: "a"`);
    expect(children(root)).toHaveLength(0);
    expect(tail).toBe(true);
  });

  it("reads JSON5 literals: bare keys, single quotes, trailing commas", () => {
    expect(parseVisualLiteral(`[{id: 'a', n: -1.5e2,},]`)?.value).toEqual([{ id: "a", n: -150 }]);
    expect(parseVisualLiteral(`{"a": [true, false, null],}`)?.value).toEqual({
      a: [true, false, null],
    });
    expect(parseVisualLiteral(`"tab\\there \\u00e9"`)?.value).toBe("tab\there é");
  });

  it("rejects anything that is not a literal", () => {
    for (const bad of [
      "foo",
      "() => 1",
      "[...rest]",
      "1 + 2",
      "{a: b}",
      "fn()",
      "`tpl`",
      "{__proto__: 1}",
      "[1,, 2]",
      "[1] x",
    ])
      expect(parseVisualLiteral(bad)).toBeUndefined();
    expect(parseVisualLiteral("[".repeat(40) + "]".repeat(40))).toBeUndefined();
  });

  it("reads self-closing tags and the same tag with a closer", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Formula tex="x" /><Formula tex="y"></Formula></Visual>`,
    );
    expect(children(root).map((child) => [child.state, child.props.tex])).toEqual([
      ["complete", "x"],
      ["complete", "y"],
    ]);
  });

  it("marks a closed element with a bad prop invalid and keeps its siblings", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Callout tone={go()} lead="x" /><Formula tex="y" /><Quote>q</Quote><Callout onClick={f} lead="z" /><Steps steps="no" /></Visual>`,
    );
    expect(children(root).map((child) => child.state)).toEqual([
      "invalid",
      "complete",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(children(root)[2]?.reason).toContain("not a known tag");
  });

  it("rejects spreads, repeated props and element-valued props", () => {
    const bad = [
      `<Callout {...x} lead="a" />`,
      `<Callout lead="a" lead="b" />`,
      `<Callout lead=<b>x</b> />`,
      `<Callout tone="loud" lead="a" />`,
    ];
    for (const tag of bad) {
      const { root } = parseVisualFence(`<Visual summary="S">${tag}</Visual>`);
      expect(children(root)[0]?.state).toBe("invalid");
    }
  });

  it("keeps a < that does not start a tag as text", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Callout lead="L">a < b and 2<3 &amp; x &lt;y&gt;</Callout></Visual>`,
    );
    expect(children(root)[0]?.text).toBe("a < b and 2<3 & x <y>");
  });

  it("collapses text whitespace like JSX and decodes only four entities", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Callout>\n   one\n\n   two   three\n  &amp;lt; &nbsp;\n</Callout></Visual>`,
    );
    expect(children(root)[0]?.text).toBe("one two three &lt; &nbsp;");
  });

  it("is not a visual unless it opens with <Visual>", () => {
    expect(parseVisualFence(`hello <Visual summary="S" />`).root).toBeUndefined();
    expect(parseVisualFence(`<Callout lead="a" />`).root).toBeUndefined();
    expect(parseVisualFence("").root).toBeUndefined();
  });

  it("requires a summary of at most 500 characters", () => {
    expect(parseVisualFence(`<Visual>`).root?.state).toBe("invalid");
    expect(parseVisualFence(`<Visual summary="${"x".repeat(501)}">`).root?.state).toBe("invalid");
    expect(parseVisualFence(`<Visual summary="${"x".repeat(500)}">`).root?.state).toBe("open");
  });

  it("flags tags that do not belong where they are", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Visual summary="T"></Visual><Grid><Grid></Grid><Formula tex="a"/></Grid><Callout lead="x"><Formula tex="a"/></Callout></Visual>`,
    );
    const [inner, grid, callout] = children(root);
    expect(inner?.state).toBe("invalid");
    expect(grid?.state).toBe("complete");
    expect(children(grid).map((child) => child.state)).toEqual(["invalid", "complete"]);
    expect(children(callout)[0]?.state).toBe("invalid");
  });

  it("checks diagrams reference real nodes", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Diagram nodes={[{id:"a",label:"A"}]} edges={[{from:"a",to:"z"}]} /></Visual>`,
    );
    expect(children(root)[0]?.state).toBe("invalid");
  });

  it("ignores everything after the root closes", () => {
    const { root, tail } = parseVisualFence(`<Visual summary="S"></Visual>\n<Callout lead="x" />`);
    expect(root?.state).toBe("complete");
    expect(children(root)).toHaveLength(0);
    expect(tail).toBe(false);
  });

  it("marks elements a closer skips over as not closed", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Grid><Callout lead="a">x</Grid></Visual>`,
    );
    const grid = children(root)[0];
    expect(grid?.state).toBe("complete");
    expect(children(grid)[0]?.state).toBe("invalid");
  });

  it("reads only the first 32 KB of a bigger fence and says so", () => {
    const body = `<Visual summary="S"><Callout lead="a">${"x".repeat(VISUAL_CODE_MAX_BYTES)}</Callout></Visual>`;
    const result = parseVisualFence(body);
    expect(result.truncated).toBe(true);
    expect(result.root?.state).toBe("open");
    expect(parseVisualFence(NCE).truncated).toBe(false);
  });

  it("counts multi-byte text against the byte limit", () => {
    const big = `<Visual summary="S"><Callout lead="a">${"θ".repeat(VISUAL_CODE_MAX_BYTES / 2)}</Callout></Visual>`;
    expect(parseVisualFence(big).truncated).toBe(true);
  });

  it("counts an emoji as four bytes, not five", () => {
    const body = `<Visual summary="S"><Callout lead="a">${"😀".repeat(7000)}</Callout></Visual>`;
    expect(parseVisualFence(body).truncated).toBe(false);
  });

  it("counts a lone high surrogate as three bytes without skipping the next character", () => {
    const body = `<Visual summary="S"><Callout lead="a">${"\ud800界".repeat(6000)}</Callout></Visual>`;
    expect(parseVisualFence(body).truncated).toBe(true);
  });

  it("rejects a diagram edge from a node to itself", () => {
    const { root } = parseVisualFence(
      `<Visual summary="S"><Diagram nodes={[{id:"a",label:"A"}]} edges={[{from:"a",to:"a"}]} /></Visual>`,
    );
    expect(children(root)[0]?.state).toBe("invalid");
  });

  it("returns the same result for the same body", () => {
    expect(parseVisualFence(NCE)).toBe(parseVisualFence(NCE));
  });

  it("reads a hostile 32 KB fence in linear time", () => {
    const hostile = [
      `<Visual summary="S">`,
      "<".repeat(8000),
      `<Callout lead="a > b > c">`.repeat(300),
      `{`.repeat(8000),
      `"<Steps steps={[{title: ">`.repeat(100),
      "</".repeat(4000),
    ].join("");
    expectLinearTime(() => parseVisualFence(hostile));
    expectLinearTime(() =>
      parseVisualFence(`<Visual summary="S"><Steps steps={${"[".repeat(30000)}`),
    );
    expectLinearTime(() => parseVisualFence(`<Visual summary="S">${"<A x={'".repeat(4000)}`));
    expectLinearTime(() =>
      parseVisualFence(`<Visual summary="S">${`<Callout lead="x">a</Callout>`.repeat(1000)}`),
    );
  });
});
