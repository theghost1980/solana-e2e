# @solana-e2e/playwright

Playwright fixtures for Solana dApps: a fresh [Surfpool](https://github.com/solana-foundation/surfpool)
chain per worker, and a funded [`@solana-e2e/wallet`](../wallet) test wallet per test that signs
and sends to it. Your test clicks through the dApp, then checks what actually landed on chain.

## Install

```bash
npm install -D @solana-e2e/playwright @solana/kit @playwright/test
```

You also need the `surfpool` binary: install it from the
[Surfpool docs](https://docs.surfpool.run) or from its
[GitHub releases](https://github.com/solana-foundation/surfpool/releases), then put it on the PATH
or point `SURFPOOL_BIN` at it.

## Use

```ts
import { expect, test } from "@solana-e2e/playwright";

test.use({ walletOptions: { accounts: ["alice"] } });

test("a transfer lands", async ({ page, wallet, localnet }) => {
  await page.goto(`/?rpc=${localnet.rpcUrl}`); // however your app takes its RPC URL
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await page.getByRole("button", { name: "Send" }).click();

  const { signature } = await wallet.waitForRequest("signAndSendTransaction");
  const tx = await localnet.getTransaction(signature!);
  expect(tx.err).toBeNull();
  expect(tx.logs).toContain("Program log: hello");
});
```

Your dApp must talk to `localnet.rpcUrl`. Common ways: a query parameter, an env var read by the
dev server (`webServer.env` in `playwright.config.ts`, with a fixed `localnetOptions.port`), or
`page.route` to redirect your usual RPC host.

## Fixtures

| Fixture | Scope | |
|---|---|---|
| `localnet` | worker | a Surfpool chain, offline, on free ports; stopped when the worker ends |
| `localnetOptions` | worker option | `{ rpcUrl }` to reuse a running chain, `port`, `network` to fork, `surfpoolBin`, `args` |
| `wallet` | test, auto | a `TestWallet` in `rpc` mode, injected into `page` before any navigation, every account funded |
| `walletOptions` | option | any `@solana-e2e/wallet` option (`accounts`, `approval`, `disabledFeatures`…) |
| `walletFunding` | option | lamports per account, default 10 SOL, `0n` to skip |

## `localnet`

| | |
|---|---|
| `rpcUrl`, `wsUrl`, `rpc` | endpoints and a `@solana/kit` RPC client |
| `fund(address, lamports)` | airdrop and wait for confirmation |
| `getBalance(address)` | lamports at `confirmed` |
| `waitForSignature(signature, { commitment?, timeoutMs? })` | throws if the transaction failed |
| `getTransaction(signature)` | `{ err, logs, accountKeys, balanceChanges, slot }` |
| `stop()` | kill Surfpool and remove its temp dir |

`startLocalnet(options)` is exported too, for Vitest or scripts.

## Why Surfpool and not LiteSVM

A browser dApp needs a JSON-RPC endpoint. LiteSVM runs in-process and has no RPC server, so it fits
program tests but not browser E2E. Surfpool serves standard JSON-RPC (with CORS for local origins),
starts in about a second, and can fork accounts from devnet or mainnet when you need real programs.

## License

MIT
