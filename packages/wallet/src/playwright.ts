import type { BrowserContext, Page } from "@playwright/test";
import { TestWallet } from "./core.js";
import { mountTestWallet } from "./mount.js";
import type { TestWalletOptions } from "./types.js";

export { TestWallet } from "./core.js";
export type * from "./types.js";

/**
 * Inject the test wallet into every page of a context, or into one page. Call it before `page.goto`.
 * Keys and signing stay in Node; the page only gets a Wallet Standard shell that forwards calls.
 */
export async function installTestWallet(
  target: Page | BrowserContext,
  options: TestWalletOptions | TestWallet = {},
): Promise<TestWallet> {
  const wallet = options instanceof TestWallet ? options : await TestWallet.create(options);
  const id = Math.random().toString(36).slice(2);
  const binding = `__solanaE2E_call_${id}`;
  const globalKey = `__solanaE2E_${id}`;

  await target.exposeFunction(binding, (method: string, payload: Record<string, unknown>) => wallet.handle(method, payload));
  const info = JSON.stringify({ ...wallet.info, globalKey });
  await target.addInitScript({
    content: `(${mountTestWallet.toString()})((method, payload) => window[${JSON.stringify(binding)}](method, payload), ${info});`,
  });

  const pages = () => ("pages" in target ? target.pages() : [target]);
  wallet.onChange((accounts) => {
    for (const page of pages()) {
      for (const frame of page.frames()) {
        frame
          .evaluate(([key, next]) => (window as any)[key]?.update(next), [globalKey, accounts] as const)
          .catch(() => {
            // page navigating or closed: the next call resyncs accounts anyway
          });
      }
    }
  });
  return wallet;
}
