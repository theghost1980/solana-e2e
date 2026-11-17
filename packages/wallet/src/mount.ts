/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Page-side Wallet Standard shell.
 *
 * This function is serialised with `Function.prototype.toString()` and run inside the browser page
 * by Playwright, so it must stay self-contained: no imports, no references to module scope, and no
 * syntax the build would rewrite into helpers. Every call is forwarded to `call`, which reaches the
 * TestWallet in Node (Playwright) or in the same realm (jsdom).
 */
export function mountTestWallet(
  call: (method: string, payload: Record<string, unknown>) => Promise<any>,
  info: {
    name: string;
    icon: string;
    chains: string[];
    features: string[];
    supportedTransactionVersions: (string | number)[];
    globalKey: string;
  },
): { update: (accounts: any[]) => void; unregister: () => void; wallet: any } {
  const SOLANA_FEATURES = info.features.filter((name) => name.indexOf("solana:") === 0);
  const listeners: Record<string, ((properties: any) => void)[]> = { change: [] };
  const cache = new Map<string, any>();
  let accounts: any[] = [];

  const toAccount = (serialized: any) => {
    const cached = cache.get(serialized.address);
    if (cached) return cached;
    const account = Object.freeze({
      address: serialized.address,
      publicKey: Uint8Array.from(serialized.publicKey),
      chains: info.chains.slice(),
      features: SOLANA_FEATURES.slice(),
      label: serialized.label,
    });
    cache.set(serialized.address, account);
    return account;
  };

  const update = (next: any[]) => {
    const before = accounts.map((account) => account.address).join(",");
    accounts = next.map(toAccount);
    if (before === accounts.map((account) => account.address).join(",")) return;
    for (const listener of listeners.change!.slice()) {
      try {
        listener({ accounts: accounts.slice() });
      } catch (error) {
        console.error(error);
      }
    }
  };

  const request = async (method: string, payload: Record<string, unknown>) => {
    const response = await call(method, payload);
    update(response.accounts);
    if (!response.ok) {
      const error: any = new Error(response.error.message);
      error.code = response.error.code;
      error.name = "WalletError";
      throw error;
    }
    return response.value;
  };

  const all = <I, O>(fn: (input: I) => Promise<O>) => (...inputs: I[]) => Promise.all(inputs.map(fn));

  const features: Record<string, any> = {};
  const enabled = (name: string) => info.features.indexOf(name) !== -1;

  if (enabled("standard:connect")) {
    features["standard:connect"] = {
      version: "1.0.0",
      connect: async (input?: { silent?: boolean }) => {
        await request("connect", { silent: Boolean(input && input.silent) });
        return { accounts: accounts.slice() };
      },
    };
  }
  if (enabled("standard:disconnect")) {
    features["standard:disconnect"] = { version: "1.0.0", disconnect: async () => void (await request("disconnect", {})) };
  }
  if (enabled("standard:events")) {
    features["standard:events"] = {
      version: "1.0.0",
      on: (event: string, listener: (properties: any) => void) => {
        (listeners[event] = listeners[event] || []).push(listener);
        return () => {
          listeners[event] = (listeners[event] || []).filter((registered) => registered !== listener);
        };
      },
    };
  }
  if (enabled("solana:signMessage")) {
    features["solana:signMessage"] = {
      version: "1.0.0",
      signMessage: all(async (input: any) => {
        const value = await request("signMessage", { address: input.account.address, message: Array.from(input.message as Uint8Array) });
        return { signedMessage: Uint8Array.from(value.signedMessage), signature: Uint8Array.from(value.signature), signatureType: "ed25519" };
      }),
    };
  }
  if (enabled("solana:signTransaction")) {
    features["solana:signTransaction"] = {
      version: "1.0.0",
      supportedTransactionVersions: info.supportedTransactionVersions.slice(),
      signTransaction: all(async (input: any) => {
        const value = await request("signTransaction", {
          address: input.account.address,
          transaction: Array.from(input.transaction as Uint8Array),
          chain: input.chain,
        });
        return { signedTransaction: Uint8Array.from(value.signedTransaction) };
      }),
    };
  }
  if (enabled("solana:signAndSendTransaction")) {
    features["solana:signAndSendTransaction"] = {
      version: "1.0.0",
      supportedTransactionVersions: info.supportedTransactionVersions.slice(),
      signAndSendTransaction: all(async (input: any) => {
        const value = await request("signAndSendTransaction", {
          address: input.account.address,
          transaction: Array.from(input.transaction as Uint8Array),
          chain: input.chain,
          options: input.options ? JSON.parse(JSON.stringify(input.options)) : undefined,
        });
        return { signature: Uint8Array.from(value.signature) };
      }),
    };
  }
  if (enabled("solana:signIn")) {
    features["solana:signIn"] = {
      version: "1.0.0",
      signIn: all(async (input: any) => {
        const plain = input ? JSON.parse(JSON.stringify(input)) : {};
        const value = await request("signIn", { input: plain, domain: typeof location !== "undefined" ? location.host : "localhost" });
        const account = accounts.find((candidate) => candidate.address === value.address) || accounts[0];
        return {
          account,
          signedMessage: Uint8Array.from(value.signedMessage),
          signature: Uint8Array.from(value.signature),
          signatureType: "ed25519",
        };
      }),
    };
  }

  const wallet = {
    version: "1.0.0",
    name: info.name,
    icon: info.icon,
    chains: info.chains.slice(),
    features,
    get accounts() {
      return accounts.slice();
    },
  };

  // Wallet Standard registration, both orders: app already loaded, or app loads later.
  const unregisters: (() => void)[] = [];
  const register = (api: { register: (wallet: any) => () => void }) => {
    try {
      unregisters.push(api.register(wallet));
    } catch (error) {
      console.error("[solana-e2e] could not register the test wallet", error);
    }
  };
  try {
    window.dispatchEvent(
      new (class extends Event {
        readonly detail = register;
        constructor() {
          super("wallet-standard:register-wallet", { bubbles: false, cancelable: false, composed: false });
        }
      })(),
    );
  } catch (error) {
    console.error("[solana-e2e] wallet-standard:register-wallet event could not be dispatched", error);
  }
  try {
    window.addEventListener("wallet-standard:app-ready", (event: any) => register(event.detail));
  } catch (error) {
    console.error("[solana-e2e] wallet-standard:app-ready listener could not be added", error);
  }

  const unregister = () => {
    while (unregisters.length) {
      try {
        unregisters.pop()!();
      } catch {
        // already gone
      }
    }
  };
  const handle = { update, unregister, wallet };
  (window as any)[info.globalKey] = handle;
  return handle;
}
