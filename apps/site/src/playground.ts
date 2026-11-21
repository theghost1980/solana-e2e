/**
 * The test wallet's control panel and the spec generator. The wallet is the real
 * @solana-e2e/wallet, registered in this page with registerTestWallet(): in mock mode by default, or
 * in rpc mode against a chain on the visitor's own machine. The panel calls the same methods a
 * Playwright test would call, and every action becomes a line of the spec.
 */
import { address, createSolanaRpc, lamports, signature as toSignature } from "@solana/kit";
import { registerTestWallet, type FeatureName, type TestWallet, type TestWalletOptions, type WalletMethod } from "@solana-e2e/wallet";
import { mountDapp, type Recorder } from "./dapp.js";

const DEFAULT_NAME = "Solana E2E Test Wallet";
const DEFAULT_RPC = "http://127.0.0.1:8899";
const OPTIONAL_FEATURES: { feature: FeatureName; label: string }[] = [
  { feature: "solana:signAndSendTransaction", label: "signAndSendTransaction" },
  { feature: "solana:signIn", label: "signIn (SIWS)" },
];
const METHODS: WalletMethod[] = ["connect", "signMessage", "signIn", "signAndSendTransaction"];

const UI = {
  en: {
    modeMock: "mock mode · in this page",
    modeRpc: "rpc mode · your local chain",
    connected: "Connected",
    yes: "yes",
    no: "no",
    active: "Active account",
    nextFor: "Next request for",
    anyMethod: "any method",
    rejectNext: "Reject next",
    failNext: "Fail next",
    switchAccount: "Switch account",
    disconnect: "Disconnect from wallet",
    manual: "Manual approval",
    waiting: "is waiting",
    approve: "Approve",
    reject: "Reject",
    options: "Wallet options (reloads the playground)",
    walletName: "Wallet name",
    v1: "Transaction version 1",
    network: "Network",
    netMock: "mock: sign, send nothing",
    netRpc: "rpc: send to a chain on this computer",
    rpcUrl: "RPC URL",
    rpcHelp: "Start one with <code>surfpool start</code>. Only localhost addresses are allowed. Your browser may ask you to allow access to your local network.",
    rpcBadUrl: "Only http://localhost and 127.0.0.1 addresses are allowed.",
    apply: "Apply",
    fund: "Fund alice and bob (1 SOL each)",
    funding: "Requesting airdrops…",
    funded: "Funded",
    unreachable: (url: string) =>
      `Could not reach ${url}. Is Surfpool running? If your browser asked for access to your local network, allow it and press Fund again.`,
    log: "Request log",
    noRequests: "No requests yet. Connect from the dApp.",
    specTitle: "Your test, written for you",
    copy: "Copy spec",
    copied: "Copied",
    selectToCopy: "Select the text to copy",
    restart: "Start over",
    noCrypto: (message: string) =>
      `This browser cannot create Ed25519 keys with WebCrypto, which the test wallet needs (${message}). Try a recent Chrome, Edge, Firefox or Safari.`,
  },
  es: {
    modeMock: "modo mock · en esta página",
    modeRpc: "modo rpc · tu cadena local",
    connected: "Conectado",
    yes: "sí",
    no: "no",
    active: "Cuenta activa",
    nextFor: "Siguiente petición de",
    anyMethod: "cualquier método",
    rejectNext: "Rechazar la siguiente",
    failNext: "Hacer fallar la siguiente",
    switchAccount: "Cambiar de cuenta",
    disconnect: "Desconectar desde el wallet",
    manual: "Aprobación manual",
    waiting: "está esperando",
    approve: "Aprobar",
    reject: "Rechazar",
    options: "Opciones del wallet (recarga el playground)",
    walletName: "Nombre del wallet",
    v1: "Transacciones versión 1",
    network: "Red",
    netMock: "mock: firma, no envía nada",
    netRpc: "rpc: envía a una cadena en este ordenador",
    rpcUrl: "URL del RPC",
    rpcHelp: "Arranca una con <code>surfpool start</code>. Solo se permiten direcciones localhost. Puede que tu navegador te pida permiso para acceder a tu red local.",
    rpcBadUrl: "Solo se permiten direcciones http://localhost y 127.0.0.1.",
    apply: "Aplicar",
    fund: "Dar fondos a alice y bob (1 SOL cada uno)",
    funding: "Pidiendo airdrops…",
    funded: "Con fondos",
    unreachable: (url: string) =>
      `No se pudo conectar con ${url}. ¿Está Surfpool en marcha? Si el navegador te pidió acceso a tu red local, permítelo y vuelve a pulsar el botón de fondos.`,
    log: "Registro de peticiones",
    noRequests: "Aún no hay peticiones. Conecta desde la dApp.",
    specTitle: "Tu test, escrito para ti",
    copy: "Copiar spec",
    copied: "Copiado",
    selectToCopy: "Selecciona el texto para copiarlo",
    restart: "Empezar de nuevo",
    noCrypto: (message: string) =>
      `Este navegador no puede crear claves Ed25519 con WebCrypto, que el wallet de pruebas necesita (${message}). Prueba con un Chrome, Edge, Firefox o Safari recientes.`,
  },
};
const t = UI[document.documentElement.lang === "es" ? "es" : "en"];

