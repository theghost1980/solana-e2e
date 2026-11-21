# Contributing

Thanks for helping. Issues and pull requests are welcome, in English.

## Setup

Node 22.12 or later.

```bash
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e -w demo-dapp
```

The Surfpool specs run when `SURFPOOL_BIN` points to a
[Surfpool](https://github.com/solana-foundation/surfpool/releases) binary; otherwise they are skipped.

## Pull requests

- One change per pull request, with a test when it changes behaviour.
- Keep the public API small; open an issue first for new options or exports.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).
- CI must be green on Linux, macOS and Windows.

## Your dApp stack is not covered?

Open a "My dApp stack is not covered" issue with the wallet library you use (`@solana/react`,
wallet-adapter, ConnectorKit…) and a minimal repo if you can. That is the most useful report.
