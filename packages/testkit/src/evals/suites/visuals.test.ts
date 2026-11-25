import { describe, expect, it } from "vitest";
import type { Evidence } from "../cases.js";
import { EMPTY_SETTINGS } from "../cases.js";
import type { JudgeInput } from "../judge.js";
import type { VisualCase } from "./visuals.js";
import {
  gradeVisuals,
  VISUAL_DEFINITIONS,
  VISUALS_EVAL_CASES,
  VISUALS_JUDGE_CALIBRATION,
  VISUALS_JUDGE_VERSION,
  visualUse,
} from "./visuals.js";

type Call = Evidence["toolCalls"][number];

function evidence(toolCalls: Call[], overrides: Partial<Evidence> = {}): Evidence {
  return {
    text: "",
    files: {},
    records: [],
    notes: [],
    calls: [],
    routines: [],
    memory: "",
    approvalPending: false,
    pendingApproval: null,
    priorMemory: "",
    toolNames: [],
    toolCalls,
    finalStep: 1,
    settings: EMPTY_SETTINGS,
    settingsBefore: EMPTY_SETTINGS,
    messaging: { originThreadId: null, outbound: [] },
    ...overrides,
  };
}

const visual = (source: string, outcome: Call["outcome"] = "succeeded", extra = {}): Call => ({
  step: 1,
  name: "show_visual",
  args: { title: "T", summary: "S", source, ...extra },
  outcome,
});

// Recorded from real runs, trimmed to the parts the scorers read.
const CALCULATOR = `export default function V() {
  const [rate, setRate] = useState(4.5);
  return (
    <Section>
      <Slider label="Interest rate" value={rate} onChange={setRate} min={1} max={8} />
      <Result label="Monthly payment" value="£1,667" />
      <LineChart data={[]} />
    </Section>
  );
}`;
const CHECKLIST = `export default () => <Section><Checklist interactive sections={[{title: "Week 1", items: [{text: "Run"}]}]} /></Section>;`;
const PHOTOS = `export default () => <Section><Image src="rakazo-image:1" alt="Camera" /><Image src="rakazo-image:2" alt="Camera" /></Section>;`;
const NEWS = `export default () => <Section><NewsRows items={[{label: "France", title: "T", image: "rakazo-image:1"}]} /><Upcoming items={[{date: "2027-03-04", title: "Vote"}]} /></Section>;`;
const NEWS_TABLE = `export default () => <Section><Table columns={["Country"]} rows={[["France"]]} /></Section>;`;
const PROSE_ONLY = `export default () => <Section><Text>Words</Text></Section>;`;

const definition = (id: string): VisualCase => VISUAL_DEFINITIONS.find((d) => d.id === id)!;
const failed = (criteria: Array<{ id: string; pass: boolean }>) =>
  criteria.filter((c) => !c.pass).map((c) => c.id);

