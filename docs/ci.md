# CI recipe (GitHub Actions)

Copy this into your dApp's workflow. It installs Surfpool from its official release, checks the
archive against a pinned sha256, and runs your Playwright suite with the fixtures from
`@solana-e2e/playwright`.

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      SURFPOOL_VERSION: v1.7.0
      SURFPOOL_SHA256: 5bef2b0b186a74622508f104b6d2e4e2db040932b6d8f3a811172e241f802a63 # linux-x64
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Install Surfpool
        run: |
          mkdir -p "$RUNNER_TEMP/surfpool" && cd "$RUNNER_TEMP/surfpool"
          curl -fsSL -o surfpool.tgz "https://github.com/solana-foundation/surfpool/releases/download/${SURFPOOL_VERSION}/surfpool-linux-x64.tar.gz"
          echo "${SURFPOOL_SHA256}  surfpool.tgz" | sha256sum -c -
          tar -xzf surfpool.tgz
          echo "SURFPOOL_BIN=$RUNNER_TEMP/surfpool/surfpool" >> "$GITHUB_ENV"
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report }
```

Take the sha256 for another version or platform from the release page (GitHub shows a digest for
each asset) or from `gh api repos/solana-foundation/surfpool/releases/tags/<tag> --jq '.assets[] | "\(.name) \(.digest)"'`.

## Notes

- One Surfpool per Playwright worker. Each starts offline on free ports in about a second.
- Mock-mode specs need no Surfpool at all; run them in a cheaper job.
- To fork real programs from devnet, set `localnetOptions: { network: "devnet" }`. That needs
  network access from the runner and is slower.
