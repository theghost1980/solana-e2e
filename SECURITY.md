# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security → Report a vulnerability** on this repository. Do not open a public issue.

You should get a first answer within a week.

## Scope

`@solana-e2e/wallet` and `@solana-e2e/playwright` are **test tools**. The wallet holds throwaway keys
in memory and signs whatever the page asks for, by design.

- Never give it a key that holds real funds.
- `rpc` mode refuses URLs containing `mainnet` unless you pass `allowMainnet: true`. Keep it that way.
- Do not ship the test wallet in a production bundle.

Reports about the points above are expected behaviour. Reports about the packages leaking keys outside
the test process, or about the CI recipe (for example, the Surfpool download check), are in scope.
