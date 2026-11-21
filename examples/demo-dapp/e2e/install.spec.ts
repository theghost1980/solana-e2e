/**
 * How the wallet gets into the page: late injection, several wallets, a whole context, uninstall.
 * No chain needed: these specs only connect and sign messages.
 */
import { expect, test } from "@playwright/test";
import { installTestWallet, uninstallTestWallet } from "@solana-e2e/wallet/playwright";

const walletButton = (page: import("@playwright/test").Page, name: string) => page.getByRole("button", { name, exact: true });

test("late injection: the dApp loads without a wallet, then the wallet appears", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#wallets button")).toHaveCount(0);

  const wallet = await installTestWallet(page, { name: "Late Wallet", late: true });
  await walletButton(page, "Late Wallet").click();
  await expect(page.locator("#account")).toHaveText(wallet.address);
});

test("two wallets side by side: the dApp lists both and uses the one the user picks", async ({ page }) => {
  const first = await installTestWallet(page, { name: "First Wallet", accounts: ["first"] });
  const second = await installTestWallet(page, { name: "Second Wallet", accounts: ["second"] });
  await page.goto("/");
  await expect(page.locator("#wallets button")).toHaveText(["First Wallet", "Second Wallet"]);

  await walletButton(page, "Second Wallet").click();
  await expect(page.locator("#account")).toHaveText(second.address);
  await page.getByRole("button", { name: "Sign message" }).click();
  await expect(page.getByRole("status")).toContainText("Message signed");

  expect(second.requests.map((r) => r.method)).toEqual(["connect", "signMessage"]);
  expect(first.requests).toEqual([]);
});

test("installing on a BrowserContext covers every page it opens", async ({ context }) => {
  const wallet = await installTestWallet(context, { name: "Context Wallet" });
  const one = await context.newPage();
  const two = await context.newPage();
  for (const page of [one, two]) {
    await page.goto("/");
    await walletButton(page, "Context Wallet").click();
    await expect(page.locator("#account")).toHaveText(wallet.address);
  }
  expect(wallet.requests.filter((r) => r.method === "connect")).toHaveLength(2);

  // Account changes reach every open page.
  await one.close();
  wallet.disconnect();
  await expect(two.locator("#account")).toHaveText("Not connected");
});

test("uninstallTestWallet removes the wallet from the page", async ({ page }) => {
  const wallet = await installTestWallet(page, { name: "Leaving Wallet" });
  await page.goto("/");
  await expect(walletButton(page, "Leaving Wallet")).toBeVisible();

  await uninstallTestWallet(wallet);
  await expect(page.locator("#wallets button")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#wallets button")).toHaveCount(0);
});
