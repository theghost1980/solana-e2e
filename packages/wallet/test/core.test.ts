import {
  getPublicKeyFromAddress,
  getTransactionDecoder,
  signature as toSignature,
  verifySignature,
  type Address,
  type SignatureBytes,
} from "@solana/kit";
import { verifySignIn } from "@solana/wallet-standard-util";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ErrorCode, TestWallet, type BridgeResponse } from "../src/index.js";
import { memoTransaction } from "./helpers.js";

const ok = (response: BridgeResponse) => {
  if (!response.ok) throw new Error(`expected ok, got ${response.error.message}`);
  return response.value as Record<string, number[]>;
};
const connect = async (wallet: TestWallet) => ok(await wallet.handle("connect", {}));
const verify = async (addr: string, sig: number[], message: Uint8Array) =>
  verifySignature(await getPublicKeyFromAddress(addr as Address), Uint8Array.from(sig) as SignatureBytes, message);

describe("accounts", () => {
  test("seed names give stable addresses", async () => {
    const a = await TestWallet.create({ accounts: ["alice", "bob"] });
    const b = await TestWallet.create({ accounts: ["alice"] });
    expect(a.accounts[0]!.address).toBe(b.address);
    expect(a.accounts[1]!.address).not.toBe(a.address);
    expect(a.accounts[0]!.label).toBe("alice");
  });

  test("a 32-byte secret key gives a usable account; a count gives random ones", async () => {
    const wallet = await TestWallet.create({ accounts: [{ secretKey: new Uint8Array(32).fill(7) }] });
    const again = await TestWallet.create({ accounts: [{ secretKey: new Uint8Array(32).fill(7) }] });
    expect(wallet.address).toBe(again.address);
    expect((await TestWallet.create({ accounts: 3 })).accounts).toHaveLength(3);
    await expect(TestWallet.create({ accounts: [{ secretKey: new Uint8Array(5) }] })).rejects.toThrow(/32 or 64/);
  });

  test("the dApp sees no account before connect", async () => {
    const wallet = await TestWallet.create();
    expect(wallet.visibleAccounts()).toEqual([]);
    const response = await wallet.handle("connect", {});
    expect(response.accounts.map((a) => a.address)).toEqual([wallet.address]);
    expect(response.accounts[0]!.publicKey).toHaveLength(32);
  });
});

