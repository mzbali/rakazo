import { expect, test } from "@playwright/test";
import { captureScreenshot } from "../helpers/helpers";

test.use({ viewport: { width: 1280, height: 1400 } });

for (const theme of ["light", "dark"]) {
  test(`chat draws formulas in prose and leaves the rest as text (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/gallery.html?scenario=maths&theme=${theme}`);
    const reply = page.locator(".rk-chat-markdown").last();
    // The inline formula and the two display ones.
    await expect(reply.locator(".katex")).toHaveCount(3);
    await expect(reply.locator(".katex-display")).toHaveCount(2);
    await expect(reply.locator(".rk-math-pending")).toHaveCount(0);
    await expect(reply).toContainText("A ticket costs $5 to $10, which is not maths.");
    await expect(reply.locator("code.rk-math-source")).toHaveText("\\frac{");
    await expect(reply).toContainText("an unclosed $$ stays text");
    await expect(reply.locator("code", { hasText: "\\(x\\)" })).toHaveCount(1);
    await captureScreenshot(page, testInfo, `chat-maths-${theme}`);
  });
}
