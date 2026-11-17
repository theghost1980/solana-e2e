/** How the wallet handles `solana:signAndSendTransaction`. */
export type WalletMode =
  /** Sign locally and never touch the network. The signature is real; nothing is sent. */
  | "mock"
  /** Sign and send to `rpcUrl` (Surfpool, a local validator…), then wait for `commitment`. */
  | "rpc";

export type Commitment = "processed" | "confirmed" | "finalized";

export type TransactionVersion = "legacy" | 0 | 1;

/** Every Wallet Standard feature the test wallet can announce. */
export type FeatureName =
  | "standard:connect"
  | "standard:disconnect"
  | "standard:events"
  | "solana:signMessage"
  | "solana:signTransaction"
  | "solana:signAndSendTransaction"
  | "solana:signIn";

/** Methods a dApp can call, as they appear in the request log. */
export type WalletMethod =
  | "connect"
  | "disconnect"
  | "signMessage"
  | "signTransaction"
  | "signAndSendTransaction"
  | "signIn";

/**
 * An account the wallet holds.
 * - a string is a seed name: `"alice"` always gives the same address.
 * - `secretKey` takes 32 bytes (private key) or 64 bytes (Solana CLI keypair format).
 */
export type AccountInput =
  | string
  | {
      seed?: string;
      secretKey?: Uint8Array | readonly number[];
      label?: string;
    };

export type ApprovalMode =
  /** Every request is approved at once, unless a `rejectNext` / `failNext` directive matches it. */
  | "auto"
  /** Requests wait in `pending` until the test calls `approve()` or `reject()`. */
  | "manual";

export interface TestWalletOptions {
  /** Defaults to `"mock"`. */
  mode?: WalletMode;
  /** Required in `"rpc"` mode. */
  rpcUrl?: string;
  /** Commitment `signAndSendTransaction` waits for in `"rpc"` mode. Defaults to `"confirmed"`. */
  commitment?: Commitment;
  /** Defaults to 30 000 ms. */
  confirmTimeoutMs?: number;
  /** `"rpc"` mode refuses an `rpcUrl` containing "mainnet" unless this is true. */
  allowMainnet?: boolean;
  /** A number of random accounts, or a list. Defaults to one random account. */
  accounts?: number | readonly AccountInput[];
  /** Defaults to `"Solana E2E Test Wallet"`. */
  name?: string;
  /** A `data:image/...` URL. */
  icon?: `data:image/${"svg+xml" | "webp" | "png" | "gif"};base64,${string}`;
  /** Defaults to mainnet, devnet, testnet and localnet so any dApp lists the wallet. */
  chains?: readonly `${string}:${string}`[];
  /** Features to leave out, to test how the dApp handles a less capable wallet. */
  disabledFeatures?: readonly FeatureName[];
  /** Defaults to `["legacy", 0, 1]`. Drop `1` to test a wallet without transaction version 1. */
  supportedTransactionVersions?: readonly TransactionVersion[];
  /** Defaults to `"auto"`. */
  approval?: ApprovalMode;
  /**
   * Whether the site is already trusted. A trusted wallet answers a silent connect (`autoConnect`)
   * with its account; an untrusted one answers with no accounts, as real wallets do.
   * Defaults to `false`.
   */
  trusted?: boolean;
}

export type RequestOutcome = "approved" | "rejected" | "failed" | "pending";

export interface WalletRequest {
  id: number;
  method: WalletMethod;
  /** Address of the account the request is for, when it names one. */
  address?: string;
  /** Chain the dApp passed, if any. */
  chain?: string;
  outcome: RequestOutcome;
  /** Base58 transaction signature, for signAndSendTransaction / signTransaction. */
  signature?: string;
  /** UTF-8 text of a signed message or sign-in, when it decodes. */
  message?: string;
  error?: { code: number; message: string };
  at: number;
}

/** What a dApp sees of an account, in a form that can cross into a browser page. */
export interface SerializedAccount {
  address: string;
  publicKey: number[];
  label?: string;
}