describe("signing", () => {
  test("signMessage produces a valid ed25519 signature", async () => {
    const wallet = await TestWallet.create();
    await connect(wallet);
    const message = new TextEncoder().encode("hi there");
    const value = ok(await wallet.handle("signMessage", { address: wallet.address, message: [...message] }));
    expect(await verify(wallet.address, value.signature!, message)).toBe(true);
    expect(wallet.requests.at(-1)).toMatchObject({ method: "signMessage", outcome: "approved", message: "hi there" });
  });

  test.each(["legacy", 0, 1] as const)("signTransaction signs version %s", async (version) => {
    const wallet = await TestWallet.create({ supportedTransactionVersions: ["legacy", 0, 1] });
    await connect(wallet);
    const wire = memoTransaction(wallet.address, version);
    const value = ok(await wallet.handle("signTransaction", { address: wallet.address, transaction: [...wire] }));
    const signed = getTransactionDecoder().decode(Uint8Array.from(value.signedTransaction!));
    const sig = signed.signatures[wallet.address]!;
    expect(await verifySignature(await getPublicKeyFromAddress(wallet.address), sig, signed.messageBytes)).toBe(true);
  });

  test("signAndSendTransaction in mock mode returns the fee payer signature and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const wallet = await TestWallet.create();
    await connect(wallet);
    const wire = memoTransaction(wallet.address);
    const value = ok(
      await wallet.handle("signAndSendTransaction", { address: wallet.address, transaction: [...wire], chain: "solana:devnet" }),
    );
    expect(value.signature).toHaveLength(64);
    expect(fetchSpy).not.toHaveBeenCalled();
    const logged = wallet.requests.at(-1)!;
    expect(logged.signature).toBe(toSignature(logged.signature!));
    expect(logged.chain).toBe("solana:devnet");
    fetchSpy.mockRestore();
  });

  test("a version outside supportedTransactionVersions is rejected", async () => {
    const wallet = await TestWallet.create({ supportedTransactionVersions: ["legacy", 0] });
    await connect(wallet);
    for (const method of ["signTransaction", "signAndSendTransaction"]) {
      const response = await wallet.handle(method, { address: wallet.address, transaction: [...memoTransaction(wallet.address, 1)] });
      expect(response).toMatchObject({ ok: false, error: { code: ErrorCode.UNSUPPORTED_VERSION } });
      expect(wallet.requests.at(-1)).toMatchObject({ method, outcome: "rejected" });
    }
    expect((await wallet.handle("signTransaction", { address: wallet.address, transaction: [...memoTransaction(wallet.address, 0)] })).ok).toBe(true);
  });

  test("signAndSendTransaction returns the wallet's own signature when it is the fee payer", async () => {
    const other = await TestWallet.create({ accounts: ["other"] });
    const wallet = await TestWallet.create({ accounts: ["me"] });
    await connect(wallet);
    // `other` already signed: the wallet completes the transaction and returns its own signature.
    const wire = memoTransaction(wallet.address, 0, "hello", [other.address]);
    const partial = getTransactionDecoder().decode(wire);
    const { partiallySignTransaction, getTransactionEncoder } = await import("@solana/kit");
    const { keyPair } = (await other.signer()) as unknown as { keyPair: CryptoKeyPair };
    const preSigned = await partiallySignTransaction([keyPair], partial);
    const value = ok(
      await wallet.handle("signAndSendTransaction", { address: wallet.address, transaction: [...getTransactionEncoder().encode(preSigned)] }),
    );
    expect(await verify(wallet.address, value.signature!, Uint8Array.from(partial.messageBytes))).toBe(true);
  });

  test("signAndSendTransaction refuses when the wallet is not the fee payer or signers are missing", async () => {
    const other = await TestWallet.create({ accounts: ["other"] });
    const wallet = await TestWallet.create({ accounts: ["me"] });
    await connect(wallet);
    const send = (wire: Uint8Array) => wallet.handle("signAndSendTransaction", { address: wallet.address, transaction: [...wire] });

    const notPayer = await send(memoTransaction(other.address, 0, "hello", [wallet.address]));
    expect(notPayer).toMatchObject({ ok: false, error: { message: expect.stringContaining("not the fee payer") } });

    const missing = await send(memoTransaction(wallet.address, 0, "hello", [other.address]));
    expect(missing).toMatchObject({ ok: false, error: { message: expect.stringContaining(`needs other signers: ${other.address}`) } });

    const stranger = await send(memoTransaction(other.address));
    expect(stranger).toMatchObject({ ok: false, error: { message: expect.stringContaining("is not a signer") } });
    expect(wallet.requests.slice(-3).map((r) => r.outcome)).toEqual(["failed", "failed", "failed"]);
  });

  test("signing before connect is unauthorized", async () => {
    const wallet = await TestWallet.create();
    const response = await wallet.handle("signMessage", { address: wallet.address, message: [1] });
    expect(response).toMatchObject({ ok: false, error: { code: ErrorCode.UNAUTHORIZED } });
  });

  test("signIn follows SIWS and verifies with @solana/wallet-standard-util", async () => {
    const wallet = await TestWallet.create();
    const input = {
      domain: "example.test",
      statement: "Sign in to the demo",
      nonce: "abc12345",
      issuedAt: "2026-11-17T00:00:00.000Z",
    };
    const response = await wallet.handle("signIn", { input, domain: "ignored.test" });
    const value = ok(response) as unknown as { address: string; signedMessage: number[]; signature: number[] };
    expect(wallet.isConnected).toBe(true);
    const account = { address: value.address, publicKey: Uint8Array.from(response.accounts[0]!.publicKey), chains: [], features: [] };
    const output = { account, signedMessage: Uint8Array.from(value.signedMessage), signature: Uint8Array.from(value.signature) };
    expect(verifySignIn({ ...input, address: value.address }, output as never)).toBe(true);
    expect(new TextDecoder().decode(output.signedMessage)).toContain("example.test wants you to sign in");
  });
});

