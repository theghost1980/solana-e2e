import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";

export const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** A memo transaction paid by `feePayer`, encoded as wire bytes. */
export function memoTransaction(
  feePayer: Address,
  version: "legacy" | 0 | 1 = 0,
  text = "hello",
  otherSigners: readonly Address[] = [],
): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"), lastValidBlockHeight: 100n },
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        { programAddress: MEMO_PROGRAM, accounts: [feePayer, ...otherSigners].map((signer) => ({ address: signer, role: 3 as const })), data: new TextEncoder().encode(text) },
        m,
      ),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message as never)));
}
