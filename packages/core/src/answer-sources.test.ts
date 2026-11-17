import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import type { RecordedSource } from "./answer-sources.js";
import {
  CITED_SOURCES_MAX,
  citationGroupIndex,
  citationMarkdown,
  citationSiteLabel,
  citedSourceItems,
  messageSources,
  preparedCitationMarkdown,
  recordRunSource,
  showSourcesRow,
  withCitedSourceBlock,
} from "./answer-sources.js";

const NASA = "https://science.nasa.gov/mars/facts/";
const ESA = "https://www.esa.int/Science_Exploration/Space_Science/Mars_Express";
const BBC = "https://www.bbc.co.uk/news/science";
const WIKI = "https://en.wikipedia.org/wiki/Mars";

function recorded(entries: [string, string][]): Map<string, RecordedSource> {
  const sources = new Map<string, RecordedSource>();
  for (const [url, title] of entries) recordRunSource(sources, url, title);
  return sources;
}

const mars = () =>
  recorded([
    [NASA, "Mars Facts"],
    [ESA, "Mars Express"],
    [BBC, ""],
    [WIKI, "Mars"],
  ]);

describe("recordRunSource", () => {
  it("keeps the normalized url and the first non-empty title", () => {
    const sources = new Map<string, RecordedSource>();
    recordRunSource(sources, NASA, "Mars Facts");
    recordRunSource(sources, NASA, "A later title");
    recordRunSource(sources, "https://www.esa.int/mars", "");
    recordRunSource(sources, "https://www.esa.int/mars", "ESA Mars");
    expect(sources.get(NASA)).toEqual({ url: NASA, title: "Mars Facts" });
    expect(sources.get("https://www.esa.int/mars")).toEqual({
      url: "https://www.esa.int/mars",
      title: "ESA Mars",
    });
  });

  it("skips a non-http url and a url that is too long to store", () => {
    const sources = new Map<string, RecordedSource>();
    recordRunSource(sources, "notaurl", "Nope");
    recordRunSource(sources, `https://example.test/${"a".repeat(2048)}`, "Long");
    expect(sources.size).toBe(0);
  });
});

describe("citationSiteLabel", () => {
  it("uses the registrable domain's first label", () => {
    expect(citationSiteLabel(NASA)).toBe("nasa");
    expect(citationSiteLabel(ESA)).toBe("esa");
    expect(citationSiteLabel(BBC)).toBe("bbc");
    expect(citationSiteLabel(WIKI)).toBe("wikipedia");
    expect(citationSiteLabel("not a url")).toBe("");
  });
});

describe("withCitedSourceBlock", () => {
  const text = (value: string): MessageBlock => ({ kind: "text", text: value });

  it("attaches cited pages in first-link order and skips everything else", () => {
    const blocks = withCitedSourceBlock(
      [
        text(
          [
            "A day on Mars is 24 hours [NASA](https://science.nasa.gov/mars/facts/).",
            "See [the notes](https://example.test/notes) too.",
            `A year is 687 days [ESA](${ESA}).`,
            "```",
            `[NASA](${NASA})`,
            "```",
            `![photo](${WIKI})`,
            `[![photo](https://images.example.test/mars.png)](${WIKI})`,
          ].join("\n"),
        ),
      ],
      mars(),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      kind: "sources",
      items: [
        { url: NASA, title: "Mars Facts", site: "nasa" },
        { url: ESA, title: "Mars Express", site: "esa" },
      ],
    });
  });

  it("adds no block when nothing was cited, nothing was recorded, or one is already attached", () => {
    const blocks = [text("No links here, and [notes](https://example.test/notes).")];
    expect(withCitedSourceBlock(blocks, mars())).toBe(blocks);
    expect(withCitedSourceBlock([text(`[NASA](${NASA})`)], new Map())).toEqual([
      text(`[NASA](${NASA})`),
    ]);
    expect(withCitedSourceBlock([text(`[NASA](${NASA})`)], undefined)).toEqual([
      text(`[NASA](${NASA})`),
    ]);
    const attached = withCitedSourceBlock([text(`[NASA](${NASA})`)], mars());
    expect(withCitedSourceBlock(attached, mars())).toBe(attached);
  });

  it("fills an empty title from the site label and caps the list", () => {
    const items = citedSourceItems([text(`BBC says so [BBC](${BBC}).`)], mars());
    expect(items).toEqual([
      { url: "https://www.bbc.co.uk/news/science", title: "bbc", site: "bbc" },
    ]);

    const links = Array.from({ length: CITED_SOURCES_MAX + 1 }, (_, index) => {
      const url = `https://example.test/page-${index}`;
      return `[p${index}](${url})`;
    });
    const many = recorded(
      links.map((_, index) => [`https://example.test/page-${index}`, `Page ${index}`]),
    );
    const cited = citedSourceItems([text(links.join(" "))], many);
    expect(cited).toHaveLength(CITED_SOURCES_MAX);
    expect(cited[0]?.url).toBe("https://example.test/page-0");
    expect(cited.at(-1)?.url).toBe(`https://example.test/page-${CITED_SOURCES_MAX - 1}`);
  });

  it("counts a reference-style link", () => {
    const blocks = withCitedSourceBlock(
      [text(`Mars is cold [NASA][nasa].\n\n[nasa]: ${NASA}`)],
      mars(),
    );
    expect(messageSources(blocks)).toEqual([{ url: NASA, title: "Mars Facts", site: "nasa" }]);
  });
});

