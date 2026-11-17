import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address as toAddress,
  createSolanaRpc,
  lamports,
  signature as toSignature,
  type Address,
  type Commitment,
  type Signature,
} from "@solana/kit";

export interface LocalnetOptions {
  /**
   * Use a chain that is already running (a CI service, `solana-test-validator`, your own Surfpool).
   * When set, nothing is started or stopped.
   */
  rpcUrl?: string;
  /** WebSocket URL of an existing chain. Defaults to `rpcUrl` with port + 1. */
  wsUrl?: string;
  /** Surfpool binary. Defaults to `$SURFPOOL_BIN`, then `surfpool` on the PATH. */
  surfpoolBin?: string;
  /** RPC port. Defaults to a free port. */
  port?: number;
  /** Fork accounts from a public cluster instead of running offline. Defaults to offline. */
  network?: "mainnet" | "devnet" | "testnet";
  /** Extra arguments for `surfpool start`. */
  args?: readonly string[];
  /** Defaults to 30 000 ms. */
  startupTimeoutMs?: number;
}

export interface TransactionSummary {
  signature: Signature;
  slot: bigint;
  /** `null` when the transaction succeeded. */
  err: unknown;
  logs: readonly string[];
  accountKeys: readonly Address[];
  /** Lamport balance change per account key, post minus pre. */
  balanceChanges: Readonly<Record<string, bigint>>;
}

export interface Localnet {
  rpcUrl: string;
  wsUrl: string;
  rpc: ReturnType<typeof createSolanaRpc>;
  /** Airdrop lamports and wait until the airdrop is confirmed. */
  fund(address: string, amount: bigint | number): Promise<void>;
  getBalance(address: string): Promise<bigint>;
  /** Wait for a signature to reach `commitment`. Throws if the transaction failed. */
  waitForSignature(signature: string, options?: { commitment?: Commitment; timeoutMs?: number }): Promise<void>;
  /** Fetch a landed transaction with its logs and balance changes. */
  getTransaction(signature: string): Promise<TransactionSummary>;
  stop(): Promise<void>;
}

const RANK: Record<Commitment, number> = { processed: 0, confirmed: 1, finalized: 2 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

function createClient(rpcUrl: string, wsUrl: string, stop: () => Promise<void>): Localnet {
  const rpc = createSolanaRpc(rpcUrl);

  const waitForSignature: Localnet["waitForSignature"] = async (sig, { commitment = "confirmed", timeoutMs = 30_000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value } = await rpc.getSignatureStatuses([toSignature(sig)]).send();
      const status = value[0];
      if (status?.err) throw new Error(`[solana-e2e] ${sig} failed: ${JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? `${v}` : v))}`);
      if (status?.confirmationStatus && RANK[status.confirmationStatus] >= RANK[commitment]) return;
      await sleep(200);
    }
    throw new Error(`[solana-e2e] ${sig} not ${commitment} within ${timeoutMs} ms`);
  };

  return {
    rpcUrl,
    wsUrl,
    rpc,
    stop,
    waitForSignature,
    async fund(addr, amount) {
      const sig = await rpc.requestAirdrop(toAddress(addr), lamports(BigInt(amount))).send();
      await waitForSignature(sig);
    },
    async getBalance(addr) {
      const { value } = await rpc.getBalance(toAddress(addr), { commitment: "confirmed" }).send();
      return value;
    },
    async getTransaction(sig) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const tx = await rpc
          .getTransaction(toSignature(sig), { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 })
          .send();
        if (tx) {
          const keys = tx.transaction.message.accountKeys as readonly Address[];
          const changes: Record<string, bigint> = {};
          keys.forEach((key, index) => {
            changes[key] = BigInt(tx.meta?.postBalances[index] ?? 0) - BigInt(tx.meta?.preBalances[index] ?? 0);
          });
          return {
            signature: toSignature(sig),
            slot: tx.slot,
            err: tx.meta?.err ?? null,
            logs: tx.meta?.logMessages ?? [],
            accountKeys: keys,
            balanceChanges: changes,
          };
        }
        if (Date.now() > deadline) throw new Error(`[solana-e2e] transaction ${sig} not found`);
        await sleep(200);
      }
    },
  };
}

async function waitForHealth(rpcUrl: string, child: ChildProcess, output: () => string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`[solana-e2e] surfpool exited with code ${child.exitCode}\n${output()}`);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      if (response.ok && (await response.json()).result === "ok") return;
    } catch {
      // not listening yet
    }
    await sleep(200);
  }
  throw new Error(`[solana-e2e] surfpool did not answer on ${rpcUrl} within ${timeoutMs} ms\n${output()}`);
}

/**
 * Start a fresh Surfpool chain (offline by default) on free ports, or wrap an existing RPC.
 * Call `stop()` when done; it kills the process and removes its working directory.
 */
export async function startLocalnet(options: LocalnetOptions = {}): Promise<Localnet> {
  if (options.rpcUrl) {
    const wsUrl = options.wsUrl ?? options.rpcUrl.replace(/^http/, "ws").replace(/:(\d+)(\/|$)/, (_m, port: string, end: string) => `:${Number(port) + 1}${end}`);
    return createClient(options.rpcUrl, wsUrl, async () => {});
  }

  const bin = options.surfpoolBin ?? process.env.SURFPOOL_BIN ?? "surfpool";
  const port = options.port ?? (await freePort());
  const wsPort = await freePort();
  const cwd = await mkdtemp(join(tmpdir(), "solana-e2e-surfpool-"));
  const args = [
    "start",
    "--ci",
    "--no-deploy",
    "--port",
    String(port),
    "--ws-port",
    String(wsPort),
    ...(options.network ? ["--network", options.network] : ["--offline"]),
    ...(options.args ?? []),
  ];

  let output = "";
  const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const spawnError = new Promise<never>((_resolve, reject) =>
    child.once("error", (error) =>
      reject(
        new Error(
          `[solana-e2e] could not start "${bin}": ${error.message}. Install Surfpool (https://docs.surfpool.run) or set SURFPOOL_BIN, or pass rpcUrl to use a running chain.`,
        ),
      ),
    ),
  );
  child.stdout?.on("data", (chunk) => (output = (output + chunk).slice(-4000)));
  child.stderr?.on("data", (chunk) => (output = (output + chunk).slice(-4000)));

  const rpcUrl = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, sleep(5_000)]);
    }
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  };

  try {
    await Promise.race([waitForHealth(rpcUrl, child, () => output, options.startupTimeoutMs ?? 30_000), spawnError]);
  } catch (error) {
    await stop();
    throw error;
  }
  return createClient(rpcUrl, `ws://127.0.0.1:${wsPort}`, stop);
}
