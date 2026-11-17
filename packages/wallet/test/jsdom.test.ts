// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getWallets } from "@wallet-standard/app";
import { afterEach, expect, test } from "vitest";
import { registerTestWallet, type RegisteredTestWallet } from "../src/index.js";

let registered: RegisteredTestWallet | undefined;
afterEach(() => {
  registered?.unregister();
  registered = undefined;
});

const find = (name: string) => getWallets().get().find((wallet) => wallet.name === name)!;

test("a dApp discovers, connects and signs through Wallet Standard", async () => {
  registered = await registerTestWallet({ name: "Jsdom Wallet", accounts: ["alice", "bob"] });
  const wallet = find("Jsdom Wallet");
  expect(wallet).toBeDefined();
  expect(Object.keys(wallet.features)).toContain("solana:signAndSendTransaction");

  const changes: number[] = [];
  (wallet.features["standard:events"] as any).on("change", ({ accounts }: any) => changes.push(accounts.length));

  const { accounts } = await (wallet.features["standard:connect"] as any).connect();
  expect(accounts[0].address).toBe(registered.wallet.address);
  expect(accounts[0].publicKey).toBeInstanceOf(Uint8Array);

  const [signed] = await (wallet.features["solana:signMessage"] as any).signMessage({
    account: accounts[0],
    message: new TextEncoder().encode("hi"),
  });
  expect(signed.signature).toHaveLength(64);

  registered.wallet.switchAccount("bob");
  expect(wallet.accounts[0]!.address).toBe(registered.wallet.accounts[1]!.address);
  expect(changes).toEqual([1, 1]);
});

test("rejections reach the dApp as errors with a code", async () => {
  registered = await registerTestWallet({ name: "Rejecting Wallet" });
  registered.wallet.rejectNext();
  const wallet = find("Rejecting Wallet");
  await expect((wallet.features["standard:connect"] as any).connect()).rejects.toMatchObject({
    code: 4001,
    message: "User rejected the request.",
  });
});

test("unregister removes the wallet", async () => {
  registered = await registerTestWallet({ name: "Gone Wallet" });
  registered.unregister();
  expect(getWallets().get().some((wallet) => wallet.name === "Gone Wallet")).toBe(false);
});
