/**
 * The site tests itself: the playground runs the real @solana-e2e/wallet in the page, so these specs
 * also prove that in-page (mock mode) use works in a real browser.
 */
import { expect, test, type Page } from "@playwright/test";

const dapp = (page: Page) => page.getByLabel("Demo dApp");
const panel = (page: Page) => page.getByLabel("Test wallet controls");
const status = (page: Page) => dapp(page).getByRole("status");
const spec = (page: Page) => page.getByTestId("spec");

test("the dApp discovers the in-page wallet, connects and signs", async ({ page }) => {
  await page.goto("/");
  await dapp(page).getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await expect(status(page)).toHaveText("Connected to Solana E2E Test Wallet");
  await expect(panel(page).getByTestId("wallet-state")).toContainText("yes");

  await dapp(page).getByRole("button", { name: "Sign message" }).click();
  await expect(status(page)).toContainText("Message signed");
  await expect(page.getByTestId("request-log").locator("tr").first()).toContainText("signMessage");
  await expect(spec(page)).toContainText('await page.getByRole("button", { name: "Sign message" }).click();');
});

test("reject next and fail next reach the dApp and the generated spec", async ({ page }) => {
  await page.goto("/");
  await dapp(page).getByRole("button", { name: "Solana E2E Test Wallet" }).click();

  await panel(page).getByLabel("Next request for").selectOption("signMessage");
  await panel(page).getByRole("button", { name: "Reject next" }).click();
  await dapp(page).getByRole("button", { name: "Sign message" }).click();
  await expect(status(page)).toHaveText("Request rejected by the user");

  await panel(page).getByRole("button", { name: "Fail next" }).click();
  await dapp(page).getByRole("button", { name: "Sign message" }).click();
  await expect(status(page)).toHaveText("Error: Simulated failure");

  await expect(spec(page)).toContainText('wallet.rejectNext({ method: "signMessage" });');
  await expect(spec(page)).toContainText('[["connect", "approved"], ["signMessage", "rejected"], ["signMessage", "failed"]]');
});

test("manual approval holds the request until approved in the panel", async ({ page }) => {
  await page.goto("/");
  await dapp(page).getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await panel(page).getByLabel("Manual approval").check();

  await dapp(page).getByRole("button", { name: "Send memo" }).click();
  await expect(status(page)).toHaveText("Waiting for the wallet…");
  await expect(page.getByTestId("pending")).toContainText("signAndSendTransaction is waiting");
  await page.getByTestId("pending").getByRole("button", { name: "Approve" }).click();
  await expect(status(page)).toContainText("Memo signed (mock mode, not sent)");
  await expect(spec(page)).toContainText("wallet.approve();");
});

test("account switch from the wallet updates the dApp", async ({ page }) => {
  await page.goto("/");
  await dapp(page).getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  const before = await dapp(page).getByTestId("dapp-account").textContent();
  await panel(page).getByRole("button", { name: "Switch account" }).click();
  await expect(dapp(page).getByTestId("dapp-account")).not.toHaveText(before!);
  await expect(panel(page).getByTestId("wallet-state")).toContainText("bob");
});

test("wallet options: a wallet without signIn and with another name", async ({ page }) => {
  await page.goto("/?name=Cautious%20Wallet&disable=solana:signIn");
  await dapp(page).getByRole("button", { name: "Cautious Wallet" }).click();
  await dapp(page).getByRole("button", { name: "Sign in" }).click();
  await expect(status(page)).toHaveText("Error: this wallet does not support Sign In With Solana");
  await expect(spec(page)).toContainText('name: "Cautious Wallet", disabledFeatures: ["solana:signIn"]');
});

test("no request leaves the page", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://localhost:5180")) external.push(request.url());
  });
  await page.goto("/");
  await dapp(page).getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await dapp(page).getByRole("button", { name: "Send memo" }).click();
  await expect(status(page)).toContainText("Memo signed");
  expect(external).toEqual([]);
});

test("works under the Content-Security-Policy that Netlify serves", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("../../../netlify.toml", import.meta.url), "utf8");
  const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)![1]!;
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.route("http://localhost:5180/**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  await page.goto("/");
  await dapp(page).getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await dapp(page).getByRole("button", { name: "Sign message" }).click();
  await expect(status(page)).toContainText("Message signed");
  expect(violations).toEqual([]);
});
