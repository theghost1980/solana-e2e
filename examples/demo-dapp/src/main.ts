/**
 * A deliberately small Wallet Standard dApp: list wallets, connect, sign a message, sign in,
 * send a memo, transfer SOL. Plain DOM so the example has no framework to learn.
 */
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  getTransactionEncoder,
  lamports,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const params = new URLSearchParams(location.search);
const RPC_URL = params.get("rpc") ?? import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8899";
const CHAIN = (params.get("chain") ?? "solana:localnet") as `${string}:${string}`;
const rpc = createSolanaRpc(RPC_URL);
const base58 = getBase58Decoder();

let wallet: Wallet | undefined;
let account: WalletAccount | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const feature = <T>(name: `${string}:${string}`) => wallet?.features[name] as T | undefined;

function setStatus(text: string, kind: "ok" | "error" | "info" = "info") {
  const status = $("status");
  status.textContent = text;
  status.dataset.kind = kind;
}

function render() {
  const list = $("wallets");
  list.replaceChildren(
    ...getWallets()
      .get()
      .filter((candidate) => candidate.chains.some((chain) => chain.startsWith("solana:")))
      .map((candidate) => {
        const button = document.createElement("button");
        button.textContent = candidate.name;
        button.onclick = () => connect(candidate);
        return button;
      }),
  );
  $("account").textContent = account ? account.address : "Not connected";
  for (const id of ["sign-message", "sign-in", "send-memo", "transfer", "disconnect"]) {
    $<HTMLButtonElement>(id).disabled = !wallet || (!account && id !== "sign-in");
  }
}

function errorText(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: number; message?: string };
  return code === 4001 ? "Request rejected by the user" : `Error: ${message ?? String(error)}`;
}

async function connect(candidate: Wallet) {
  wallet = candidate;
  try {
    const result = await feature<{ connect: () => Promise<{ accounts: readonly WalletAccount[] }> }>("standard:connect")!.connect();
    account = result.accounts[0];
    feature<{ on: (event: "change", listener: (p: { accounts?: readonly WalletAccount[] }) => void) => () => void }>(
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

async function buildTransaction(instruction: Parameters<typeof appendTransactionMessageInstruction>[0]) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(account!.address as Address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message as never)));
}

async function signAndSend(transaction: Uint8Array) {
  type SignAndSend = { signAndSendTransaction: (input: object) => Promise<readonly { signature: Uint8Array }[]> };
  const [output] = await feature<SignAndSend>("solana:signAndSendTransaction")!.signAndSendTransaction({
    account,
    chain: CHAIN,
    transaction,
  });
  return base58.decode(output!.signature);
}

$("sign-message").onclick = async () => {
  try {
    type SignMessage = { signMessage: (input: object) => Promise<readonly { signature: Uint8Array }[]> };
    const [output] = await feature<SignMessage>("solana:signMessage")!.signMessage({
      account,
      message: new TextEncoder().encode("Hello from the demo dApp"),
    });
    setStatus(`Message signed: ${base58.decode(output!.signature)}`, "ok");
  } catch (error) {
    setStatus(errorText(error), "error");
  }
};

$("sign-in").onclick = async () => {
  try {
    type SignIn = { signIn: (input: object) => Promise<readonly { account: WalletAccount }[]> };
    const [output] = await feature<SignIn>("solana:signIn")!.signIn({ statement: "Sign in to the demo dApp", nonce: "demo1234" });
    account = output!.account;
    setStatus(`Signed in as ${output!.account.address}`, "ok");
  } catch (error) {
    setStatus(errorText(error), "error");
  }
  render();
};

$("send-memo").onclick = async () => {
  try {
    const text = $<HTMLInputElement>("memo").value || "gm";
    const transaction = await buildTransaction({
      programAddress: MEMO_PROGRAM,
      accounts: [{ address: account!.address as Address, role: 3 }],
      data: new TextEncoder().encode(text),
    });
    const signature = await signAndSend(transaction);
    setStatus(`Memo sent: ${signature}`, "ok");
    $("last-signature").textContent = signature;
  } catch (error) {
    setStatus(errorText(error), "error");
  }
};

$("transfer").onclick = async () => {
  try {
    const to = address($<HTMLInputElement>("recipient").value.trim());
    const amount = lamports(BigInt($<HTMLInputElement>("lamports").value || "0"));
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true); // SystemInstruction::Transfer
    view.setBigUint64(4, amount, true);
    const transaction = await buildTransaction({
      programAddress: SYSTEM_PROGRAM,
      accounts: [
        { address: account!.address as Address, role: 3 },
        { address: to, role: 1 },
      ],
      data,
    });
    const signature = await signAndSend(transaction);
    setStatus(`Transfer sent: ${signature}`, "ok");
    $("last-signature").textContent = signature;
  } catch (error) {
    setStatus(errorText(error), "error");
  }
};

$("disconnect").onclick = async () => {
  await feature<{ disconnect: () => Promise<void> }>("standard:disconnect")?.disconnect();
  account = undefined;
  setStatus("Disconnected");
  render();
};

getWallets().on("register", render);
getWallets().on("unregister", render);
render();
