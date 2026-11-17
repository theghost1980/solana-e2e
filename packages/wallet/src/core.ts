import {
  createKeyPairFromBytes,
  createKeyPairFromPrivateKeyBytes,
  createSignerFromKeyPair,
  createSolanaRpc,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
  type Address,
  type KeyPairSigner,
  type Signature,
  type Transaction,
} from "@solana/kit";
import type { SolanaSignInInput } from "@solana/wallet-standard-features";
import { ErrorCode, TestWalletError, unauthorized, userRejected } from "./errors.js";
import { createSignInMessageText } from "./siws.js";
import type {
  AccountInput,
  ApprovalMode,
  Commitment,
  FeatureName,
  SerializedAccount,
  TestWalletOptions,
  TransactionVersion,
  WalletMethod,
  WalletMode,
  WalletRequest,
} from "./types.js";

const DEFAULT_CHAINS = ["solana:mainnet", "solana:devnet", "solana:testnet", "solana:localnet"] as const;
const DEFAULT_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzE0RjE5NSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1zaXplPSIxMiIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RTJFPC90ZXh0Pjwvc3ZnPg==" as const;
const ALL_FEATURES: readonly FeatureName[] = [
  "standard:connect",
  "standard:disconnect",
  "standard:events",
  "solana:signMessage",
  "solana:signTransaction",
  "solana:signAndSendTransaction",
  "solana:signIn",
];
const COMMITMENT_RANK: Record<Commitment, number> = { processed: 0, confirmed: 1, finalized: 2 };

/** Static facts the page side needs to build the Wallet Standard object. */
export interface WalletInfo {
  name: string;
  icon: string;
  chains: string[];
  features: FeatureName[];
  supportedTransactionVersions: TransactionVersion[];
}

export type BridgeResponse =
  | { ok: true; value: unknown; accounts: SerializedAccount[] }
  | { ok: false; error: { code: number; message: string }; accounts: SerializedAccount[] };

interface HeldAccount {
  address: Address;
  publicKey: Uint8Array;
  keyPair: CryptoKeyPair;
  label?: string;
}

interface PendingRequest {
  request: WalletRequest;
  resolve: () => void;
  reject: (error: TestWalletError) => void;
}

interface Directive {
  kind: "reject" | "fail";
  method?: WalletMethod;
  error: TestWalletError;
}

type ChangeListener = (accounts: SerializedAccount[]) => void;
type RequestListener = (request: WalletRequest) => void;

const bytes = (value: readonly number[] | Uint8Array) => Uint8Array.from(value);
const toArray = (value: Uint8Array | ArrayLike<number>) => Array.from(value);
const utf8 = new TextDecoder("utf-8", { fatal: true });
const base58 = getBase58Decoder();

function decodeText(message: Uint8Array): string | undefined {
  try {
    return utf8.decode(message);
  } catch {
    return undefined;
  }
}

async function keyPairFromInput(input: AccountInput): Promise<{ keyPair: CryptoKeyPair; label?: string }> {
  const spec = typeof input === "string" ? { seed: input, label: input } : input;
  if (spec.secretKey) {
    const secret = bytes(spec.secretKey);
    if (secret.length === 64) return { keyPair: await createKeyPairFromBytes(secret), label: spec.label };
    if (secret.length === 32) return { keyPair: await createKeyPairFromPrivateKeyBytes(secret), label: spec.label };
    throw new TestWalletError(ErrorCode.INTERNAL, "[solana-e2e] secretKey must be 32 or 64 bytes");
  }
  if (spec.seed !== undefined) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`solana-e2e:${spec.seed}`));
    return { keyPair: await createKeyPairFromPrivateKeyBytes(new Uint8Array(digest)), label: spec.label ?? spec.seed };
  }
  return { keyPair: await generateKeyPair(), label: spec.label };
}

/**
 * The wallet's brain: keys, connection state, approvals and the request log.
 * It runs in Node (Playwright) or in the test's own realm (Vitest/jsdom); the page only holds a thin
 * Wallet Standard shell that forwards every call here.
 */
export class TestWallet {
  readonly mode: WalletMode;
  readonly info: WalletInfo;
  /** Every request the dApp made, oldest first. */
  readonly requests: WalletRequest[] = [];

