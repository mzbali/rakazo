import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers/helpers";

const COUNTER = `function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Section heading="Taps">
      <Diagram direction="horizontal" nodes={[{ id: "a", label: "Your message" }, { id: "b", label: "Bot reply" }]} edges={[{ from: "a", to: "b" }]} />
      <p>Count: {count}</p>
      <Button label="Add one" onClick={() => setCount(count + 1)} />
      <Text>How it counts: https://example.com/counter</Text>
    </Section>
  );
}
export default Counter;`;

const REPORT = `function Report() {
  const [count, setCount] = useState(0);
  return (
    <Section heading="Quarter in review">
      <p>Count: {count}</p>
      <Button label="Add one" onClick={() => setCount(count + 1)} />
      <Text>Notes: https://example.com/report</Text>
      <div style={{ height: 2800 }}>Every team, week by week.</div>
    </Section>
  );
}
export default Report;`;

/** A nine-stage explainer as a real chat drew it: numbered labels, and every stage in one row. */
const BILL = `function StagesBill() {
  const stages = [
    { id: "first", label: "1", title: "First reading", detail: "The bill is introduced." },
    { id: "second", label: "2", title: "Second reading", detail: "Principles are debated." },
    { id: "committee", label: "3", title: "Committee", detail: "Line-by-line scrutiny." },
    { id: "report", label: "4", title: "Report stage", detail: "The House reviews amendments." },
    { id: "third", label: "5", title: "Third reading", detail: "Final debate and vote." },
    { id: "lords", label: "6", title: "Second House", detail: "The other House repeats the stages." },
    { id: "pingpong", label: "7", title: "Ping-pong", detail: "Both Houses agree the same text." },
    { id: "assent", label: "8", title: "Royal Assent", detail: "The monarch agrees to the bill." },
    { id: "act", label: "9", title: "Act of Parliament", detail: "The bill is now law." },
  ];
  return (
    <Section title="How a bill becomes law in the UK">
      <Stages stages={stages}>
        <Diagram
          direction="horizontal"
          nodes={stages.map((stage) => ({ id: stage.id, label: stage.title }))}
          edges={stages.slice(1).map((stage, index) => ({ from: stages[index].id, to: stage.id }))}
        />
      </Stages>
      <Caption>Nine stages, one progress bar.</Caption>
    </Section>
  );
}
export default StagesBill;`;

/** The visual's document, two sandboxed frames down; a card keeps its chat copy hidden while opened. */
function visualFrame(scope: Locator, title: string) {
  return scope
    .locator(`iframe[title="${title}"]:visible`)
    .contentFrame()
    .locator("iframe#preview")
    .contentFrame();
}

/** The scrollbar rule the frame's document gets; headless browsers draw overlay bars, so a width is no proof. */
function scrollbarWidthRule(frame: ReturnType<typeof visualFrame>) {
  return frame.locator("html").evaluate((root) => getComputedStyle(root).scrollbarWidth);
}

async function showVisual(page: Page, title: string, summary: string, source: string) {
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(
    `call show_visual with ${JSON.stringify({ title, summary, source })}\nthen say Here it is: ${title}.`,
  );
  await composer.press("Enter");
  await expect(
    page.getByTestId("message-bot-bubble").getByText(`Here it is: ${title}.`),
  ).toBeVisible({ timeout: 30_000 });
}

