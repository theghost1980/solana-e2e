/**
 * The test wallet's control panel and the spec generator. The wallet is the real
 * @solana-e2e/wallet, registered in this page with registerTestWallet() in mock mode; the panel calls
 * the same methods a Playwright test would call, and every action becomes a line of the spec.
 */
import { registerTestWallet, type FeatureName, type TestWallet, type TestWalletOptions, type WalletMethod } from "@solana-e2e/wallet";
import { mountDapp, type Recorder } from "./dapp.js";

const DEFAULT_NAME = "Solana E2E Test Wallet";
const OPTIONAL_FEATURES: { feature: FeatureName; label: string }[] = [
  { feature: "solana:signAndSendTransaction", label: "signAndSendTransaction" },
  { feature: "solana:signIn", label: "signIn (SIWS)" },
];
const METHODS: WalletMethod[] = ["connect", "signMessage", "signIn", "signAndSendTransaction"];

interface Settings {
  name: string;
  disabled: FeatureName[];
  noV1: boolean;
}

function readSettings(): Settings {
  const params = new URLSearchParams(location.search);
  const name = (params.get("name") ?? "").trim().slice(0, 40) || DEFAULT_NAME;
  const disabled = (params.get("disable") ?? "")
    .split(",")
    .filter((value): value is FeatureName => OPTIONAL_FEATURES.some((item) => item.feature === value));
  return { name, disabled, noV1: params.get("v1") === "off" };
}