  private readonly held: HeldAccount[];
  private readonly options: Required<Pick<TestWalletOptions, "commitment" | "confirmTimeoutMs">> & TestWalletOptions;
  private readonly rpc?: ReturnType<typeof createSolanaRpc>;
  private activeIndex = 0;
  private connected = false;
  private trusted: boolean;
  private readonly initialTrusted: boolean;
  private readonly initialApproval: ApprovalMode;
  private approvalMode: ApprovalMode;
  private directives: Directive[] = [];
  private pendingQueue: PendingRequest[] = [];
  private nextId = 1;
  private changeListeners = new Set<ChangeListener>();
  private requestListeners = new Set<RequestListener>();

  private constructor(options: TestWalletOptions, held: HeldAccount[]) {
    this.options = { commitment: "confirmed", confirmTimeoutMs: 30_000, ...options };
    this.mode = options.mode ?? "mock";
    this.held = held;
    this.trusted = options.trusted ?? false;
    this.approvalMode = options.approval ?? "auto";
    this.initialTrusted = this.trusted;
    this.initialApproval = this.approvalMode;
    const disabled = new Set(options.disabledFeatures ?? []);
    this.info = {
      name: options.name ?? "Solana E2E Test Wallet",
      icon: options.icon ?? DEFAULT_ICON,
      chains: [...(options.chains ?? DEFAULT_CHAINS)],
      features: ALL_FEATURES.filter((feature) => !disabled.has(feature)),
      supportedTransactionVersions: [...(options.supportedTransactionVersions ?? ["legacy", 0, 1])],
    };
    if (this.mode === "rpc") {
      if (!options.rpcUrl) throw new TestWalletError(ErrorCode.INTERNAL, '[solana-e2e] mode "rpc" needs an rpcUrl');
      if (/mainnet/i.test(options.rpcUrl) && !options.allowMainnet) {
        throw new TestWalletError(
          ErrorCode.INTERNAL,
          `[solana-e2e] refusing to send to ${options.rpcUrl}: it looks like mainnet. Pass allowMainnet: true if you mean it.`,
        );
      }
      this.rpc = createSolanaRpc(options.rpcUrl);
    }
  }

  static async create(options: TestWalletOptions = {}): Promise<TestWallet> {
    const inputs: readonly AccountInput[] =
      typeof options.accounts === "number"
        ? Array.from({ length: options.accounts }, () => ({}))
        : (options.accounts ?? [{}]);
    if (inputs.length === 0) throw new TestWalletError(ErrorCode.INTERNAL, "[solana-e2e] the wallet needs at least one account");
    const held: HeldAccount[] = [];
    for (const input of inputs) {
      const { keyPair, label } = await keyPairFromInput(input);
      const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
      held.push({ address: await getAddressFromPublicKey(keyPair.publicKey), publicKey, keyPair, label });
    }
    return new TestWallet(options, held);
  }

  // ---------------------------------------------------------------- state the test can read

  /** Every account the wallet holds, connected or not. */
  get accounts(): { address: Address; label?: string }[] {
    return this.held.map(({ address, label }) => ({ address, label }));
  }

