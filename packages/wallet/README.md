# @solana-e2e/wallet

A [Wallet Standard](https://github.com/wallet-standard/wallet-standard) test wallet for Solana dApps.
Your dApp discovers it exactly as it discovers Phantom or Solflare, but your test decides what the
"user" does: approve, reject, fail, switch account, disconnect.

- **Two modes**, one option:
  - `mock`: signs for real, never sends. For jsdom/Vitest and UI tests without a chain.
  - `rpc`: signs **and sends** to a local RPC (Surfpool, `solana-test-validator`), then waits for the commitment. Your test can check what landed on chain.
- **Every feature a dApp uses**: `standard:connect` (with silent connect), `standard:disconnect`, `standard:events`, `solana:signMessage`, `solana:signTransaction` and `solana:signAndSendTransaction` (legacy, v0, v1), `solana:signIn` (SIWS).
- **Runs in two places**: injected into Playwright pages (keys stay in Node), or registered in-process for Vitest + jsdom.
- No browser extension, no seed phrase, no popups.

Website and live playground: https://solana-e2e.saturnomangieri.com

## Install

```bash
npm install -D @solana-e2e/wallet @solana/kit
```

## Playwright

```ts
import { expect, test } from "@playwright/test";
import { installTestWallet } from "@solana-e2e/wallet/playwright";

test("connect and sign", async ({ page }) => {
  const wallet = await installTestWallet(page, { accounts: ["alice"] }); // before page.goto
  await page.goto("/");

  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await expect(page.getByTestId("address")).toHaveText(wallet.address);

  wallet.rejectNext({ method: "signMessage" });
  await page.getByRole("button", { name: "Sign message" }).click();
  await expect(page.getByText("Request rejected")).toBeVisible();
});
```

Pass a `BrowserContext` instead of a `Page` to cover every page and popup in the context. Call
`installTestWallet` several times (with different `name`s) to test a wallet picker.

**Late injection.** Real extensions sometimes announce themselves after the dApp has rendered. To
test that path, load the page first and pass `late: true`:

```ts
await page.goto("/");
await installTestWallet(page, { name: "Late Wallet", late: true }); // registers into the loaded page
```

A late wallet is not re-injected after a navigation or into pages opened later.

**Uninstall.** `uninstallTestWallet(wallet)` unregisters the wallet from open pages and stops pushing
account changes. On Playwright 1.56 or later it also removes the init script, so reloads come back
without it. Account updates stop by themselves when the page or context closes.

## Vitest + jsdom

```ts
// @vitest-environment jsdom
import { registerTestWallet } from "@solana-e2e/wallet";

const { wallet, unregister } = await registerTestWallet({ accounts: ["alice"] });
// render your app; it finds "Solana E2E Test Wallet" through getWallets()
afterAll(unregister);
```

`registerTestWallet` is a drop-in replacement for a hand-written `mock-wallet.ts`.

## Sending to a local chain (`rpc` mode)

```ts
const wallet = await installTestWallet(page, {
  mode: "rpc",
  rpcUrl: "http://127.0.0.1:8899",
  commitment: "confirmed",
});
// ...the dApp calls signAndSendTransaction...
const { signature } = await wallet.waitForRequest("signAndSendTransaction");
// check it on chain with your own RPC client, or with @solana-e2e/playwright
```

`rpc` mode refuses any `rpcUrl` containing `mainnet` unless you pass `allowMainnet: true`.

## Options

| Option | Default | |
|---|---|---|
| `mode` | `"mock"` | `"mock"` or `"rpc"` |
| `rpcUrl` | — | required for `"rpc"` |
| `commitment` | `"confirmed"` | what `signAndSendTransaction` waits for in `"rpc"` mode |
| `confirmTimeoutMs` | `30000` | |
| `accounts` | one random | a number, or a list of seed names (`"alice"` is always the same address) or `{ secretKey, label }` (32 or 64 bytes) |
| `name` | `"Solana E2E Test Wallet"` | name shown to the dApp |
| `icon` | built in | `data:image/...;base64,...` |
| `chains` | mainnet, devnet, testnet, localnet | announced chains |
| `disabledFeatures` | `[]` | e.g. `["solana:signIn"]` to test a less capable wallet |
| `supportedTransactionVersions` | `["legacy", 0, 1]` | |
| `approval` | `"auto"` | `"manual"` holds every request until `approve()` / `reject()` |
| `trusted` | `false` | whether a silent connect (`autoConnect`) gets the account |
| `allowMainnet` | `false` | |

## Controlling the wallet from the test

| Method | What the "user" does |
|---|---|
| `rejectNext({ method?, message? })` | clicks Cancel on the next request (error code 4001) |
| `failNext({ method?, message?, code? })` | the next request fails with your error |
| `setApproval("manual")`, `approve()`, `reject()`, `pending` | decide each request yourself |
| `switchAccount(index \| address \| label)` | picks another account; the dApp gets a `change` event |
| `disconnect()` | revokes the site from the wallet side |
| `setTrusted(boolean)` | trusts the site, for silent connect |
| `reset()` | back to a fresh, disconnected wallet (keys kept) |

And to observe it:

| | |
|---|---|
| `address`, `accounts`, `isConnected` | state |
| `requests` | every request: method, address, chain, outcome, signature, message text, error |
| `waitForRequest(method \| predicate, { outcome?, timeoutMs? })` | waits until a request is settled (or `pending`) |
| `signer(index?)` | a `@solana/kit` `KeyPairSigner` for the account, to fund or sign from the test |

Errors reach the dApp as `Error` objects with a numeric `code`: 4001 rejected, 4100 not authorized,
4200 unsupported method, 4201 unsupported transaction version, -32002 transaction failed, -32603
internal.

Like a real wallet, `signTransaction` and `signAndSendTransaction` refuse a transaction whose version
is not in `supportedTransactionVersions`. `signAndSendTransaction` also refuses one where the wallet
account is not the fee payer, or where other signers are still missing. Sign those with
`signTransaction` and send them yourself.

## How it works

`TestWallet` holds the keys, the connection state and the request log. In Playwright it lives in
the Node test process; the page gets a small Wallet Standard shell (via `addInitScript`) that
forwards each call through `exposeFunction`. In jsdom the same shell is mounted in-process. Both
paths serialise payloads as JSON, so they behave the same.

## Limitations

- **The Playwright transport is a Node bridge.** Keys stay in the test process and the page calls
  back through `exposeFunction`, so the injected wallet does not work as is in Cypress, Storybook or a
  page opened outside Playwright. An in-page build with no dependencies is on the roadmap for 0.2.
- **Only Chromium has been tested** so far. Firefox and WebKit should work, but are not in CI yet.
- **One visible account at a time**, as in Phantom: the dApp sees the active account, and
  `switchAccount` swaps it and emits `change`.
- **Silent connect** (`autoConnect`) never prompts, so `rejectNext({ method: "connect" })` and manual
  approval only apply to an explicit connect. An explicit connect while already connected goes through
  approval again.
- With `@solana-e2e/playwright`, the WebSocket URL of an existing chain passed as `rpcUrl` is
  inferred as the RPC port + 1 unless you pass `wsUrl`.

## License

MIT