describe("citationMarkdown", () => {
  const sources = [
    { url: NASA, title: "Mars Facts", site: "nasa" },
    { url: ESA, title: "Mars Express", site: "esa" },
    { url: WIKI, title: "Mars", site: "wikipedia" },
  ];

  it("collapses adjacent citations and leaves the sentence punctuation", () => {
    const answer = `A day lasts 24 hours ([NASA](${NASA}), [ESA](${ESA})). A year is 687 days [Wiki](${WIKI}).`;
    const prepared = citationMarkdown(answer, sources);
    expect(prepared.groups).toHaveLength(2);
    expect(prepared.groups[0]?.items.map((item) => item.site)).toEqual(["nasa", "esa"]);
    expect(prepared.groups[1]?.items.map((item) => item.site)).toEqual(["wikipedia"]);
    expect(prepared.markdown).toBe(
      "A day lasts 24 hours [nasa](rakazo-cite:0). A year is 687 days [wikipedia](rakazo-cite:1).",
    );
  });

  it("keeps a link the sentence reads on through as a link", () => {
    const answer = `Read [the mission page](${NASA}) for the timeline, then [ESA](${ESA})\nnext line.`;
    const prepared = citationMarkdown(answer, sources);
    expect(prepared.markdown).toBe(
      `Read [the mission page](${NASA}) for the timeline, then [esa](rakazo-cite:0)\nnext line.`,
    );
  });

  it("still pills a named source that follows a claim, or that ends before a comma", () => {
    const claim = `The rover [landed in 2021](${NASA}) [ESA](${ESA}).`;
    expect(citationMarkdown(claim, sources).markdown).toBe(
      `The rover [landed in 2021](${NASA}) [esa](rakazo-cite:0).`,
    );
    expect(citationMarkdown(`See [NASA](${NASA}), then read on.`, sources).markdown).toBe(
      "See [nasa](rakazo-cite:0), then read on.",
    );
  });

  it("keeps a claim written as the link's words as a link", () => {
    const answer = `The rover [landed in Jezero crater in 2021](${NASA}). It is [49 km wide](${ESA}), seen from orbit.`;
    const prepared = citationMarkdown(answer, sources);
    expect(prepared.groups).toEqual([]);
    expect(prepared.markdown).toBe(answer);
  });

  it("draws a pill for a link named by its address, a part of its title or a number", () => {
    const news = { url: BBC, title: "Rover lands on Mars - BBC News", site: "bbc" };
    const answer = `It is red [nasa.gov](${NASA}). It landed [BBC News](${BBC}). It has two moons [2](${WIKI}).`;
    const prepared = citationMarkdown(answer, [...sources, news]);
    expect(prepared.markdown).toBe(
      "It is red [nasa](rakazo-cite:0). It landed [bbc](rakazo-cite:1). It has two moons [wikipedia](rakazo-cite:2).",
    );
  });

  it("keeps one pill when the same page is cited twice in a cluster", () => {
    const prepared = citationMarkdown(`[NASA](${NASA}) [nasa.gov](${NASA})`, sources);
    expect(prepared.groups).toEqual([{ index: 0, items: [sources[0]!] }]);
    expect(prepared.markdown).toBe("[nasa](rakazo-cite:0)");
  });

  it("does not cite a link that is not a source, or a link inside code", () => {
    const answer = `See [notes](https://example.test/notes) and \`[NASA](${NASA})\`.`;
    expect(citationMarkdown(answer, sources).markdown).toBe(answer);
  });

  it("leaves an image link as an image link", () => {
    const answer = `[![photo](https://images.example.test/mars.png)](${NASA})`;
    expect(citationMarkdown(answer, sources).markdown).toBe(answer);
  });

  it("leaves a source past the cap as an ordinary link", () => {
    const capped = sources.slice(0, 1);
    const answer = `Mars [NASA](${NASA}). Venus [ESA](${ESA}).`;
    expect(citationMarkdown(answer, capped).markdown).toBe(
      `Mars [nasa](rakazo-cite:0). Venus [ESA](${ESA}).`,
    );
  });

  it("cites a recorded source by where it sits, whatever its words say", () => {
    const space = "https://www.space.com/mars-sample-return";
    const dated = [...sources, { url: space, title: "Mars sample return", site: "space" }];
    const cluster = `The mission returns samples in 2031. [NASA, 16 November](${NASA}) · [Space.com](${space})`;
    const clustered = citationMarkdown(cluster, dated);
    expect(clustered.groups).toHaveLength(1);
    expect(clustered.groups[0]?.items.map((item) => item.site)).toEqual(["nasa", "space"]);
    expect(clustered.markdown).toBe("The mission returns samples in 2031. [nasa](rakazo-cite:0)");

    const parenthetical = `The budget was cut ([Space.com, 11 November 2026](${space})).`;
    const wrapped = citationMarkdown(parenthetical, dated);
    expect(wrapped.groups).toHaveLength(1);
    expect(wrapped.groups[0]?.items.map((item) => item.url)).toEqual([space]);
    expect(wrapped.markdown).toBe("The budget was cut [space](rakazo-cite:0).");
  });

  it("keeps a parenthetical link the sentence reads on through", () => {
    const space = "https://www.space.com/mars-sample-return";
    const dated = [...sources, { url: space, title: "Mars sample return", site: "space" }];
    const answer = `The crater was cut ([Space.com, 11 November 2026](${space})) and mapped ([49 km across](${ESA})) and deep.`;
    expect(citationMarkdown(answer, dated).markdown).toBe(answer);
    const carried = `It returns samples in 2031. [NASA, 16 November](${NASA}) and then more.`;
    expect(citationMarkdown(carried, dated).markdown).toBe(carried);
    const sentence = `Budget news. [The agency will cancel the lander](${NASA}). More next week.`;
    expect(citationMarkdown(sentence, dated).markdown).toBe(sentence);
  });

  it("pulls a space in so punctuation sits against the pill", () => {
    const answer = `It landed in 2031 [NASA](${NASA}) .`;
    expect(citationMarkdown(answer, sources).markdown).toBe(
      "It landed in 2031 [nasa](rakazo-cite:0).",
    );
  });

  it("does not rewrite while the reply is still streaming", () => {
    const answer = `[NASA](${NASA})`;
    expect(preparedCitationMarkdown(answer, sources, true)).toEqual({
      markdown: answer,
      groups: [],
    });
    expect(preparedCitationMarkdown(answer, undefined, false).markdown).toBe(answer);
  });
});

describe("citation markers", () => {
  it("reads a citation marker and shows the row from two sources up", () => {
    expect(citationGroupIndex("rakazo-cite:1")).toBe(1);
    expect(citationGroupIndex("rakazo-cite:")).toBeUndefined();
    expect(citationGroupIndex("https://example.test")).toBeUndefined();
    expect(showSourcesRow(1)).toBe(false);
    expect(showSourcesRow(2)).toBe(true);
    expect(messageSources([{ kind: "text", text: "Hi" }])).toEqual([]);
  });
});
