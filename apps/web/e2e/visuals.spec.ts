import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const FLOW = `function Flow() {
  return (
    <Section heading="How a message flows">
      <Diagram direction="horizontal" nodes={[{ id: "a", label: "Your message" }, { id: "b", label: "Bot reply" }]} edges={[{ from: "a", to: "b" }]} />
    </Section>
  );
}
export default Flow;`;

/** The visual's document, two sandboxed frames down. */
function visualFrame(scope: Locator, title: string) {
  return scope
    .locator(`iframe[title="${title}"]`)
    .contentFrame()
    .locator("iframe#preview")
    .contentFrame();
}

test("a bot's visual draws inside the chat, only draws there, and opens whole", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("rakazo.uiAppearance", "dark"));
  await page.setViewportSize({ width: 1280, height: 860 });
  await signup(page, `visuals-${Date.now()}@rakazo.test`, "password12", "Visual Reader");
  await completeOnboarding(page);
  const title = "Message flow";
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(
    `call show_visual with ${JSON.stringify({
      title,
      summary: "Your message goes to the bot, which replies.",
      source: FLOW,
    })}\nthen say That is the whole loop.`,
  );
  await composer.press("Enter");

  const card = page.getByTestId("visual-card");
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText("That is the whole loop.")).toBeVisible();
  // Drawn in the chat, sized to its content.
  await expect(visualFrame(card, title).getByText("Bot reply")).toBeAttached();
  await expect
    .poll(async () => (await card.boundingBox())?.height ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(100);
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(640);
  // In the chat the frame only draws: it is inert, so its content cannot take focus or clicks.
  await expect(card.locator("[inert]")).toHaveCount(1);
  await captureScreenshot(page, testInfo, "visual-inline");

  await card.getByRole("button", { name: `Open ${title}` }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await expect(visualFrame(dialog, title).getByText("Your message")).toBeVisible();
  await captureScreenshot(page, testInfo, "visual-open");
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(dialog).toBeHidden();
});