describe("controls", () => {
  test("rejectNext rejects once, with a method filter", async () => {
    const wallet = await TestWallet.create();
    await connect(wallet);
    wallet.rejectNext({ method: "signMessage" });
    const first = await wallet.handle("signMessage", { address: wallet.address, message: [1] });
    expect(first).toMatchObject({ ok: false, error: { code: 4001, message: "User rejected the request." } });
    const second = await wallet.handle("signMessage", { address: wallet.address, message: [1] });
    expect(second.ok).toBe(true);
    expect(wallet.requests.map((r) => r.outcome)).toEqual(["approved", "rejected", "approved"]);
  });

  test("a rejected connect leaves the wallet disconnected", async () => {
    const wallet = await TestWallet.create();
    wallet.rejectNext();
    const response = await wallet.handle("connect", {});
    expect(response).toMatchObject({ ok: false, accounts: [] });
    expect(wallet.isConnected).toBe(false);
  });

  test("an explicit connect while connected still honours rejectNext and emits no change", async () => {
    const wallet = await TestWallet.create();
    await connect(wallet);
    const changes: number[] = [];
    wallet.onChange((accounts) => changes.push(accounts.length));
    wallet.rejectNext({ method: "connect" });
    expect(await wallet.handle("connect", {})).toMatchObject({ ok: false, error: { code: 4001 } });
    expect(wallet.isConnected).toBe(true);
    expect((await wallet.handle("connect", {})).ok).toBe(true);
    expect(changes).toEqual([]);
  });

  test("waitForRequest: past and future requests, outcome filter, timeout", async () => {
    const wallet = await TestWallet.create();
    await connect(wallet);
    expect(await wallet.waitForRequest("connect")).toMatchObject({ outcome: "approved" });

    const rejected = wallet.waitForRequest("signMessage", { outcome: "rejected", timeoutMs: 1_000 });
    await wallet.handle("signMessage", { address: wallet.address, message: [1] });
    wallet.rejectNext();
    await wallet.handle("signMessage", { address: wallet.address, message: [2] });
    expect(await rejected).toMatchObject({ method: "signMessage", outcome: "rejected" });

    const byPredicate = wallet.waitForRequest((r) => r.message === "late", { timeoutMs: 1_000 });
    setTimeout(() => void wallet.handle("signMessage", { address: wallet.address, message: [...new TextEncoder().encode("late")] }), 20);
    expect(await byPredicate).toMatchObject({ outcome: "approved", message: "late" });

    await expect(wallet.waitForRequest("signIn", { timeoutMs: 50 })).rejects.toThrow(/no signIn request within 50 ms/);
  });

  test("failNext uses the given code and message", async () => {
    const wallet = await TestWallet.create();
    wallet.failNext({ message: "Ledger disconnected", code: -32000 });
    expect(await wallet.handle("connect", {})).toMatchObject({ ok: false, error: { code: -32000, message: "Ledger disconnected" } });
  });

  test("manual approval waits for approve() / reject()", async () => {
    const wallet = await TestWallet.create({ approval: "manual" });
    const connecting = wallet.handle("connect", {});
    const pending = await wallet.waitForRequest("connect", { outcome: "pending" });
    expect(wallet.pending).toHaveLength(1);
    expect(pending.outcome).toBe("pending");
    wallet.approve();
    expect((await connecting).ok).toBe(true);

    const signing = wallet.handle("signMessage", { address: wallet.address, message: [1] });
    await wallet.waitForRequest("signMessage", { outcome: "pending" });
    wallet.reject("Not now");
    expect(await signing).toMatchObject({ ok: false, error: { code: 4001, message: "Not now" } });
  });

  test("switchAccount and disconnect emit changes", async () => {
    const wallet = await TestWallet.create({ accounts: ["alice", "bob"] });
    const seen: string[][] = [];
    wallet.onChange((accounts) => seen.push(accounts.map((a) => a.address)));
    await connect(wallet);
    wallet.switchAccount(1);
    wallet.disconnect();
    expect(seen).toEqual([[wallet.accounts[0]!.address], [wallet.accounts[1]!.address], []]);
  });

  test("silent connect returns nothing until the site is trusted", async () => {
    const wallet = await TestWallet.create();
    expect((await wallet.handle("connect", { silent: true })).accounts).toEqual([]);
    wallet.setTrusted(true);
    expect((await wallet.handle("connect", { silent: true })).accounts).toHaveLength(1);
  });

  test("reset forgets connection, directives and log", async () => {
    const wallet = await TestWallet.create({ accounts: 2 });
    await connect(wallet);
    wallet.switchAccount(1).rejectNext();
    wallet.reset();
    expect(wallet.isConnected).toBe(false);
    expect(wallet.requests).toEqual([]);
    expect(wallet.address).toBe(wallet.accounts[0]!.address);
    expect((await wallet.handle("connect", {})).ok).toBe(true);
  });

  test("disabledFeatures are not announced", async () => {
    const wallet = await TestWallet.create({ disabledFeatures: ["solana:signIn", "solana:signAndSendTransaction"] });
    expect(wallet.info.features).not.toContain("solana:signIn");
    expect(wallet.info.features).toContain("solana:signTransaction");
  });
});

