/**
 * log-skip.ts
 * Structured skip logger for prefilter rejections.
 */

import type { EngineLogger } from './logger';

export function logSkip(
  logger: Pick<EngineLogger, 'info'>,
  input: {
    reason: string;
    opportunityId?: string;
    routeHash?: string;
    chain?: string;
    tokenIn?: string;
    tokenOut?: string;
    dexBuy?: string;
    dexSell?: string;
    details?: Record<string, unknown>;
  }
): void {
  logger.info('PREFILTER_SKIP', {
    reason: input.reason,
    opportunityId: input.opportunityId,
    routeHash: input.routeHash,
    chain: input.chain,
    pair: input.tokenIn && input.tokenOut ? `${input.tokenIn}/${input.tokenOut}` : undefined,
    dexCombo: input.dexBuy && input.dexSell ? `${input.dexBuy}->${input.dexSell}` : undefined,
    ...(input.details ?? {}),
  });
}
