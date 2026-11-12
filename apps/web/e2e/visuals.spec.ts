import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const COUNTER = `function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Section heading="Taps">
      <Diagram direction="horizontal" nodes={[{ id: "a", label: "Your message" }, { id: "b", label: "Bot reply" }]} edges={[{ from: "a", to: "b" }]} />
      <p>Count: {count}</p>
      <Button label="Add one" onClick={() => setCount(count + 1)} />
    </Section>
  );
}
export default Counter;`;

const REPORT = `function Report() {
  return (
    <Section heading="Quarter in review">
      <div style={{ height: 1600 }}>Every team, week by week.</div>
    </Section>
  );
}
export default Report;`;

/** The visual's document, two sandboxed frames down. */
function visualFrame(scope: Locator, title: string) {
  return scope
    .locator(`iframe[title="${title}"]`)
    .contentFrame()
    .locator("iframe#preview")
    .contentFrame();
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

test("a visual that fits works in the chat and expands; a tall one previews and opens", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("rakazo.uiAppearance", "dark"));
  await page.setViewportSize({ width: 1280, height: 860 });
  await signup(page, `visuals-${Date.now()}@rakazo.test`, "password12", "Visual Reader");
  await completeOnboarding(page);

  const small = "Tap counter";
  await showVisual(page, small, "A counter that adds one per tap.", COUNTER);
  const card = page.getByTestId("visual-card").first();
  const frame = visualFrame(card, small);
  await expect(frame.getByText("Bot reply", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(640);
  // It fits, so it is live in the chat: a tap on its control acts there and opens nothing.
  await expect(card.locator("[inert]")).toHaveCount(0);
  await frame.getByRole("button", { name: "Add one" }).click();
  await expect(frame.getByText("Count: 1")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "visual-inline");

  // Expand is the one way it opens whole.
  await card.getByRole("button", { name: `Expand ${small}` }).click();
  const dialog = page.getByRole("dialog", { name: small });
  await expect(visualFrame(dialog, small).getByText("Your message", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "visual-open");
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(dialog).toBeHidden();
  // The chat's copy kept its state.
  await expect(frame.getByText("Count: 1")).toBeVisible();

  const tall = "Quarter report";
  await showVisual(page, tall, "The quarter, team by team.", REPORT);
  const report = page.getByTestId("visual-card").nth(1);
  await expect(visualFrame(report, tall).getByText("Quarter in review")).toBeAttached({
    timeout: 15_000,
  });
  // Too tall for the chat: its top shows inert, capped, and a click opens it whole.
  await expect(report.locator("[inert]")).toHaveCount(1);
  await expect
    .poll(async () => (await report.boundingBox())?.height ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(600);
  expect((await report.boundingBox())!.height).toBeLessThanOrEqual(640);
  await report.getByRole("button", { name: `Open ${tall}` }).click();
  const opened = page.getByRole("dialog", { name: tall });
  await expect(visualFrame(opened, tall).getByText("Every team, week by week.")).toBeVisible();
  await opened.getByRole("button", { name: "Close preview" }).click();
  await expect(opened).toBeHidden();
});
