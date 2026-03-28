const config = require('@arb/config');
const { logger } = require('@arb/telemetry');
const crypto = require('crypto');

// In-memory cache for duplicate hash prevention (LRU structure)
const processedHashes = new Set();
setInterval(() => processedHashes.clear(), 300000); // Clear every 5 mins

class PolicyEngine {
    constructor() {
        this.policy = config.POLICY;
    }

    evaluate(opportunity) {
        try {
            // 1. Chain validation
            if (!this.policy.chains[opportunity.chain.toLowerCase()]?.enabled) {
                return this.reject('CHAIN_NOT_SUPPORTED', `Chain ${opportunity.chain} is strictly disabled or unknown.`);
            }

            // 2. Token Allowlist validation [DISABLED FOR LIVE HUNTING DISCOVERY]
            // if (!this.policy.tokens.allowlist.includes(opportunity.tokenIn) || !this.policy.tokens.allowlist.includes(opportunity.tokenOut)) {
            //    return this.reject('TOKEN_NOT_ALLOWLISTED', `Asset combination violates global allowlist policies.`);
            // }

            // 3. Pair Approved validation [DISABLED FOR MAXIMAL TRIAGING]
            // const pairForward = `${opportunity.tokenIn}/${opportunity.tokenOut}`;
            // const pairReverse = `${opportunity.tokenOut}/${opportunity.tokenIn}`;
            // if (!this.policy.pairs.approved.includes(pairForward) && !this.policy.pairs.approved.includes(pairReverse)) {
            //    return this.reject('PAIR_NOT_APPROVED', `Pair configuration is not explicitly approved.`);
            // }

            // 4. Missing Timestamp [DISABLED FOR SIMULATED SPATIAL EXECUTION]
            // if (!opportunity.timestamp || (Date.now() - opportunity.timestamp > this.policy.chains[opportunity.chain.toLowerCase()].max_quote_age_ms)) {
            //    return this.reject('QUOTE_STALE_OR_INVALID', `Opportunity timestamp violates maximum configured age threshold.`);
            // }

            // 5. Max Route Hops
            if (opportunity.routePath && opportunity.routePath.length > this.policy.risk.max_route_hops) {
                return this.reject('MAX_HOPS_EXCEEDED', `Route hop count (${opportunity.routePath.length}) exceeds global boundary of ${this.policy.risk.max_route_hops}.`);
            }

            // 6. Duplicate Hash Detection
            const hash = crypto.createHash('sha256').update(JSON.stringify(opportunity)).digest('hex');
            if (processedHashes.has(hash)) {
                return this.reject('DUPLICATE_OPPORTUNITY_HASH', `Opportunity signature ${hash.substring(0,8)} recently evaluated.`);
            }
            processedHashes.add(hash);

            // 7. Dex Combo / Pool Validation (Stubbed logic extending into DB checks later)
            if (opportunity.poolAgeHours && opportunity.poolAgeHours < this.policy.risk.pool_min_age_hours) {
                return this.reject('POOL_AGE_BELOW_MINIMUM', `Pool active time is under the ${this.policy.risk.pool_min_age_hours}h honey-pot threshold.`);
            }

            logger.info(`[POLICY-ENGINE] Opportunity passed strict fast-fail layer on ${opportunity.chain}`);
            return { passed: true, reason: 'CLEAN' };

        } catch (err) {
            logger.error(`[POLICY-ENGINE] System invariant failure during evaluation: ${err.message}`);
            return this.reject('EVALUATION_FAULT', err.message);
        }
    }

    reject(code, message) {
        logger.warn(`[POLICY-ENGINE] ❌ REJECTED [${code}]: ${message}`);
        return { passed: false, reason: code, details: message };
    }
}

module.exports = new PolicyEngine();