const q = (value: string) => JSON.stringify(value);
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function mountPlayground(dappRoot: HTMLElement, panelRoot: HTMLElement, specRoot: HTMLElement): Promise<void> {
  const settings = readSettings();
  const options: TestWalletOptions = {
    name: settings.name,
    accounts: ["alice", "bob"],
    disabledFeatures: settings.disabled,
    ...(settings.noV1 ? { supportedTransactionVersions: ["legacy", 0] } : {}),
  };

  // ------------------------------------------------------------------ the spec being written
  const steps: string[] = [];
  let wallet: TestWallet | undefined;
  const recorder: Recorder = {
    click: (label) => {
      steps.push(`await page.getByRole("button", { name: ${q(label)} }).click();`);
      renderSpec();
    },
    status: (text) => {
      const expected = text.includes(":") ? text.slice(0, text.indexOf(":")) : text;
      steps.push(`await expect(page.getByRole("status")).toContainText(${q(expected)});`);
      renderSpec();
    },
  };
  const record = (line: string) => {
    steps.push(line);
    renderSpec();
  };

  function installOptions(): string {
    const parts = [`accounts: ["alice", "bob"]`];
    if (settings.name !== DEFAULT_NAME) parts.push(`name: ${q(settings.name)}`);
    if (settings.disabled.length) parts.push(`disabledFeatures: [${settings.disabled.map(q).join(", ")}]`);
    if (settings.noV1) parts.push(`supportedTransactionVersions: ["legacy", 0]`);
    return `{ ${parts.join(", ")} }`;
  }

  function specText(): string {
    const body = [
      `const wallet = await installTestWallet(page, ${installOptions()});`,
      `await page.goto("/");`,
      ...steps,
    ];
    const settled = (wallet?.requests ?? []).filter((request) => request.outcome !== "pending");
    if (settled.length) {
      const pairs = settled.map((request) => `[${q(request.method)}, ${q(request.outcome)}]`).join(", ");
      body.push(`expect(wallet.requests.map((r) => [r.method, r.outcome])).toEqual([${pairs}]);`);
    }
    return [
      `import { expect, test } from "@playwright/test";`,
      `import { installTestWallet } from "@solana-e2e/wallet/playwright";`,
      ``,
      `// Recorded in the solana-e2e playground. Button and status texts are the demo dApp's: use yours.`,
      `test("recorded in the playground", async ({ page }) => {`,
      ...body.map((line) => `  ${line}`),
      `});`,
      ``,
    ].join("\n");
  }

  specRoot.innerHTML = `
    <div class="spec-head">
      <h3>Your test, written for you</h3>
      <div>
        <button type="button" data-spec="copy">Copy spec</button>
        <button type="button" data-spec="restart" class="secondary">Start over</button>
      </div>
    </div>
    <pre class="code" tabindex="0"><code data-testid="spec"></code></pre>`;
  const specCode = specRoot.querySelector<HTMLElement>("[data-testid=spec]")!;
  function renderSpec() {
    specCode.textContent = specText();
  }
  specRoot.querySelector<HTMLButtonElement>("[data-spec=copy]")!.onclick = async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(specText());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select the text to copy";
    }
    setTimeout(() => (button.textContent = "Copy spec"), 1500);
  };
  specRoot.querySelector<HTMLButtonElement>("[data-spec=restart]")!.onclick = () => location.reload();

  // ------------------------------------------------------------------ the wallet itself
  try {
    ({ wallet } = await registerTestWallet(options));
  } catch (error) {
    panelRoot.innerHTML = `<p class="warn">This browser cannot create Ed25519 keys with WebCrypto, which the test wallet needs
      (${escapeHtml(error instanceof Error ? error.message : String(error))}). Try a recent Chrome, Edge, Firefox or Safari.</p>`;
    mountDapp(dappRoot, recorder);
    renderSpec();
    return;
  }
  const w = wallet;
  mountDapp(dappRoot, recorder);

  // ------------------------------------------------------------------ the panel
  panelRoot.innerHTML = `
    <div class="panel-head">
      <strong>${escapeHtml(w.info.name)}</strong>
      <span class="badge">mock mode · in this page</span>
    </div>
    <dl class="panel-state" data-testid="wallet-state"></dl>

    <div class="panel-group">
      <label>Next request for
        <select data-control="method">
          <option value="">any method</option>
          ${METHODS.map((method) => `<option value="${method}">${method}</option>`).join("")}
        </select>
      </label>
      <div class="row">
        <button type="button" data-control="reject">Reject next</button>
        <button type="button" data-control="fail">Fail next</button>
      </div>
    </div>

    <div class="panel-group row">
      <button type="button" data-control="switch">Switch account</button>
      <button type="button" data-control="disconnect">Disconnect from wallet</button>
    </div>

    <div class="panel-group">
      <label class="check"><input type="checkbox" data-control="manual" /> Manual approval</label>
      <ul class="pending" data-testid="pending"></ul>
    </div>

    <details class="panel-group">
      <summary>Wallet options (reloads the playground)</summary>
      <label>Wallet name <input data-option="name" maxlength="40" value="${escapeHtml(settings.name)}" /></label>
      ${OPTIONAL_FEATURES.map(
        ({ feature, label }) =>
          `<label class="check"><input type="checkbox" data-option="feature" value="${feature}" ${settings.disabled.includes(feature) ? "" : "checked"} /> ${label}</label>`,
      ).join("")}
      <label class="check"><input type="checkbox" data-option="v1" ${settings.noV1 ? "" : "checked"} /> Transaction version 1</label>
      <button type="button" data-option="apply" class="secondary">Apply</button>
    </details>

    <h4>Request log <small>(<code>wallet.requests</code>)</small></h4>
    <div class="log-wrap"><table class="log">
      <thead><tr><th>#</th><th>method</th><th>outcome</th><th>detail</th></tr></thead>
      <tbody data-testid="request-log"></tbody>
    </table></div>`;

  const control = <T extends HTMLElement = HTMLButtonElement>(name: string) => panelRoot.querySelector<T>(`[data-control=${name}]`)!;
  const methodFilter = () => (control<HTMLSelectElement>("method").value || undefined) as WalletMethod | undefined;
  const methodArg = (method: WalletMethod | undefined) => (method ? `{ method: ${q(method)} }` : "");

  control("reject").onclick = () => {
    const method = methodFilter();
    w.rejectNext({ method });
    record(`wallet.rejectNext(${methodArg(method)});`);
  };
  control("fail").onclick = () => {
    const method = methodFilter();
    w.failNext({ method, message: "Simulated failure" });
    record(`wallet.failNext({ ${method ? `method: ${q(method)}, ` : ""}message: "Simulated failure" });`);
  };
  control("switch").onclick = () => {
    const next = w.address === w.accounts[0]!.address ? "bob" : "alice";
    w.switchAccount(next);
    record(`wallet.switchAccount(${q(next)});`);
  };
  control("disconnect").onclick = () => {
    w.disconnect();
    record(`wallet.disconnect();`);
  };
  control<HTMLInputElement>("manual").onchange = () => {
    const mode = control<HTMLInputElement>("manual").checked ? "manual" : "auto";
    w.setApproval(mode);
    record(`wallet.setApproval(${q(mode)});`);
  };

  panelRoot.querySelector<HTMLButtonElement>("[data-option=apply]")!.onclick = () => {
    const params = new URLSearchParams();
    const name = panelRoot.querySelector<HTMLInputElement>("[data-option=name]")!.value.trim();
    if (name && name !== DEFAULT_NAME) params.set("name", name);
    const disabled = [...panelRoot.querySelectorAll<HTMLInputElement>("[data-option=feature]")].filter((box) => !box.checked).map((box) => box.value);
    if (disabled.length) params.set("disable", disabled.join(","));
    if (!panelRoot.querySelector<HTMLInputElement>("[data-option=v1]")!.checked) params.set("v1", "off");
    const query = params.toString();
    location.href = `${location.pathname}${query ? `?${query}` : ""}#playground`;
  };

  // The wallet has no "something changed" event for the log, so the panel redraws when its snapshot changes.
  let snapshot = "";
  const stateEl = panelRoot.querySelector<HTMLElement>("[data-testid=wallet-state]")!;
  const pendingEl = panelRoot.querySelector<HTMLElement>("[data-testid=pending]")!;
  const logEl = panelRoot.querySelector<HTMLElement>("[data-testid=request-log]")!;

  function renderPanel() {
    const active = w.accounts.find((account) => account.address === w.address)!;
    const next = JSON.stringify([w.isConnected, w.address, w.pending.map((r) => r.id), w.requests.map((r) => [r.id, r.outcome, r.signature])]);
    if (next === snapshot) return;
    snapshot = next;

    stateEl.innerHTML = `
      <dt>Connected</dt><dd>${w.isConnected ? "yes" : "no"}</dd>
      <dt>Active account</dt><dd><strong>${escapeHtml(active.label ?? "")}</strong> <code title="${active.address}">${active.address.slice(0, 8)}…</code></dd>`;

    pendingEl.replaceChildren(
      ...w.pending.map((request) => {
        const item = document.createElement("li");
        item.innerHTML = `<span><code>${request.method}</code> is waiting</span>`;
        const approve = document.createElement("button");
        approve.type = "button";
        approve.textContent = "Approve";
        approve.onclick = () => {
          record(`await expect.poll(() => wallet.pending.length).toBeGreaterThan(0);`);
          w.approve();
          record(`wallet.approve();`);
        };
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "secondary";
        reject.textContent = "Reject";
        reject.onclick = () => {
          record(`await expect.poll(() => wallet.pending.length).toBeGreaterThan(0);`);
          w.reject();
          record(`wallet.reject();`);
        };
        item.append(approve, reject);
        return item;
      }),
    );

    logEl.replaceChildren(
      ...w.requests
        .slice()
        .reverse()
        .map((request) => {
          const row = document.createElement("tr");
          row.dataset.outcome = request.outcome;
          const detail = request.error?.message ?? (request.signature ? `signature ${request.signature.slice(0, 10)}…` : (request.message ?? ""));
          row.innerHTML = `<td>${request.id}</td><td><code>${request.method}</code></td><td class="outcome">${request.outcome}</td><td>${escapeHtml(detail.slice(0, 80))}</td>`;
          return row;
        }),
    );
    if (!w.requests.length) logEl.innerHTML = `<tr><td colspan="4" class="muted">No requests yet. Connect from the dApp.</td></tr>`;
    renderSpec();
  }

  renderPanel();
  setInterval(renderPanel, 150);
}
