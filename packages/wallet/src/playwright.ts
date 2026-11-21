import type { BrowserContext, Page } from "@playwright/test";
import { TestWallet } from "./core.js";
import { mountTestWallet } from "./mount.js";
import type { TestWalletOptions } from "./types.js";

export { TestWallet } from "./core.js";
export type * from "./types.js";

export interface InstallOptions {
  /**
   * Register into pages that are already loaded (with `page.evaluate`) instead of with an init
   * script, the way a slow extension announces itself after the dApp has rendered. The wallet is
   * not re-injected after a navigation or in pages opened later.
   */
  late?: boolean;
}

interface Installation {
  globalKey: string;
  target: Page | BrowserContext;
  cleanup: (() => Promise<void> | void)[];
}

const installations = new WeakMap<TestWallet, Installation[]>();

const pagesOf = (target: Page | BrowserContext): Page[] => ("pages" in target ? target.pages() : [target]);

/** Playwright >= 1.56 returns a Disposable from exposeFunction / addInitScript; older versions return void. */
const disposer = (value: unknown) => async () => {
  const dispose = (value as { dispose?: () => Promise<void> } | undefined)?.dispose;
  if (typeof dispose === "function") await dispose.call(value).catch(() => {});
};

/**
 * Inject the test wallet into every page of a context, or into one page. Call it before `page.goto`,
 * or pass `{ late: true }` to register into pages that are already open.
 * Keys and signing stay in Node; the page only gets a Wallet Standard shell that forwards calls.
 */
export async function installTestWallet(
  target: Page | BrowserContext,
  options: (TestWalletOptions & InstallOptions) | TestWallet = {},
  install: InstallOptions = {},
): Promise<TestWallet> {
  const wallet = options instanceof TestWallet ? options : await TestWallet.create(options);
  const late = install.late ?? (options instanceof TestWallet ? false : options.late ?? false);
  const id = Math.random().toString(36).slice(2);
  const binding = `__solanaE2E_call_${id}`;
  const globalKey = `__solanaE2E_${id}`;
  const installation: Installation = { globalKey, target, cleanup: [] };

  const exposed = await target.exposeFunction(binding, (method: string, payload: Record<string, unknown>) => wallet.handle(method, payload));
  installation.cleanup.push(disposer(exposed));

  const info = JSON.stringify({ ...wallet.info, globalKey });
  const content = `(${mountTestWallet.toString()})((method, payload) => window[${JSON.stringify(binding)}](method, payload), ${info});`;
  if (late) {
    for (const page of pagesOf(target)) await page.evaluate(content);
  } else {
    const script = await target.addInitScript({ content });
    installation.cleanup.push(disposer(script));
  }

  const unsubscribe = wallet.onChange((accounts) => {
    for (const page of pagesOf(target)) {
      for (const frame of page.frames()) {
        frame
          .evaluate(([key, next]) => (window as any)[key]?.update(next), [globalKey, accounts] as const)
          .catch(() => {
            // page navigating or closed: the next call resyncs accounts anyway
          });
      }
    }
  });
  installation.cleanup.push(unsubscribe);
  // Stop pushing account changes once the page or context is gone.
  (target as Page).once("close", unsubscribe);

  installations.set(wallet, [...(installations.get(wallet) ?? []), installation]);
  return wallet;
}

/**
 * Undo every `installTestWallet` of this wallet: unregister it from open pages, stop pushing account
 * changes, and (on Playwright >= 1.56) remove the init script and the binding.
 */
export async function uninstallTestWallet(wallet: TestWallet): Promise<void> {
  for (const { globalKey, target, cleanup } of installations.get(wallet) ?? []) {
    for (const page of pagesOf(target)) {
      if (page.isClosed()) continue;
      for (const frame of page.frames()) {
        await frame.evaluate((key) => (window as any)[key]?.unregister(), globalKey).catch(() => {});
      }
    }
    for (const step of cleanup) await step();
  }
  installations.delete(wallet);
}
