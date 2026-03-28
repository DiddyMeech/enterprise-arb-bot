const Joi = require('joi');

const chainConfigSchema = Joi.object({
    enabled: Joi.boolean().required(),
    baseline_trade_size_usd: Joi.number().min(0).required(),
    min_net_profit_usd: Joi.number().min(0).required(),
    target_net_profit_usd: Joi.number().min(0).required(),
    max_gas_share_of_profit: Joi.number().min(0).max(1).required(),
    max_slippage_bps: Joi.number().min(0).max(10000).required(),
    max_quote_age_ms: Joi.number().min(0).required(),
    max_price_impact_bps: Joi.number().min(0).max(10000).required(),
    max_route_hops: Joi.number().min(1).max(5).required(),
    provider_divergence_bps: Joi.number().min(0).required(),
    pool_min_age_hours: Joi.number().min(0).required(),
    daily_loss_cap_usd: Joi.number().min(0).required(),
    daily_gas_burn_cap_usd: Joi.number().min(0).required(),
    consecutive_fail_pause_count: Joi.number().min(1).required(),
    baseline_score_threshold: Joi.number().min(0).max(1).required(),
    score_small_threshold: Joi.number().min(0).max(1).required(),
    score_medium_threshold: Joi.number().min(0).max(1).required(),
    score_full_threshold: Joi.number().min(0).max(1).required()
});

const riskPolicySchema = Joi.object({
    version: Joi.number().required(),
    mode: Joi.object({
        bot_mode: Joi.string().valid('SAFE', 'LIVE').required(),
        execution_enabled: Joi.boolean().required(),
        allow_live_broadcast: Joi.boolean().required()
    }).required(),
    chains: Joi.object().pattern(Joi.string(), chainConfigSchema).required(),
    tokens: Joi.object({
        allowlist: Joi.array().items(Joi.string()).required()
    }).required(),
    pairs: Joi.object({
        approved: Joi.array().items(Joi.string()).required()
    }).required(),
    risk: Joi.object({
        min_profit_floor_usd: Joi.number().min(0).required(),
        target_profit_floor_usd: Joi.number().min(0).required(),
        max_route_hops: Joi.number().min(1).max(5).required(),
        max_provider_divergence_bps: Joi.number().min(0).required(),
        max_quote_to_fill_drift_bps: Joi.number().min(0).required(),
        max_slippage_bps: Joi.number().min(0).max(10000).required(),
        max_price_impact_bps: Joi.number().min(0).max(10000).required(),
        max_gas_share_of_profit: Joi.number().min(0).max(1).required(),
        pool_min_age_hours: Joi.number().min(0).required(),
        route_blacklist_failures_short_window: Joi.number().min(1).required(),
        route_blacklist_failures_long_window: Joi.number().min(1).required(),
        blacklist_short_minutes: Joi.number().min(1).required(),
        blacklist_medium_minutes: Joi.number().min(1).required(),
        blacklist_long_minutes: Joi.number().min(1).required()
    }).required(),
    sizing: Joi.object({
        tiny_multiplier: Joi.number().min(0).max(1).required(),
        small_multiplier: Joi.number().min(0).max(1).required(),
        medium_multiplier: Joi.number().min(0).max(1).required(),
        full_multiplier: Joi.number().min(0).max(1).required(),
        scale_up_requires_realized_wins: Joi.boolean().required(),
        immediate_scale_down_on_instability: Joi.boolean().required()
    }).required(),
    learning: Joi.object({
        enabled: Joi.boolean().required(),
        min_samples_for_route_confidence: Joi.number().min(1).required(),
        min_samples_for_pair_confidence: Joi.number().min(1).required(),
        daily_adjustment_enabled: Joi.boolean().required(),
        max_daily_profit_threshold_adjustment_pct: Joi.number().min(0).max(1).required(),
        max_daily_size_adjustment_pct: Joi.number().min(0).max(1).required(),
        max_daily_slippage_adjustment_bps: Joi.number().min(0).required(),
        max_daily_quote_age_adjustment_ms: Joi.number().min(0).required()
    }).required(),
    tuning: Joi.object({
        run_every_hours: Joi.number().min(1).required(),
        require_operator_approval_for_live_policy_changes: Joi.boolean().required(),
        export_report: Joi.boolean().required()
    }).required(),
    execution: Joi.object({
        require_simulation_success: Joi.boolean().required(),
        require_policy_pass: Joi.boolean().required(),
        require_route_score_pass: Joi.boolean().required(),
        submit_only_if_live_mode_enabled: Joi.boolean().required()
    }).required()
});

module.exports = { riskPolicySchema };