describe("visualUse", () => {
  it("counts only drawing calls on the final turn and lists kit components once", () => {
    const use = visualUse(
      evidence(
        [
          { step: 1, name: "show_visual", args: { help: true }, outcome: "succeeded" },
          visual(CALCULATOR),
          visual(CALCULATOR),
          { ...visual(CHECKLIST), step: 0 },
        ],
        { finalStep: 1 },
      ),
    );
    expect(use.calls).toBe(2);
    expect(use.succeeded).toBe(2);
    expect(use.components).toEqual(["Section", "Slider", "Result", "LineChart"]);
    expect(use.plotted).toBe(false);
  });

  it("counts failures before the first success, and every call when none succeeds", () => {
    expect(
      visualUse(
        evidence([visual(CALCULATOR, "failed"), visual(CALCULATOR, "failed"), visual(CALCULATOR)]),
      ).failedBeforeFirstSuccess,
    ).toBe(2);
    expect(
      visualUse(evidence([visual(CALCULATOR), visual(CALCULATOR, "failed")]))
        .failedBeforeFirstSuccess,
    ).toBe(0);
    expect(
      visualUse(evidence([visual(CALCULATOR, "failed"), visual(CALCULATOR, "failed")]))
        .failedBeforeFirstSuccess,
    ).toBe(2);
  });

  it("takes components only from visuals that reached the chat, and ignores plot guide reads", () => {
    expect(
      visualUse(evidence([visual(CALCULATOR, "failed"), visual(PROSE_ONLY)])).components,
    ).toEqual(["Section", "Text"]);
    expect(
      visualUse(evidence([{ step: 1, name: "render_plot", args: { help: true } }])).plotted,
    ).toBe(false);
  });

  it("flags render_plot and a plotting script on the computer", () => {
    expect(visualUse(evidence([{ step: 1, name: "render_plot", args: {} }])).plotted).toBe(true);
    expect(
      visualUse(
        evidence([
          { step: 1, name: "shell", args: { command: "python3 -c 'import matplotlib.pyplot'" } },
        ]),
      ).plotted,
    ).toBe(true);
    expect(
      visualUse(evidence([{ step: 1, name: "shell", args: { command: "date -u" } }])).plotted,
    ).toBe(false);
  });

  it("wants every photo passed to be placed by a rakazo-image reference on the first call", () => {
    const one = [{ url: "https://img.example/a.jpg", alt: "a" }];
    const two = [...one, { url: "https://img.example/b.jpg", alt: "b" }];
    const photos = (images: unknown, source = PHOTOS) =>
      visualUse(evidence([visual(source, "succeeded", { images })])).firstCallPhotos;
    expect(photos(two)).toBe(true);
    // Two photos placed but one passed, or the reverse: show_visual refuses both.
    expect(photos(one)).toBe(false);
    expect(photos(two, PHOTOS.replace("rakazo-image:2", "rakazo-image:1"))).toBe(false);
    expect(photos(undefined)).toBe(false);
    // Placed correctly, but show_visual rejects the arguments before fetching anything.
    expect(photos([one[0], { url: "ftp://img.example/b.jpg", alt: "b" }])).toBe(false);
    expect(photos([one[0], { url: "https://img.example/b.jpg", alt: "  " }])).toBe(false);
    expect(photos(two, PROSE_ONLY)).toBe(false);
    expect(
      visualUse(
        evidence([visual(PROSE_ONLY, "failed"), visual(PHOTOS, "succeeded", { images: two })]),
      ).firstCallPhotos,
    ).toBe(false);
  });
});

describe("gradeVisuals", () => {
  it("passes a money answer drawn as a calculator and fails one drawn as prose", () => {
    const mortgage = definition("money-mortgage");
    expect(failed(gradeVisuals(mortgage, evidence([visual(CALCULATOR)])))).toEqual([]);
    expect(failed(gradeVisuals(mortgage, evidence([visual(PROSE_ONLY)])))).toEqual(["uses Slider"]);
    expect(failed(gradeVisuals(mortgage, evidence([])))).toEqual([
      "show_visual succeeds 1 to 2 times",
      "uses Slider",
    ]);
  });

  it("asks for two to four visuals on an explainer", () => {
    const explainer = definition("explainer-p-vs-np");
    expect(failed(gradeVisuals(explainer, evidence([visual(CALCULATOR)])))).toEqual([
      "show_visual succeeds 2 to 4 times",
    ]);
    expect(
      failed(gradeVisuals(explainer, evidence([visual(CALCULATOR), visual(CHECKLIST)]))),
    ).toEqual([]);
    expect(failed(gradeVisuals(explainer, evidence(Array(5).fill(visual(CALCULATOR)))))).toEqual([
      "show_visual succeeds 2 to 4 times",
    ]);
  });

  it("fails a fetched-data answer drawn with a plot tool, even beside the right chart", () => {
    const inflation = definition("data-inflation");
    expect(failed(gradeVisuals(inflation, evidence([visual(CALCULATOR)])))).toEqual([]);
    expect(
      failed(
        gradeVisuals(
          inflation,
          evidence([{ step: 1, name: "render_plot", args: {} }, visual(CALCULATOR)]),
        ),
      ),
    ).toEqual(["no plot tool or plot script"]);
  });

  it("fails an answer that retried before its first visual worked", () => {
    expect(
      failed(
        gradeVisuals(
          definition("component-checklist"),
          evidence([visual(CHECKLIST, "failed"), visual(CHECKLIST)]),
        ),
      ),
    ).toEqual(["at most 0 failed show_visual before the first success"]);
  });

  it("expects no visual for a one-fact question", () => {
    const tokyo = definition("plain-tokyo-time");
    expect(failed(gradeVisuals(tokyo, evidence([])))).toEqual([]);
    expect(failed(gradeVisuals(tokyo, evidence([visual(CALCULATOR)])))).toEqual([
      "show_visual succeeds 0 times",
    ]);
  });

  it("wants news rows with a date tile and photos on the first call", () => {
    const protests = definition("news-farm-protests");
    const images = [{ url: "https://img.example/a.jpg", alt: "a" }];
    expect(
      failed(gradeVisuals(protests, evidence([visual(NEWS, "succeeded", { images })]))),
    ).toEqual([]);
    expect(
      failed(gradeVisuals(protests, evidence([visual(NEWS_TABLE, "succeeded", { images })]))),
    ).toEqual(["uses NewsRows and Upcoming", "first call passes photos and places them"]);
    expect(failed(gradeVisuals(protests, evidence([visual(NEWS)])))).toEqual([
      "first call passes photos and places them",
    ]);
  });

  it("wants photos on the first call of the product case, whatever the fetch did", () => {
    const cameras = definition("photos-cameras");
    const images = [
      { url: "https://img.example/a.jpg", alt: "a" },
      { url: "https://img.example/b.jpg", alt: "b" },
    ];
    expect(failed(gradeVisuals(cameras, evidence([visual(PHOTOS, "failed", { images })])))).toEqual(
      [],
    );
    expect(failed(gradeVisuals(cameras, evidence([visual(PHOTOS, "succeeded")])))).toEqual([
      "first call passes photos and places them",
    ]);
  });
});

