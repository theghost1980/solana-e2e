/**
 * Mock mode: no chain at all. The wallet signs for real but never sends, and the only RPC call the
 * dApp makes (getLatestBlockhash) is answered by `page.route`.
 */
import { expect, test } from "@playwright/test";
import { installTestWallet } from "@solana-e2e/wallet/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:8899/**", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: body.id,
        result: { context: { slot: 1 }, value: { blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N", lastValidBlockHeight: 100 } },
      },
    });
  });
});

test("connects and signs a message", async ({ page }) => {
  const wallet = await installTestWallet(page, { accounts: ["alice"] });
  await page.goto("/");

  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await expect(page.locator("#account")).toHaveText(wallet.address);

  await page.getByRole("button", { name: "Sign message" }).click();
  await expect(page.getByRole("status")).toContainText("Message signed");
  const request = await wallet.waitForRequest("signMessage");
  expect(request.message).toBe("Hello from the demo dApp");
});

test("shows the rejection when the user cancels", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();

  wallet.rejectNext({ method: "signMessage" });
  await page.getByRole("button", { name: "Sign message" }).click();
  await expect(page.getByRole("status")).toHaveText("Request rejected by the user");
});

test("follows an account switch made in the wallet", async ({ page }) => {
  const wallet = await installTestWallet(page, { accounts: ["alice", "bob"] });
  await page.goto("/");
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await expect(page.locator("#account")).toHaveText(wallet.accounts[0]!.address);

  wallet.switchAccount("bob");
  await expect(page.locator("#account")).toHaveText(wallet.accounts[1]!.address);
});

test("signs in with Solana", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("status")).toHaveText(`Signed in as ${wallet.address}`);
  const signIn = await wallet.waitForRequest("signIn");
  expect(signIn.message).toContain("localhost:5173 wants you to sign in with your Solana account:");
  expect(signIn.message).toContain("Nonce: demo1234");
});

test("signAndSendTransaction returns a signature without a chain", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await page.getByRole("button", { name: "Send memo" }).click();

  const sent = await wallet.waitForRequest("signAndSendTransaction");
  await expect(page.locator("#last-signature")).toHaveText(sent.signature!);
  expect(sent.chain).toBe("solana:localnet");
});

test("manual approval: the test decides when the user clicks Approve", async ({ page }) => {
  const wallet = await installTestWallet(page, { approval: "manual" });
  await page.goto("/");
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();

  await wallet.waitForRequest("connect", { outcome: "pending" });
  await expect(page.locator("#account")).toHaveText("Not connected");
  wallet.approve();
  await expect(page.locator("#account")).toHaveText(wallet.address);
});
