import { TestWallet } from "./core.js";
import { mountTestWallet } from "./mount.js";
import type { TestWalletOptions } from "./types.js";

export { TestWallet } from "./core.js";
export type { BridgeResponse, WalletInfo } from "./core.js";
export { ErrorCode, TestWalletError } from "./errors.js";
export { createSignInMessageText } from "./siws.js";
export { mountTestWallet } from "./mount.js";
export type * from "./types.js";

export interface RegisteredTestWallet {
  wallet: TestWallet;
  /** Remove the wallet from the Wallet Standard registry. */
  unregister: () => void;
}

/**
 * Register the test wallet in the current realm (Vitest + jsdom/happy-dom, or any browser bundle).
 * The dApp discovers it through Wallet Standard exactly as it would discover Phantom.
 */
export async function registerTestWallet(options: TestWalletOptions | TestWallet = {}): Promise<RegisteredTestWallet> {
  if (typeof window === "undefined") {
    throw new Error("[solana-e2e] registerTestWallet needs a DOM. In Vitest use environment: 'jsdom' or 'happy-dom'.");
  }
  const wallet = options instanceof TestWallet ? options : await TestWallet.create(options);
  const globalKey = `__solanaE2E_${Math.random().toString(36).slice(2)}`;
  // Round-trip payloads through JSON so jsdom behaves like the browser bridge.
  const call = async (method: string, payload: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(await wallet.handle(method, JSON.parse(JSON.stringify(payload)))));
  const handle = mountTestWallet(call, { ...wallet.info, globalKey });
  const stop = wallet.onChange((accounts) => handle.update(accounts));
  return {
    wallet,
    unregister: () => {
      stop();
      handle.unregister();
    },
  };
}
