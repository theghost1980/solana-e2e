import { generateKeyPairSigner } from "@solana/kit";
import { describe, expect, test } from "vitest";
import { freePort, startLocalnet } from "../src/localnet.js";

const hasSurfpool = Boolean(process.env.SURFPOOL_BIN);

test("a missing binary fails with an actionable message", async () => {
  await expect(startLocalnet({ surfpoolBin: "definitely-not-surfpool-xyz" })).rejects.toThrow(/Install Surfpool|SURFPOOL_BIN/);
});

test("an existing rpcUrl is wrapped, not started", async () => {
  const localnet = await startLocalnet({ rpcUrl: "http://127.0.0.1:8899" });
  expect(localnet.wsUrl).toBe("ws://127.0.0.1:8900");
  await localnet.stop(); // no-op
});

test("freePort returns a usable port", async () => {
  const port = await freePort();
  expect(port).toBeGreaterThan(0);
});

describe.skipIf(!hasSurfpool)("with Surfpool (set SURFPOOL_BIN)", () => {
  test("starts, funds, reports balances and stops", async () => {
    const localnet = await startLocalnet();
    try {
      const { address } = await generateKeyPairSigner();
      await localnet.fund(address, 2_000_000_000n);
      expect(await localnet.getBalance(address)).toBe(2_000_000_000n);
    } finally {
      await localnet.stop();
    }
    await expect(fetch(localnet.rpcUrl, { method: "POST" })).rejects.toThrow();
  }, 60_000);
});
