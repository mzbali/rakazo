import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

async function expectRailBesideCard(row: Locator, cardId: string) {
  const card = row.getByTestId(cardId);
  const rail = row.getByTestId("message-hover-rail");
  // The transcript can still be scrolling as cards above render, moving another row under the pointer.
  await expect(async () => {
    await row.hover();
    await expect(rail).toHaveCSS("opacity", "1", { timeout: 1_000 });
  }).toPass();
  await expect
    .poll(async () => {
      const cardBox = await card.boundingBox();
      const railBox = await rail.boundingBox();
      if (!cardBox || !railBox) return null;
      return Math.round(railBox.x - cardBox.x - cardBox.width);
    })
    .toBe(4);
}

// 720px leaves 36px of slack beyond the narrowest column (684px) where a card and its actions fit.
test("card actions sit beside the card without scrolling the chat sideways", async ({
  page,
}, testInfo) => {
  for (const width of [1440, 1024, 720]) {
    await page.setViewportSize({ width, height: 900 });
    for (const { scenario, cardId, count } of [
      { scenario: "secrets", cardId: "secret-ask-card", count: 4 },
      { scenario: "rich", cardId: "mcp-approval-card", count: 1 },
    ]) {
      await page.goto(`/e2e/fixtures/gallery.html?embed&scenario=${scenario}`);
      const transcript = page.getByTestId("transcript");
      const rows = page.locator("[data-message-id]").filter({ has: page.getByTestId(cardId) });
      await expect(rows).toHaveCount(count);
      expect(await transcript.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
      for (const row of await rows.all()) await expectRailBesideCard(row, cardId);
      expect(await transcript.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
      if (width === 1024 && scenario === "secrets") {
        await expectRailBesideCard(rows.first(), cardId);
        await captureScreenshot(page, testInfo, "secret-card-actions-beside-card");
      }
    }
  }
});

async function expectReadingColumn(page: Page, theme: "light" | "dark") {
  await page.goto(`/e2e/fixtures/gallery.html?embed&scenario=conversation&theme=${theme}`);
  const bot = page.getByTestId("message-bot-bubble").filter({ hasText: "Got it, one paragraph." });
  await expect(bot).toBeVisible();
  await expect(bot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(bot).toHaveCSS("border-radius", "0px");
  await expect(bot).toHaveCSS("padding-top", "0px");
  await expect(bot).toHaveCSS("padding-left", "0px");
  const frame = page
    .locator("[data-message-id]")
    .filter({ has: bot })
    .getByTestId("message-bubble-frame");
  await expect(frame).toHaveClass(/max-w-xl/);
  const measured = await frame.evaluate((element) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { maxWidth: getComputedStyle(element).maxWidth, reading: 36 * rem };
  });
  expect(measured.maxWidth).toBe(`${measured.reading}px`);
  const table = page.getByTestId("message-bot-bubble").filter({ has: page.locator("table") });
  await expect(table).toBeVisible();
  await expect(
    page.locator("[data-message-id]").filter({ has: table }).getByTestId("message-bubble-frame"),
  ).toHaveClass(/max-w-xl/);
  const user = page
    .getByTestId("message-user-bubble")
    .filter({ hasText: "Keep the summary short." });
  await expect(user).not.toHaveCSS("border-radius", "0px");
  await expect(user).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
}

test("bot answers read as one column and user messages stay bubbles", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await expectReadingColumn(page, theme);
    await captureScreenshot(page, testInfo, `bot-prose-column-${theme}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectReadingColumn(page, "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await captureScreenshot(page, testInfo, "bot-prose-column-phone");
});