describe("visuals suite", () => {
  it("covers every category once or more, with unique ids", () => {
    const ids = VISUAL_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(VISUAL_DEFINITIONS.map((d) => d.category))).toEqual(
      new Set(["explainer", "decision", "money", "component", "data", "photos", "news", "plain"]),
    );
    expect(VISUALS_EVAL_CASES).toHaveLength(ids.length);
  });

  it("sends each case's meaning to the judge and keeps the data case's page offline", () => {
    for (const scenario of VISUALS_EVAL_CASES) {
      // Observed, not a case judge: the checks run and decide without judge credentials.
      expect(scenario.judge).toBeUndefined();
      expect(scenario.observe).toBeTypeOf("function");
    }
    const data = VISUALS_EVAL_CASES.find((c) => c.id === "data-inflation")!;
    expect(data.fixtureData).toBeDefined();
  });

  it("builds the judge's evidence from the visuals that succeeded", () => {
    const scenario = VISUALS_EVAL_CASES.find((c) => c.id === "money-mortgage")!;
    const input = scenario.observe!(
      evidence([visual(CALCULATOR, "failed"), visual(CALCULATOR)], { text: "Here it is." }),
    )["matches-target"] as JudgeInput;
    expect(input.rubric.startsWith(`${VISUALS_JUDGE_VERSION}:`)).toBe(true);
    const shown = input.evidence as { visuals: unknown[]; reply: string };
    expect(shown.visuals).toHaveLength(1);
    expect(shown.reply).toBe("Here it is.");
  });

  it("calibrates the judge with passing and failing references on the same request", () => {
    expect(new Set(VISUALS_JUDGE_CALIBRATION.map((c) => c.pass))).toEqual(new Set([true, false]));
    for (const { input } of VISUALS_JUDGE_CALIBRATION)
      expect(input.rubric.startsWith(`${VISUALS_JUDGE_VERSION}:`)).toBe(true);
    const requests = VISUALS_JUDGE_CALIBRATION.map(
      (c) => (c.input.evidence as { request: string }).request,
    );
    for (const request of new Set(requests))
      expect(
        new Set(
          VISUALS_JUDGE_CALIBRATION.filter(
            (c) => (c.input.evidence as { request: string }).request === request,
          ).map((c) => c.pass),
        ),
      ).toEqual(new Set([true, false]));
  });
});
