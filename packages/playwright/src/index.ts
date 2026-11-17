import { test as base, expect } from "@playwright/test";
import { installTestWallet, type TestWallet, type TestWalletOptions } from "@solana-e2e/wallet/playwright";
import { startLocalnet, type Localnet, type LocalnetOptions } from "./localnet.js";

export { expect };
export { freePort, startLocalnet } from "./localnet.js";
export type { Localnet, LocalnetOptions, TransactionSummary } from "./localnet.js";
export type { TestWallet, TestWalletOptions } from "@solana-e2e/wallet/playwright";

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface SolanaTestFixtures {
  /** Options for the `wallet` fixture. `mode` and `rpcUrl` are filled in from the localnet. */
  walletOptions: TestWalletOptions;
  /** Lamports airdropped to every wallet account before the test. Defaults to 10 SOL. 0 to skip. */
  walletFunding: bigint;
  /** A test wallet in `rpc` mode, injected into `page`, funded on the localnet. */
  wallet: TestWallet;
}

export interface SolanaWorkerFixtures {
  /** How to get a chain. Set `rpcUrl` to reuse a running one. */
  localnetOptions: LocalnetOptions;
  /** One fresh Surfpool chain per Playwright worker. */
  localnet: Localnet;
}

/**
 * Playwright `test` with a local chain per worker and a funded test wallet per test.
 *
 * ```ts
 * import { test, expect } from "@solana-e2e/playwright";
 * test("transfer lands", async ({ page, wallet, localnet }) => { ... });
 * ```
 */
export const test = base.extend<SolanaTestFixtures, SolanaWorkerFixtures>({
  localnetOptions: [{}, { scope: "worker", option: true }],
  localnet: [
    async ({ localnetOptions }, use) => {
      const localnet = await startLocalnet(localnetOptions);
      try {
        await use(localnet);
      } finally {
        await localnet.stop();
      }
    },
    { scope: "worker", timeout: 60_000 },
  ],
  walletOptions: [{}, { option: true }],
  walletFunding: [10n * LAMPORTS_PER_SOL, { option: true }],
  // auto: the wallet is injected before any page.goto, even from a beforeEach that does not ask for it.
  wallet: [
    async ({ page, localnet, walletOptions, walletFunding }, use) => {
      const wallet = await installTestWallet(page, { mode: "rpc", rpcUrl: localnet.rpcUrl, ...walletOptions });
      if (walletFunding > 0n) {
        await Promise.all(wallet.accounts.map(({ address }) => localnet.fund(address, walletFunding)));
      }
      await use(wallet);
    },
    { auto: true },
  ],
});
