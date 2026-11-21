/**
 * Layout on a desktop, an iPhone 13 (WebKit) and a Pixel 7, in both themes and both languages:
 * no horizontal scroll anywhere, and a screenshot of the hero, the playground and the diagram attached
 * to the report for a human to look at. Also checks that the in-page wallet works in each engine.
 */
import { expect, test, type Page } from "@playwright/test";

// Compare with the device's own width: on phones, overflowing content can widen innerWidth itself.
const noHorizontalScroll = async (page: Page) => {
  const width = page.viewportSize()!.width;
  return page.evaluate((w) => document.documentElement.scrollWidth <= w && window.innerWidth <= w, width);
};

for (const theme of ["light", "dark"] as const) {
  for (const path of ["/", "/es/"]) {
    test(`${path} in ${theme} has no horizontal scroll`, async ({ page }, testInfo) => {
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.addInitScript(() => localStorage.setItem("lang", "chosen"));
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("html")).toHaveAttribute("lang", path === "/" ? "en" : "es");

      for (const section of ["main", "#playground", "#how-it-works"]) {
        const target = page.locator(section === "main" ? ".hero" : section);
        await target.scrollIntoViewIfNeeded();
        expect(await noHorizontalScroll(page), `horizontal scroll near ${section}`).toBe(true);
        await testInfo.attach(`${path === "/" ? "en" : "es"}-${theme}-${section.replace("#", "") === "main" ? "hero" : section.replace("#", "")}`, {
          body: await target.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
      }
    });
  }
}

test("the in-page wallet works in this engine", async ({ page }) => {
  await page.goto("/");
  const dapp = page.getByLabel("Demo dApp");
  await dapp.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await expect(dapp.getByRole("status")).toHaveText("Connected to Solana E2E Test Wallet");
  await dapp.getByRole("button", { name: "Send memo" }).click();
  await expect(dapp.getByRole("status")).toContainText("Memo signed");
});

test("the Spanish page links back to the English one and keeps the section", async ({ page }) => {
  await page.goto("/es/#playground");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("lo que dice tu test");
  await expect(page.getByLabel("Test wallet controls")).toContainText("Rechazar la siguiente");
  await page.locator("a.lang-switch").click();
  await expect(page).toHaveURL(/\/#playground$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("what your test says");
});

test("the mobile menu or the desktop nav reaches the playground", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Playground" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  } else {
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Playground" }).click();
  }
  await expect(page).toHaveURL(/#playground$/);
});
