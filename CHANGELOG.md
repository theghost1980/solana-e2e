# Changelog

## 0.1.0 — 2026-11-21

First release of `@solana-e2e/wallet` and `@solana-e2e/playwright`.

### `@solana-e2e/wallet`
- Wallet Standard test wallet with two modes: `mock` (signs, never sends) and `rpc` (signs, sends to a
  local RPC and waits for the commitment).
- Features: `standard:connect` (with silent connect), `standard:disconnect`, `standard:events`,
  `solana:signMessage`, `solana:signTransaction` and `solana:signAndSendTransaction` (legacy, v0, v1),
  `solana:signIn` (SIWS).
- Test controls: `rejectNext`, `failNext`, manual approval, `switchAccount`, `disconnect`,
  `setTrusted`, `reset`, request log and `waitForRequest`.
- Playwright injection (`installTestWallet`, with `late` injection and `uninstallTestWallet`) and
  in-process registration for Vitest/jsdom (`registerTestWallet`).

### `@solana-e2e/playwright`
- Fixtures: a Surfpool chain per worker, a funded wallet per test.
- `localnet` helpers: `fund`, `getBalance`, `waitForSignature`, `getTransaction` with logs and
  balance changes.