interface Settings {
  name: string;
  disabled: FeatureName[];
  noV1: boolean;
  rpcUrl?: string;
}

/** Only addresses on the visitor's own machine: the page must never send transactions anywhere else. */
export function isLocalRpc(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function readSettings(): Settings {
  const params = new URLSearchParams(location.search);
  const name = (params.get("name") ?? "").trim().slice(0, 40) || DEFAULT_NAME;
  const disabled = (params.get("disable") ?? "")
    .split(",")
    .filter((value): value is FeatureName => OPTIONAL_FEATURES.some((item) => item.feature === value));
  const rpc = params.get("rpc");
  return { name, disabled, noV1: params.get("v1") === "off", rpcUrl: rpc && isLocalRpc(rpc) ? rpc : undefined };
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
    ...(settings.rpcUrl ? { mode: "rpc", rpcUrl: settings.rpcUrl, confirmTimeoutMs: 20_000 } : {}),
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
    if (settings.rpcUrl) parts.push(`mode: "rpc", rpcUrl: ${q(settings.rpcUrl)}`);
    return `{ ${parts.join(", ")} }`;
  }

  function specText(): string {
    const body = [
      ...(settings.rpcUrl ? [`// With @solana-e2e/playwright, the wallet and localnet fixtures do this setup and fund the accounts.`] : []),
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
      <h3>${t.specTitle}</h3>
      <div>
        <button type="button" data-spec="copy">${t.copy}</button>
        <button type="button" data-spec="restart" class="secondary">${t.restart}</button>
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
      button.textContent = t.copied;
    } catch {
      button.textContent = t.selectToCopy;
    }
    setTimeout(() => (button.textContent = t.copy), 1500);
  };
  specRoot.querySelector<HTMLButtonElement>("[data-spec=restart]")!.onclick = () => location.reload();

  // ------------------------------------------------------------------ the wallet itself
  try {
    ({ wallet } = await registerTestWallet(options));
  } catch (error) {
    panelRoot.innerHTML = `<p class="warn">${escapeHtml(t.noCrypto(error instanceof Error ? error.message : String(error)))}
      <a href="https://github.com/theghost1980/solana-e2e#readme">README</a></p>`;
    mountDapp(dappRoot, recorder, {});
    renderSpec();
    return;
  }
  const w = wallet;
  mountDapp(dappRoot, recorder, { rpcUrl: settings.rpcUrl });

  // ------------------------------------------------------------------ the panel
  panelRoot.innerHTML = `
    <div class="panel-head">
      <strong>${escapeHtml(w.info.name)}</strong>
      <span class="badge">${settings.rpcUrl ? t.modeRpc : t.modeMock}</span>
    </div>
    <dl class="panel-state" data-testid="wallet-state"></dl>

    ${
      settings.rpcUrl
        ? `<div class="panel-group">
            <button type="button" data-control="fund">${t.fund}</button>
            <p class="rpc-note" data-testid="rpc-status" role="status"></p>
          </div>`
        : ""
    }

    <div class="panel-group">
      <label>${t.nextFor}
        <select data-control="method">
          <option value="">${t.anyMethod}</option>
          ${METHODS.map((method) => `<option value="${method}">${method}</option>`).join("")}
        </select>
      </label>
      <div class="row">
        <button type="button" data-control="reject">${t.rejectNext}</button>
        <button type="button" data-control="fail">${t.failNext}</button>
      </div>
    </div>

    <div class="panel-group row">
      <button type="button" data-control="switch">${t.switchAccount}</button>
      <button type="button" data-control="disconnect">${t.disconnect}</button>
    </div>

    <div class="panel-group">
      <label class="check"><input type="checkbox" data-control="manual" /> ${t.manual}</label>
      <ul class="pending" data-testid="pending"></ul>
    </div>

    <details class="panel-group" ${settings.rpcUrl ? "open" : ""}>
      <summary>${t.options}</summary>
      <label>${t.walletName} <input data-option="name" maxlength="40" value="${escapeHtml(settings.name)}" /></label>
      ${OPTIONAL_FEATURES.map(
        ({ feature, label }) =>
          `<label class="check"><input type="checkbox" data-option="feature" value="${feature}" ${settings.disabled.includes(feature) ? "" : "checked"} /> ${label}</label>`,
      ).join("")}
      <label class="check"><input type="checkbox" data-option="v1" ${settings.noV1 ? "" : "checked"} /> ${t.v1}</label>
      <label>${t.network}
        <select data-option="network">
          <option value="mock" ${settings.rpcUrl ? "" : "selected"}>${t.netMock}</option>
          <option value="rpc" ${settings.rpcUrl ? "selected" : ""}>${t.netRpc}</option>
        </select>
      </label>
      <label>${t.rpcUrl} <input data-option="rpc" inputmode="url" value="${escapeHtml(settings.rpcUrl ?? DEFAULT_RPC)}" /></label>
      <p class="rpc-note">${t.rpcHelp}</p>
      <p class="rpc-note warn" data-testid="rpc-error" hidden>${t.rpcBadUrl}</p>
      <button type="button" data-option="apply" class="secondary">${t.apply}</button>
    </details>

    <h4>${t.log} <small>(<code>wallet.requests</code>)</small></h4>
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

  if (settings.rpcUrl) {
    const rpc = createSolanaRpc(settings.rpcUrl);
    const status = panelRoot.querySelector<HTMLElement>("[data-testid=rpc-status]")!;
    control("fund").onclick = async () => {
      status.textContent = t.funding;
      try {
        for (const account of w.accounts) {
          const sig = await rpc.requestAirdrop(address(account.address), lamports(1_000_000_000n)).send();
          for (let i = 0; i < 60; i++) {
            const { value } = await rpc.getSignatureStatuses([toSignature(sig)]).send();
            if (value[0]?.confirmationStatus === "confirmed" || value[0]?.confirmationStatus === "finalized") break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        const balances = await Promise.all(w.accounts.map(async (account) => (await rpc.getBalance(address(account.address)).send()).value));
        status.textContent = `${t.funded}: ${w.accounts.map((account, i) => `${account.label} ${Number(balances[i]) / 1e9} SOL`).join(" · ")}`;
      } catch (error) {
        console.error("[playground] airdrop failed", error);
        status.textContent = t.unreachable(settings.rpcUrl!);
      }
    };
  }

  panelRoot.querySelector<HTMLButtonElement>("[data-option=apply]")!.onclick = () => {
    const params = new URLSearchParams();
    const name = panelRoot.querySelector<HTMLInputElement>("[data-option=name]")!.value.trim();
    if (name && name !== DEFAULT_NAME) params.set("name", name);
    const disabled = [...panelRoot.querySelectorAll<HTMLInputElement>("[data-option=feature]")].filter((box) => !box.checked).map((box) => box.value);
    if (disabled.length) params.set("disable", disabled.join(","));
    if (!panelRoot.querySelector<HTMLInputElement>("[data-option=v1]")!.checked) params.set("v1", "off");
    if (panelRoot.querySelector<HTMLSelectElement>("[data-option=network]")!.value === "rpc") {
      const rpcUrl = panelRoot.querySelector<HTMLInputElement>("[data-option=rpc]")!.value.trim();
      if (!isLocalRpc(rpcUrl)) {
        panelRoot.querySelector<HTMLElement>("[data-testid=rpc-error]")!.hidden = false;
        return;
      }
      params.set("rpc", rpcUrl);
    }
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
      <dt>${t.connected}</dt><dd>${w.isConnected ? t.yes : t.no}</dd>
      <dt>${t.active}</dt><dd><strong>${escapeHtml(active.label ?? "")}</strong> <code title="${active.address}">${active.address.slice(0, 8)}…</code></dd>`;

    pendingEl.replaceChildren(
      ...w.pending.map((request) => {
        const item = document.createElement("li");
        item.innerHTML = `<span><code>${request.method}</code> ${t.waiting}</span>`;
        const approve = document.createElement("button");
        approve.type = "button";
        approve.textContent = t.approve;
        approve.onclick = () => {
          record(`await expect.poll(() => wallet.pending.length).toBeGreaterThan(0);`);
          w.approve();
          record(`wallet.approve();`);
        };
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "secondary";
        reject.textContent = t.reject;
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
    if (!w.requests.length) logEl.innerHTML = `<tr><td colspan="4" class="muted">${t.noRequests}</td></tr>`;
    renderSpec();
  }

  renderPanel();
  setInterval(renderPanel, 150);
}