  /** Address of the active account. */
  get address(): Address {
    return this.active.address;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Requests waiting for `approve()` / `reject()` in manual approval mode. */
  get pending(): readonly WalletRequest[] {
    return this.pendingQueue.map((entry) => entry.request);
  }

  /** A Kit signer for an account, to sign or fund from the test itself. */
  async signer(indexOrAddress: number | string = this.activeIndex): Promise<KeyPairSigner> {
    return createSignerFromKeyPair(this.find(indexOrAddress).keyPair);
  }

  // ---------------------------------------------------------------- controls

  /** Reject the next request (or the next one for `method`) as if the user clicked "Cancel". */
  rejectNext(options: { method?: WalletMethod; message?: string } = {}): this {
    this.directives.push({ kind: "reject", method: options.method, error: userRejected(options.message) });
    return this;
  }

  /** Make the next request (or the next one for `method`) fail with an error of your choosing. */
  failNext(options: { method?: WalletMethod; message?: string; code?: number } = {}): this {
    const error = new TestWalletError(options.code ?? ErrorCode.INTERNAL, options.message ?? "Unexpected error");
    this.directives.push({ kind: "fail", method: options.method, error });
    return this;
  }

  setApproval(mode: ApprovalMode): this {
    this.approvalMode = mode;
    if (mode === "auto") while (this.pendingQueue.length) this.approve();
    return this;
  }

  /** Approve the oldest pending request. */
  approve(): WalletRequest {
    const entry = this.shiftPending();
    entry.resolve();
    return entry.request;
  }

  /** Reject the oldest pending request. */
  reject(message?: string): WalletRequest {
    const entry = this.shiftPending();
    entry.reject(userRejected(message));
    return entry.request;
  }

  /** Make the active account another one. Connected dApps get a `change` event. */
  switchAccount(indexOrAddress: number | string /* index, address or label */): this {
    this.activeIndex = this.held.indexOf(this.find(indexOrAddress));
    if (this.connected) this.emitChange();
    return this;
  }

  /** Disconnect from the wallet side, as when the user revokes the site. */
  disconnect(): this {
    this.connected = false;
    this.trusted = false;
    this.emitChange();
    return this;
  }

  /** Whether a silent connect (`autoConnect`) gets the account. */
  setTrusted(trusted: boolean): this {
    this.trusted = trusted;
    return this;
  }

  /** Back to a fresh wallet: disconnected, first account, no directives, empty log. Keys are kept. */
  reset(): this {
    for (const entry of this.pendingQueue.splice(0)) entry.reject(userRejected("Wallet was reset."));
    const wasConnected = this.connected;
    this.directives = [];
    this.connected = false;
    this.activeIndex = 0;
    this.trusted = this.initialTrusted;
    this.approvalMode = this.initialApproval;
    this.requests.length = 0;
    if (wasConnected) this.emitChange();
    return this;
  }

  clearRequests(): this {
    this.requests.length = 0;
    return this;
  }

  /** Resolve with the first request (already logged or future) that matches. */
  waitForRequest(
    filter: WalletMethod | ((request: WalletRequest) => boolean),
    { timeoutMs = 10_000, outcome }: { timeoutMs?: number; outcome?: Exclude<WalletRequest["outcome"], "pending"> | "pending" } = {},
  ): Promise<WalletRequest> {
    const matches = (request: WalletRequest) =>
      (typeof filter === "string" ? request.method === filter : filter(request)) &&
      (outcome ? request.outcome === outcome : request.outcome !== "pending");
    const found = this.requests.find(matches);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requestListeners.delete(listener);
        reject(new Error(`[solana-e2e] no ${typeof filter === "string" ? filter : "matching"} request within ${timeoutMs} ms`));
      }, timeoutMs);
      const listener: RequestListener = (request) => {
        if (!matches(request)) return;
        clearTimeout(timer);
        this.requestListeners.delete(listener);
        resolve(request);
      };
      this.requestListeners.add(listener);
    });
  }

  /** Transports subscribe here to push account changes into the page. */
  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Accounts the dApp can currently see. */
  visibleAccounts(): SerializedAccount[] {
    if (!this.connected) return [];
    const { address, publicKey, label } = this.active;
    return [{ address, publicKey: toArray(publicKey), label }];
  }

  // ---------------------------------------------------------------- the page calls this

  /** Entry point for the page-side shell. Payloads and results are plain JSON. */
  async handle(method: string, payload: Record<string, unknown> = {}): Promise<BridgeResponse> {
    try {
      const value = await this.dispatch(method, payload);
      return { ok: true, value, accounts: this.visibleAccounts() };
    } catch (error) {
      const failure =
        error instanceof TestWalletError
          ? { code: error.code, message: error.message }
          : { code: ErrorCode.INTERNAL, message: error instanceof Error ? error.message : String(error) };
      return { ok: false, error: failure, accounts: this.visibleAccounts() };
    }
  }

  private async dispatch(method: string, payload: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "connect":
        return this.connect(Boolean(payload.silent));
      case "disconnect":
        this.log({ method: "disconnect", outcome: "approved" });
        this.connected = false;
        return {};
      case "signMessage":
        return this.signMessage(String(payload.address), bytes(payload.message as number[]));
      case "signTransaction":
        return this.signTransaction(String(payload.address), bytes(payload.transaction as number[]), payload.chain as string | undefined);
      case "signAndSendTransaction":
        return this.signAndSend(
          String(payload.address),
          bytes(payload.transaction as number[]),
          payload.chain as string | undefined,
          (payload.options ?? {}) as { commitment?: Commitment; skipPreflight?: boolean; maxRetries?: number },
        );
      case "signIn":
        return this.signIn((payload.input ?? {}) as SolanaSignInInput, String(payload.domain ?? "localhost"));
      default:
        throw new TestWalletError(ErrorCode.UNSUPPORTED_METHOD, `[solana-e2e] unsupported method: ${method}`);
    }
  }

  private async connect(silent: boolean) {
    if (silent && !this.trusted) {
      // Real wallets answer an untrusted silent connect with no accounts and no prompt.
      this.log({ method: "connect", outcome: "rejected", error: { code: ErrorCode.UNAUTHORIZED, message: "silent connect on an untrusted site" } });
      return {};
    }
    if (silent || this.connected) {
      this.connected = true;
      this.log({ method: "connect", outcome: "approved", address: this.address });
      return {};
    }
    await this.approveOrThrow({ method: "connect", address: this.address });
    this.connected = true;
    this.trusted = true;
    this.emitChange();
    return {};
  }

  private async signMessage(address: string, message: Uint8Array) {
    const account = this.authorized(address, "signMessage");
    await this.approveOrThrow({ method: "signMessage", address, message: decodeText(message) });
    const signature = await signBytes(account.keyPair.privateKey, message);
    return { signature: toArray(signature), signedMessage: toArray(message) };
  }

  private async signTransaction(address: string, wire: Uint8Array, chain?: string) {
    const account = this.authorized(address, "signTransaction");
    const transaction = this.decode(wire);
    const logged = await this.approveOrThrow({ method: "signTransaction", address, chain });
    const signed = await partiallySignTransaction([account.keyPair], transaction);
    logged.signature = base58.decode(signed.signatures[account.address] as Uint8Array);
    return { signedTransaction: toArray(getTransactionEncoder().encode(signed)) };
  }

  private async signAndSend(
    address: string,
    wire: Uint8Array,
    chain: string | undefined,
    options: { commitment?: Commitment; skipPreflight?: boolean; maxRetries?: number },
  ) {
    const account = this.authorized(address, "signAndSendTransaction");
    const transaction = this.decode(wire);
    const logged = await this.approveOrThrow({ method: "signAndSendTransaction", address, chain });
    const signed = await partiallySignTransaction([account.keyPair], transaction);
    const feePayerSignature = Object.values(signed.signatures)[0];
    if (!feePayerSignature) throw new TestWalletError(ErrorCode.INTERNAL, "[solana-e2e] transaction has no signer slots");
    const signature = base58.decode(feePayerSignature) as Signature;
    logged.signature = signature;
    if (this.mode === "rpc") {
      try {
        await this.send(signed, signature, options);
      } catch (error) {
        const failure = error instanceof TestWalletError ? error : new TestWalletError(ErrorCode.TRANSACTION_FAILED, String((error as Error)?.message ?? error));
        logged.outcome = "failed";
        logged.error = { code: failure.code, message: failure.message };
        throw failure;
      }
    }
    return { signature: toArray(feePayerSignature) };
  }

  private async signIn(input: SolanaSignInInput, pageDomain: string) {
    if (!this.connected) {
      await this.approveOrThrow({ method: "connect", address: this.address });
      this.connected = true;
      this.trusted = true;
      this.emitChange();
    }
    const account = this.active;
    const text = createSignInMessageText({ ...input, domain: input.domain ?? pageDomain, address: input.address ?? account.address });
    await this.approveOrThrow({ method: "signIn", address: account.address, message: text });
    const message = new TextEncoder().encode(text);
    const signature = await signBytes(account.keyPair.privateKey, message);
    return { address: account.address, signedMessage: toArray(message), signature: toArray(signature) };
  }

  // ---------------------------------------------------------------- helpers

  private get active(): HeldAccount {
    return this.held[this.activeIndex]!;
  }

  private find(indexOrAddress: number | string): HeldAccount {
    const account = typeof indexOrAddress === "number" ? this.held[indexOrAddress] : this.held.find((held) => held.address === indexOrAddress || held.label === indexOrAddress);
    if (!account) throw new TestWalletError(ErrorCode.INTERNAL, `[solana-e2e] no account ${String(indexOrAddress)}`);
    return account;
  }

  private authorized(address: string, method: WalletMethod): HeldAccount {
    if (!this.connected || address !== this.active.address) {
      const error = unauthorized();
      this.log({ method, address, outcome: "rejected", error: { code: error.code, message: error.message } });
      throw error;
    }
    return this.active;
  }

  private decode(wire: Uint8Array): Transaction {
    try {
      return getTransactionDecoder().decode(wire);
    } catch (error) {
      throw new TestWalletError(ErrorCode.INTERNAL, `[solana-e2e] could not decode the transaction: ${(error as Error).message}`);
    }
  }

  private async send(signed: Transaction, signature: Signature, options: { commitment?: Commitment; skipPreflight?: boolean; maxRetries?: number }) {
    const rpc = this.rpc!;
    const commitment = options.commitment ?? this.options.commitment;
    try {
      await rpc
        .sendTransaction(getBase64EncodedWireTransaction(signed), {
          encoding: "base64",
          skipPreflight: options.skipPreflight ?? false,
          preflightCommitment: commitment,
          ...(options.maxRetries !== undefined ? { maxRetries: BigInt(options.maxRetries) } : {}),
        })
        .send();
    } catch (error) {
      throw new TestWalletError(ErrorCode.TRANSACTION_FAILED, `Transaction simulation failed: ${(error as Error).message}`);
    }
    const deadline = Date.now() + this.options.confirmTimeoutMs;
    while (Date.now() < deadline) {
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      const status = value[0];
      if (status?.err) throw new TestWalletError(ErrorCode.TRANSACTION_FAILED, `Transaction failed: ${JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
      if (status?.confirmationStatus && COMMITMENT_RANK[status.confirmationStatus] >= COMMITMENT_RANK[commitment]) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new TestWalletError(ErrorCode.TRANSACTION_FAILED, `[solana-e2e] ${signature} not ${commitment} within ${this.options.confirmTimeoutMs} ms`);
  }

  private log(entry: Omit<WalletRequest, "id" | "at">): WalletRequest {
    const request: WalletRequest = { id: this.nextId++, at: Date.now(), ...entry };
    this.requests.push(request);
    if (request.outcome !== "pending") this.notify(request);
    return request;
  }

  private notify(request: WalletRequest) {
    for (const listener of [...this.requestListeners]) listener(request);
  }

  /** Log the request, then settle it: directive first, then manual queue, else approve. */
  private async approveOrThrow(entry: Omit<WalletRequest, "id" | "at" | "outcome">): Promise<WalletRequest> {
    const directiveIndex = this.directives.findIndex((directive) => !directive.method || directive.method === entry.method);
    if (directiveIndex >= 0) {
      const [directive] = this.directives.splice(directiveIndex, 1);
      const { error } = directive!;
      this.log({ ...entry, outcome: directive!.kind === "reject" ? "rejected" : "failed", error: { code: error.code, message: error.message } });
      throw error;
    }
    if (this.approvalMode === "auto") return this.log({ ...entry, outcome: "approved" });
    const request = this.log({ ...entry, outcome: "pending" });
    await new Promise<void>((resolve, reject) => {
      this.pendingQueue.push({
        request,
        resolve: () => {
          request.outcome = "approved";
          this.notify(request);
          resolve();
        },
        reject: (error) => {
          request.outcome = "rejected";
          request.error = { code: error.code, message: error.message };
          this.notify(request);
          reject(error);
        },
      });
      for (const listener of [...this.requestListeners]) listener(request);
    });
    return request;
  }

  private shiftPending(): PendingRequest {
    const entry = this.pendingQueue.shift();
    if (!entry) throw new Error("[solana-e2e] no pending request");
    return entry;
  }

  private emitChange() {
    const accounts = this.visibleAccounts();
    for (const listener of this.changeListeners) listener(accounts);
  }
}