// A phone has no hover, so the action rail sits below the answer and the card keeps the full column.
test.describe("on a phone", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("draws a product comparison across a phone-width visual", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/e2e/fixtures/gallery.html?embed&scenario=visual-photos&theme=dark");
    const card = page.getByTestId("visual-card");
    const visual = visualFrame(card, "Countertop blenders");
    const mini = visual.getByRole("img", { name: "Blend Mini blender" });
    const plus = visual.getByRole("img", { name: "Blend Plus blender" });
    for (const photo of [mini, plus]) {
      await expect(photo).toBeVisible();
      await expect
        .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBe(160);
      expect((await photo.boundingBox())!.width).toBeGreaterThan(130);
    }
    expect((await mini.boundingBox())!.y).toBe((await plus.boundingBox())!.y);
    const photoGrid = visual.locator(".rk-grid").first();
    const scroll = visual.locator(".rk-table-scroll");
    expect((await scroll.boundingBox())!.width).toBeCloseTo(
      (await photoGrid.boundingBox())!.width,
      0,
    );
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollWidth - node.clientWidth))
      .toBeGreaterThan(0);
    const leadingCell = visual.getByRole("cell", { name: "Price" });
    await expect(leadingCell).toHaveCSS("position", "sticky");
    await captureScreenshot(page, testInfo, "visual-product-photo-phone");
    const initial = (await leadingCell.boundingBox())!.x;
    await scroll.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    expect((await leadingCell.boundingBox())!.x).toBeCloseTo(initial, 0);
  });

  test("fits a three-column comparison inside the phone card without scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/e2e/fixtures/gallery.html?embed&scenario=visual-camera-table&theme=dark");
    const visual = visualFrame(page.getByTestId("visual-card"), "Camera comparison");
    const scroll = visual.locator(".rk-table-scroll");
    await expect(scroll).toBeVisible();
    expect((await scroll.boundingBox())!.width).toBeLessThan(330);
    await expect.poll(() => scroll.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    await expect(scroll).not.toHaveAttribute("data-fade-end");
  });
});

