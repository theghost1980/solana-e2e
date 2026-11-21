# solana-e2e

End-to-end testing for Solana dApps without browser extensions.

**[Website and live playground](https://solana-e2e.saturnomangieri.com)** — try the test wallet in your browser and get the Playwright spec for what you click.

| Package | What it does |
|---|---|
| [`@solana-e2e/wallet`](packages/wallet) | A Wallet Standard test wallet. `mock` mode signs without a network; `rpc` mode signs and sends to a local chain. Works in Playwright (injected) and Vitest/jsdom (registered). Your test approves, rejects, fails, switches accounts. |
| [`@solana-e2e/playwright`](packages/playwright) | Playwright fixtures: a Surfpool chain per worker, a funded wallet per test, helpers to read what landed on chain. |
| [`examples/demo-dapp`](examples/demo-dapp) | A small Wallet Standard dApp with both kinds of specs and a CI recipe. |

## Why

Wallet connect-and-sign is the part of a dApp that E2E suites skip. Driving real extensions
(Phantom, Solflare) is slow and breaks when the extension changes its popups; hand-written mocks get
copied from repo to repo and stop at `signMessage`. This kit is the middle ground the Solana
Foundation's own [UI testing plan](https://github.com/solana-foundation/templates/blob/main/docs/agents/ui-testing-plan.md)
describes: a headless Wallet Standard wallet with a throwaway keypair, injected with a Playwright
init script, plus a local chain to check the result.

## Quick start

```ts
// mock mode, no chain
import { installTestWallet } from "@solana-e2e/wallet/playwright";

test("connect", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Solana E2E Test Wallet" }).click();
  await expect(page.getByText(wallet.address)).toBeVisible();
});
```

```ts
// rpc mode on Surfpool
import { expect, test } from "@solana-e2e/playwright";

test("memo lands", async ({ page, wallet, localnet }) => {
  await page.goto(`/?rpc=${localnet.rpcUrl}`);
  // ...click through the dApp...
  const { signature } = await wallet.waitForRequest("signAndSendTransaction");
  expect((await localnet.getTransaction(signature!)).err).toBeNull();
});
```

See [docs/ci.md](docs/ci.md) for a GitHub Actions recipe.

## Develop

```bash
npm ci --ignore-scripts
npm run build
npm test
npx playwright install chromium
cd examples/demo-dapp && SURFPOOL_BIN=/path/to/surfpool npx playwright test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [changelog](CHANGELOG.md).

## License

MIT
