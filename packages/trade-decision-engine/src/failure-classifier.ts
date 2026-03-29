// failure-classifier.ts
// Centralized revert + failure classification for arbitrage simulation/execution

export type FailureReason =
  | "TOKEN_NOT_ALLOWED"
  | "DEX_NOT_ALLOWED"
  | "GROSS_PROFIT_TOO_LOW"
  | "GAS_TOO_HIGH"
  | "PRICE_IMPACT_TOO_HIGH"
  | "POOL_LIQUIDITY_TOO_LOW"
  | "POOL_VOLUME_TOO_LOW"
  | "STALE_OPPORTUNITY"
  | "TOO_MANY_HOPS"
  | "QUOTE_FAILED"
  | "NOT_PROFITABLE_AFTER_FEES"
  | "INSUFFICIENT_OUTPUT_AMOUNT"
  | "TRANSFER_FAILED"
  | "CALLBACK_FAILED"
  | "ASSET_NOT_RETURNED"
  | "DEADLINE_EXPIRED"
  | "POOL_STATE_CHANGED"
  | "ROUTE_ENCODING_INVALID"
  | "ALLOWANCE_OR_APPROVAL"
  | "BALANCE_TOO_LOW"
  | "GAS_ESTIMATION_FAILED"
  | "RPC_ERROR"
  | "EXECUTOR_GUARD_REJECTED"
  | "FLASHLOAN_PREMIUM_CHANGED"
  | "TOO_LATE_TO_SEND"
  | "REVERTED_OR_IMPOSSIBLE"
  | "UNKNOWN"
  | "NO_VALID_SIZE";

export type FailureInput = {
  phase?: "prefilter" | "quote" | "simulate" | "send" | "receipt";
  reason?: string;
  decodedReason?: string;
  revertData?: string;
  rawError?: unknown;
};

export type ClassifiedFailure = {
  failure: FailureReason;
  confidence: "high" | "medium" | "low";
  details: string[];
};

function flattenError(raw: unknown): string {
  try {
    if (raw == null) return "";
    if (typeof raw === "string") return raw;
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function containsAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

export function classifyFailure(input: FailureInput): ClassifiedFailure {
  const blob = [
    input.phase ?? "",
    input.reason ?? "",
    input.decodedReason ?? "",
    input.revertData ?? "",
    flattenError(input.rawError),
  ]
    .join(" | ")
    .toLowerCase();

  const details: string[] = [];

  if (containsAny(blob, [
    "insufficient_output_amount",
    "insufficient output amount",
    "too little received",
    "slippage check failed",
    "execution reverted: k",
    // Uniswap V2 K-invariant: the bare string is literally 'K'
    // We match " k" (space-bounded) to avoid false-positives on 'stack', 'block', etc.
    " k"
  ])) {
    details.push("Swap output fell below minimum acceptable amount (includes UniV2 K-invariant).");
    return { failure: "INSUFFICIENT_OUTPUT_AMOUNT", confidence: "high", details };
  }

  if (containsAny(blob, ["transfer_failed", "transfer failed", "safeerc20", "erc20: transfer amount exceeds"])) {
    details.push("Token transfer failed during execution.");
    return { failure: "TRANSFER_FAILED", confidence: "high", details };
  }

  if (containsAny(blob, ["callback", "executeoperation", "uniswapv3swapcallback", "flashloan callback"])) {
    details.push("Callback path failed, often due to calldata mismatch or repayment path issues.");
    return { failure: "CALLBACK_FAILED", confidence: "high", details };
  }

  if (containsAny(blob, ["asset not returned", "flash loan not reimbursed", "amount owed not met"])) {
    details.push("Loan repayment path did not return the expected asset amount.");
    return { failure: "ASSET_NOT_RETURNED", confidence: "high", details };
  }

  if (containsAny(blob, ["deadline", "expired"])) {
    details.push("Transaction or quote expired before execution.");
    return { failure: "DEADLINE_EXPIRED", confidence: "high", details };
  }

  if (containsAny(blob, ["invalid path", "encoding", "abi", "bad route", "malformed calldata"])) {
    details.push("Route or calldata encoding looks invalid.");
    return { failure: "ROUTE_ENCODING_INVALID", confidence: "high", details };
  }

  if (containsAny(blob, ["state changed", "tick", "liquidity changed", "slot0", "sqrtpricex96"])) {
    details.push("Pool state likely changed between quote and simulation.");
    return { failure: "POOL_STATE_CHANGED", confidence: "medium", details };
  }

  if (containsAny(blob, ["insufficient allowance", "approval", "permit", "allowance"])) {
    details.push("Allowance or approval path failed.");
    return { failure: "ALLOWANCE_OR_APPROVAL", confidence: "high", details };
  }

  if (containsAny(blob, ["insufficient funds", "balance too low", "exceeds balance"])) {
    details.push("Executor or funding wallet lacks balance for the attempted path.");
    return { failure: "BALANCE_TOO_LOW", confidence: "high", details };
  }

  if (containsAny(blob, ["cannot estimate gas", "gas required exceeds allowance", "intrinsic gas too low"])) {
    details.push("Gas estimation failed before send.");
    return { failure: "GAS_ESTIMATION_FAILED", confidence: "high", details };
  }

  if (containsAny(blob, ["timeout", "429", "rate limit", "gateway", "rpc", "upstream"])) {
    details.push("RPC or upstream provider error occurred.");
    return { failure: "RPC_ERROR", confidence: "medium", details };
  }

  if (containsAny(blob, ["guard rejected", "executor guard", "profit below threshold"])) {
    details.push("Internal guardrail rejected the route before send.");
    return { failure: "EXECUTOR_GUARD_REJECTED", confidence: "high", details };
  }

  if (containsAny(blob, ["flashloan premium", "premium changed"])) {
    details.push("Flash-loan premium or fee assumptions changed.");
    return { failure: "FLASHLOAN_PREMIUM_CHANGED", confidence: "medium", details };
  }

  if (containsAny(blob, ["late", "stale", "too old", "block age"])) {
    details.push("Opportunity became stale before send.");
    return { failure: "TOO_LATE_TO_SEND", confidence: "medium", details };
  }

  if (containsAny(blob, ["not profitable", "negative net", "profit below min"])) {
    details.push("The route is not profitable after fees and reserves.");
    return { failure: "NOT_PROFITABLE_AFTER_FEES", confidence: "high", details };
  }

  if (containsAny(blob, ["reverted", "execution reverted"])) {
    details.push("Execution reverted, but no specific decoded reason was available.");
    return { failure: "REVERTED_OR_IMPOSSIBLE", confidence: "low", details };
  }

  details.push("No strong match found in error payload.");
  return { failure: "UNKNOWN", confidence: "low", details };
}