describe("rpc mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  const rpcStub = (statuses: unknown[]) => {
    const calls: { method: string; params: unknown[] }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      const result =
        body.method === "sendTransaction" ? "sig" : { context: { slot: 1 }, value: [statuses.length > 1 ? statuses.shift() : statuses[0]] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
    });
    return calls;
  };

  test("refuses a mainnet URL unless allowed", async () => {
    await expect(TestWallet.create({ mode: "rpc", rpcUrl: "https://api.mainnet-beta.solana.com" })).rejects.toThrow(/mainnet/);
    await expect(TestWallet.create({ mode: "rpc" })).rejects.toThrow(/rpcUrl/);
    await expect(
      TestWallet.create({ mode: "rpc", rpcUrl: "https://api.mainnet-beta.solana.com", allowMainnet: true }),
    ).resolves.toBeInstanceOf(TestWallet);
  });

  test("sends the signed transaction and waits for the commitment", async () => {
    const calls = rpcStub([null, { confirmationStatus: "confirmed", err: null, slot: 1, confirmations: 0 }]);
    const wallet = await TestWallet.create({ mode: "rpc", rpcUrl: "http://127.0.0.1:8899" });
    await connect(wallet);
    const response = await wallet.handle("signAndSendTransaction", {
      address: wallet.address,
      transaction: [...memoTransaction(wallet.address)],
      chain: "solana:localnet",
    });
    expect(response.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["sendTransaction", "getSignatureStatuses", "getSignatureStatuses"]);
    expect(calls[0]!.params[1]).toMatchObject({ encoding: "base64", preflightCommitment: "confirmed" });
  });

  test("a failed transaction is reported as failed in the log", async () => {
    rpcStub([{ confirmationStatus: "processed", err: { InstructionError: [0, "Custom"] }, slot: 1, confirmations: 0 }]);
    const wallet = await TestWallet.create({ mode: "rpc", rpcUrl: "http://127.0.0.1:8899" });
    await connect(wallet);
    const response = await wallet.handle("signAndSendTransaction", {
      address: wallet.address,
      transaction: [...memoTransaction(wallet.address)],
      chain: "solana:localnet",
    });
    expect(response).toMatchObject({ ok: false, error: { code: ErrorCode.TRANSACTION_FAILED } });
    expect(wallet.requests.at(-1)).toMatchObject({ outcome: "failed" });
  });
});
