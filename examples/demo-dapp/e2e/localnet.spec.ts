/**
 * RPC mode against a real local chain: the wallet signs and sends to Surfpool, and the test checks
 * what landed. Needs Surfpool on the PATH or SURFPOOL_BIN set (or LOCALNET_RPC_URL for a running chain).
 */
import { expect, LAMPORTS_PER_SOL, test } from "@solana-e2e/playwright";
import { generateKeyPairSigner } from "@solana/kit";

test.use({
  walletOptions: { accounts: ["alice", "bob"] },
  localnetOptions: process.env.LOCALNET_RPC_URL ? { rpcUrl: process.env.LOCALNET_RPC_URL } : {},
});

test.beforeEach(async ({ page, localnet }) => {
  await page.goto(`/?rpc=${encodeURIComponent(localnet.rpcUrl)}`);
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
});

test("a memo lands on chain", async ({ page, wallet, localnet }) => {
  await page.getByPlaceholder("memo text").fill("hello localnet");
  await page.getByRole("button", { name: "Send memo" }).click();
  await expect(page.getByRole("status")).toContainText("Memo sent");

  const { signature } = await wallet.waitForRequest("signAndSendTransaction");
  const tx = await localnet.getTransaction(signature!);
  expect(tx.err).toBeNull();
  expect(tx.logs).toContain("Program log: hello localnet");
});

test("a transfer moves the lamports", async ({ page, wallet, localnet }) => {
  const recipient = (await generateKeyPairSigner()).address;
  await page.getByPlaceholder("recipient address").fill(recipient);
  await page.getByPlaceholder("lamports").fill(String(LAMPORTS_PER_SOL / 2n));
  await page.getByRole("button", { name: "Transfer" }).click();
  await expect(page.getByRole("status")).toContainText("Transfer sent");

  expect(await localnet.getBalance(recipient)).toBe(LAMPORTS_PER_SOL / 2n);
  const { signature } = await wallet.waitForRequest("signAndSendTransaction");
  const tx = await localnet.getTransaction(signature!);
  expect(tx.balanceChanges[recipient]).toBe(LAMPORTS_PER_SOL / 2n);
});

test("a failing transaction shows the error and is logged as failed", async ({ page, wallet }) => {
  const recipient = (await generateKeyPairSigner()).address;
  await page.getByPlaceholder("recipient address").fill(recipient);
  await page.getByPlaceholder("lamports").fill(String(1_000n * LAMPORTS_PER_SOL)); // more than the 10 SOL funded
  await page.getByRole("button", { name: "Transfer" }).click();

  await expect(page.getByRole("status")).toContainText("Error:");
  const failed = await wallet.waitForRequest("signAndSendTransaction");
  expect(failed.outcome).toBe("failed");
});

test("a rejected transaction never reaches the chain", async ({ page, wallet, localnet }) => {
  const before = await localnet.getBalance(wallet.address);
  wallet.rejectNext({ method: "signAndSendTransaction" });
  await page.getByRole("button", { name: "Send memo" }).click();

  await expect(page.getByRole("status")).toHaveText("Request rejected by the user");
  expect(await localnet.getBalance(wallet.address)).toBe(before);
});

test("the second account pays after a switch", async ({ page, wallet, localnet }) => {
  const bob = wallet.accounts[1]!.address;
  const before = await localnet.getBalance(bob);
  wallet.switchAccount("bob");
  await expect(page.locator("#account")).toHaveText(bob);

  await page.getByRole("button", { name: "Send memo" }).click();
  await expect(page.getByRole("status")).toContainText("Memo sent");
  expect(await localnet.getBalance(bob)).toBeLessThan(before);
});