test("a visual that fits works in the chat; a tall one opens full screen", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("rakazo.uiAppearance", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page, `visuals-${Date.now()}@rakazo.test`, "password12", "Visual Reader");
  await completeOnboarding(page);

  const small = "Tap counter";
  await showVisual(page, small, "A counter that adds one per tap.", COUNTER);
  const card = page.getByTestId("visual-card").first();
  const frame = visualFrame(card, small);
  await expect(frame.getByText("Bot reply", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect((await card.boundingBox())!.height).toBeLessThan(900);
  // It fits, so it is live in the chat: a tap on its control acts there and nothing offers
  // to open it whole.
  await expect(card.locator("[inert]")).toHaveCount(0);
  await expect(card.getByRole("button", { name: `Expand ${small}` })).toHaveCount(0);
  await frame.getByRole("button", { name: "Add one" }).click();
  await expect(frame.getByText("Count: 1")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "visual-inline");
  // Its link prompt shows over the chat and takes clicks; Cancel leaves the visual where it is.
  await frame.getByRole("link", { name: "https://example.com/counter" }).click();
  const leaveInline = page.getByRole("alertdialog", { name: "Open external link?" });
  await expect(leaveInline).toContainText("example.com/counter");
  await leaveInline.getByRole("button", { name: "Cancel" }).click();
  await expect(leaveInline).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const tall = "Quarter report";
  await showVisual(page, tall, "The quarter, team by team.", REPORT);
  const report = page.getByTestId("visual-card").nth(1);
  await expect(visualFrame(report, tall).getByText("Quarter in review")).toBeAttached({
    timeout: 15_000,
  });
  // Too tall for the chat: its top shows inert and capped, and only the corner button opens it whole.
  await expect(report.locator("[inert]")).toHaveCount(1);
  await expect
    .poll(async () => (await report.boundingBox())?.height ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(1000);
  expect((await report.boundingBox())!.height).toBeLessThanOrEqual(1200);
  await expect(report.getByRole("button")).toHaveCount(1);
  // Inline it shows no scrollbar.
  expect(await scrollbarWidthRule(visualFrame(report, tall))).toBe("none");
  await report.getByRole("button", { name: `Expand ${tall}` }).click();
  const opened = page.getByRole("dialog", { name: tall });
  await expect(visualFrame(opened, tall).getByText("Every team, week by week.")).toBeVisible();
  await visualFrame(opened, tall).getByRole("button", { name: "Add one" }).click();
  await expect(visualFrame(opened, tall).getByText("Count: 1")).toBeVisible();
  // Opened whole, it is its own document and scrolls with a scrollbar.
  expect(await scrollbarWidthRule(visualFrame(opened, tall))).toBe("auto");
  expect(
    await visualFrame(opened, tall)
      .locator("html")
      .evaluate((root) => root.scrollHeight > root.clientHeight),
  ).toBe(true);
  await captureScreenshot(page, testInfo, "visual-open");
  // Its link prompt shows above the full-screen visual and takes clicks; Cancel leaves it open.
  await visualFrame(opened, tall).getByRole("link", { name: "https://example.com/report" }).click();
  const leave = page.getByRole("alertdialog", { name: "Open external link?" });
  await expect(leave).toContainText("example.com/report");
  await leave.getByRole("button", { name: "Cancel" }).click();
  await expect(leave).toBeHidden();
  await expect(opened).toBeVisible();
  await opened.getByRole("button", { name: "Close preview" }).click();
  await expect(opened).toBeHidden();
  // The chat draws its own copy again, from the start.
  await expect(visualFrame(report, tall).getByText("Count: 0")).toBeVisible();
});

test("a stage explainer stays compact and its row diagram reflows at phone width", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("rakazo.uiAppearance", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page, `visuals-stages-${Date.now()}@rakazo.test`, "password12", "Visual Reader");
  await completeOnboarding(page);

  const title = "UK bill stages";
  await showVisual(page, title, "A nine-stage bill explainer.", BILL);
  const card = page.getByTestId("visual-card").first();
  const frame = visualFrame(card, title);
  await expect(frame.locator(".rk-stage-title")).toHaveText("First reading", {
    timeout: 15_000,
  });
  // Nine numbered pills would be a wall of buttons; the picker is the progress bar.
  await expect(frame.locator(".rk-choices")).toHaveCount(0);
  const progress = frame.locator("progress");
  await expect(progress).toHaveAttribute("max", "9");
  await expect(progress).toHaveAttribute("value", "1");
  // The nine-box row stacked to fit the card, instead of scaling its text to fit.
  const viewBox = (await frame.locator(".rk-diagram svg").getAttribute("viewBox")) ?? "";
  const drawn = Number(/^[-\d.]+ [-\d.]+ ([\d.]+)/.exec(viewBox)?.[1] ?? 0);
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThanOrEqual(360);
  // The picker still steps: Next moves the stage and its title.
  await frame.getByRole("button", { name: "Next" }).click();
  await expect(frame.locator(".rk-stage-title")).toHaveText("Second reading");
  await expect(progress).toHaveAttribute("value", "2");
  await captureScreenshot(page, testInfo, "visual-stages-phone");
});

/** Two notes on neighbouring points, plus the dashed target, as a phone-width chat drew them. */
const INFLATION = `function Inflation() {
  const points = [
    { label: "2016", value: 1.2 },
    { label: "2018", value: 2.4 },
    { label: "2020", value: 0.2 },
    { label: "2022", value: 11.1 },
    { label: "2023", value: 9.6 },
    { label: "2026", value: 3.6 },
  ];
  return (
    <Section title="UK CPI">
      <LineChart
        points={points}
        unit="%"
        floor={0}
        ceiling={12}
        reference={{ value: 2, label: "2% target" }}
        annotations={[
          { at: 3, label: "Oct 2022 peak 11.1%" },
          { at: 4, label: "Oct 2026 3.6%" },
        ]}
      />
    </Section>
  );
}
export default Inflation;`;

/** A row with edge names. At phone width it stacks, and the names must stay off the arrows. */
const PASSAGE = `function Passage() {
  const nodes = [
    { id: "third", label: "Third reading", detail: "Final Commons vote" },
    { id: "lords", label: "House of Lords", detail: "Same five stages" },
    { id: "ping", label: "Ping-pong", detail: "Agree identical text" },
  ];
  return (
    <Section title="After the Commons">
      <Diagram
        direction="horizontal"
        nodes={nodes}
        edges={[
          { from: "third", to: "lords", label: "passes to" },
          { from: "lords", to: "ping", label: "if amended" },
        ]}
      />
    </Section>
  );
}
export default Passage;`;

test("phone-width notes and a stacked diagram stay readable", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("rakazo.uiAppearance", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page, `visuals-notes-${Date.now()}@rakazo.test`, "password12", "Visual Reader");
  await completeOnboarding(page);

  const chartTitle = "Inflation notes";
  await showVisual(page, chartTitle, "CPI with two close notes.", INFLATION);
  const chart = visualFrame(page.getByTestId("visual-card").first(), chartTitle);
  await expect(chart.locator(".rk-reference-label")).toHaveText("2% target", { timeout: 15_000 });
  const notes = await chart
    .locator(".rk-annotation text, .rk-reference-label")
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        if (!(node instanceof SVGElement) || !node.ownerSVGElement) return [];
        const box = node.getBoundingClientRect();
        const svg = node.ownerSVGElement.getBoundingClientRect();
        return [
          {
            x: box.x - svg.x,
            y: box.y - svg.y,
            width: box.width,
            height: box.height,
            svgWidth: svg.width,
            svgHeight: svg.height,
          },
        ];
      }),
    );
  expect(notes.length).toBeGreaterThanOrEqual(2);
  for (const note of notes) {
    expect(note.x).toBeGreaterThanOrEqual(-1);
    expect(note.y).toBeGreaterThanOrEqual(-1);
    expect(note.x + note.width).toBeLessThanOrEqual(note.svgWidth + 1);
    expect(note.y + note.height).toBeLessThanOrEqual(note.svgHeight + 1);
  }
  for (let index = 0; index < notes.length; index++) {
    for (const other of notes.slice(index + 1)) {
      const note = notes[index]!;
      expect(
        note.x + note.width <= other.x + 1 ||
          other.x + other.width <= note.x + 1 ||
          note.y + note.height <= other.y + 1 ||
          other.y + other.height <= note.y + 1,
      ).toBe(true);
    }
  }
  await captureScreenshot(page, testInfo, "visual-line-notes-phone");

  const flowTitle = "Stacked passage";
  await showVisual(page, flowTitle, "A bill moving to the Lords.", PASSAGE);
  const flow = visualFrame(page.getByTestId("visual-card").nth(1), flowTitle);
  await expect(flow.locator(".rk-diagram-edge-label").first()).toHaveText("passes to", {
    timeout: 15_000,
  });
  const column = await flow.locator(".rk-diagram").evaluate((diagram) => {
    const svg = diagram.querySelector("svg")!;
    const svgBox = svg.getBoundingClientRect();
    const nodes = [...diagram.querySelectorAll(".rk-diagram-node")].map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x - svgBox.x, width: box.width };
    });
    const label = diagram.querySelector(".rk-diagram-edge-label")!.getBoundingClientRect();
    return {
      svgWidth: svgBox.width,
      nodes,
      label: { x: label.x - svgBox.x, width: label.width },
    };
  });
  expect(column.nodes).toHaveLength(3);
  const width = column.nodes[0]!.width;
  for (const node of column.nodes) expect(Math.abs(node.width - width)).toBeLessThan(2);
  for (const node of column.nodes) {
    expect(Math.abs(node.x + node.width / 2 - column.svgWidth / 2)).toBeLessThan(8);
  }
  const mid = column.nodes[0]!.x + width / 2;
  expect(column.label.x > mid + 2 || column.label.x + column.label.width < mid - 2).toBe(true);
  await captureScreenshot(page, testInfo, "visual-stack-phone");
});
