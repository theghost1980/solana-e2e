/**
 * A tiny Wallet Standard dApp that lives inside the page. It finds wallets with getWallets(), exactly
 * like a real dApp, and never touches a network: transactions use a fixed blockhash, and the test
 * wallet runs in mock mode, so it signs but does not send.
 */
import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

export interface Recorder {
  /** The user clicked a button in the dApp. */
  click(label: string): void;
  /** The dApp showed this status after the action settled. */
  status(text: string): void;
}

const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const CHAIN = "solana:devnet" as const;
const LIFETIME = { blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"), lastValidBlockHeight: 100n };
const base58 = getBase58Decoder();

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-6)}`;

export function mountDapp(root: HTMLElement, recorder: Recorder): void {
  root.innerHTML = `
    <div class="dapp-bar">
      <strong>Demo dApp</strong>
      <span class="dapp-account" data-testid="dapp-account">Not connected</span>
    </div>
    <p class="dapp-label">Wallets found with <code>getWallets()</code>:</p>
    <div class="dapp-wallets" data-testid="dapp-wallets"></div>
    <div class="dapp-actions">
      <button type="button" data-action="sign-message">Sign message</button>
      <button type="button" data-action="sign-in">Sign in</button>
      <button type="button" data-action="send-memo">Send memo</button>
      <button type="button" data-action="disconnect">Disconnect</button>
    </div>
    <p role="status" class="dapp-status" data-kind="info">Pick a wallet to connect.</p>`;

  let wallet: Wallet | undefined;
  let account: WalletAccount | undefined;
  let stopEvents: (() => void) | undefined;

  const statusEl = root.querySelector<HTMLElement>(".dapp-status")!;
  const feature = <T>(name: `${string}:${string}`) => wallet?.features[name] as T | undefined;

  const setStatus = (text: string, kind: "ok" | "error" | "info", record = true) => {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
    if (record) recorder.status(text);
  };
  const errorText = (error: unknown) => {
    const { code, message } = (error ?? {}) as { code?: number; message?: string };
    return code === 4001 ? "Request rejected by the user" : `Error: ${message ?? String(error)}`;
  };

  const render = () => {
    const list = root.querySelector<HTMLElement>(".dapp-wallets")!;
    const wallets = getWallets()
      .get()
      .filter((candidate) => candidate.chains.some((chain) => chain.startsWith("solana:")));
    list.replaceChildren(
      ...wallets.map((candidate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dapp-wallet";
        const icon = document.createElement("img");
        icon.src = candidate.icon;
        icon.alt = "";
        icon.width = 20;
        icon.height = 20;
        button.append(icon, document.createTextNode(candidate.name));
        button.onclick = () => connect(candidate);
        return button;
      }),
    );
    if (!wallets.length) list.textContent = "No wallet found.";
    root.querySelector(".dapp-account")!.textContent = account ? short(account.address) : "Not connected";
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      const needsAccount = button.dataset.action !== "sign-in";
      button.disabled = !wallet || (needsAccount && !account);
    }
  };

  async function connect(candidate: Wallet) {
    recorder.click(candidate.name);
    wallet = candidate;
    stopEvents?.();
    try {
      const result = await feature<{ connect: () => Promise<{ accounts: readonly WalletAccount[] }> }>("standard:connect")!.connect();
      account = result.accounts[0];
      stopEvents = feature<{ on: (event: "change", listener: (p: { accounts?: readonly WalletAccount[] }) => void) => () => void }>(
        "standard:events",
      )?.on("change", ({ accounts }) => {
        if (accounts) account = accounts[0];
        render();
      });
      setStatus(`Connected to ${candidate.name}`, "ok");
    } catch (error) {
      setStatus(errorText(error), "error");
    }
    render();
  }

  const actions: Record<string, { label: string; run: () => Promise<string> }> = {
    "sign-message": {
      label: "Sign message",
      async run() {
        type SignMessage = { signMessage: (input: object) => Promise<readonly { signature: Uint8Array }[]> };
        const [output] = await feature<SignMessage>("solana:signMessage")!.signMessage({
          account,
          message: new TextEncoder().encode("Hello from the playground"),
        });
        return `Message signed: ${short(base58.decode(output!.signature))}`;
      },
    },
    "sign-in": {
      label: "Sign in",
      async run() {
        type SignIn = { signIn: (input: object) => Promise<readonly { account: WalletAccount }[]> };
        const signIn = feature<SignIn>("solana:signIn");
        if (!signIn) throw new Error("this wallet does not support Sign In With Solana");
        const [output] = await signIn.signIn({ statement: "Sign in to the playground", nonce: "play1234" });
        account = output!.account;
        return `Signed in as ${short(output!.account.address)}`;
      },
    },
    "send-memo": {
      label: "Send memo",
      async run() {
        const message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayer(account!.address as Address, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
          (m) =>
            appendTransactionMessageInstruction(
              { programAddress: MEMO_PROGRAM, accounts: [{ address: account!.address as Address, role: 3 }], data: new TextEncoder().encode("gm") },
              m,
            ),
        );
        const transaction = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message as never)));
        type SignAndSend = { signAndSendTransaction: (input: object) => Promise<readonly { signature: Uint8Array }[]> };
        const signAndSend = feature<SignAndSend>("solana:signAndSendTransaction");
        if (!signAndSend) throw new Error("this wallet cannot sign and send transactions");
        const [output] = await signAndSend.signAndSendTransaction({ account, chain: CHAIN, transaction });
        return `Memo signed (mock mode, not sent): ${short(base58.decode(output!.signature))}`;
      },
    },
    disconnect: {
      label: "Disconnect",
      async run() {
        await feature<{ disconnect: () => Promise<void> }>("standard:disconnect")?.disconnect();
        account = undefined;
        return "Disconnected";
      },
    },
  };

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-action]")) {
    const action = actions[button.dataset.action!]!;
    button.onclick = async () => {
      recorder.click(action.label);
      setStatus("Waiting for the wallet…", "info", false);
      try {
        setStatus(await action.run(), "ok");
      } catch (error) {
        setStatus(errorText(error), "error");
      }
      render();
    };
  }

  getWallets().on("register", render);
  getWallets().on("unregister", render);
  render();
}
