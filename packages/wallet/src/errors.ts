/** Error codes follow what Solana wallets commonly return (EIP-1193 numbering). */
export const ErrorCode = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  INTERNAL: -32603,
  TRANSACTION_FAILED: -32002,
} as const;

export class TestWalletError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "TestWalletError";
    this.code = code;
  }
}

export const userRejected = (message = "User rejected the request.") =>
  new TestWalletError(ErrorCode.USER_REJECTED, message);

export const unauthorized = (message = "The requested account has not been authorized by the user.") =>
  new TestWalletError(ErrorCode.UNAUTHORIZED, message);
