-- Phase 2 Advanced Telemetry & Auto-Tuning Migrations
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Decisions Engine Registry (Tracks ALL 13-Stage Gates)
CREATE TABLE IF NOT EXISTS decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID NOT NULL,
    chain VARCHAR(50) NOT NULL,
    route_signature VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'ACCEPTED', 'REJECTED_POLICY', 'REJECTED_LIQUIDITY', 'REJECTED_RISK'
    reason TEXT,
    config_version INTEGER NOT NULL,
    route_score DECIMAL(5, 4),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Full Simulations Cache
CREATE TABLE IF NOT EXISTS simulations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_id UUID REFERENCES decisions(id),
    chain VARCHAR(50) NOT NULL,
    route_signature VARCHAR(255) NOT NULL,
    expected_gross_profit_usd DECIMAL(12, 4),
    expected_net_profit_usd DECIMAL(12, 4),
    gas_estimate_usd DECIMAL(10, 4),
    relayer_estimate_usd DECIMAL(10, 4),
    slippage_estimate_bps INTEGER,
    status VARCHAR(50), -- 'SUCCESS', 'REVERTED_CALLSTATIC'
    revert_reason TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Active MEV Executions
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    simulation_id UUID REFERENCES simulations(id),
    chain VARCHAR(50) NOT NULL,
    route_signature VARCHAR(255) NOT NULL,
    execution_path VARCHAR(100), -- 'FLASHBOTS', 'BLOXROUTE'
    payload_size VARCHAR(50), -- 'TINY', 'SMALL', 'MEDIUM', 'FULL'
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Post-Execution Actuals (learning telemetry)
CREATE TABLE IF NOT EXISTS execution_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID REFERENCES executions(id),
    chain VARCHAR(50) NOT NULL,
    route_signature VARCHAR(255) NOT NULL,
    actual_net_profit_usd DECIMAL(12, 4),
    actual_gas_paid_usd DECIMAL(10, 4),
    actual_relayer_paid_usd DECIMAL(10, 4),
    realized_slippage_bps INTEGER,
    latency_to_inclusion_ms INTEGER,
    quote_to_fill_drift_bps INTEGER,
    status VARCHAR(50), -- 'WIN', 'LOSS', 'REVERTED', 'MISSED'
    revert_reason TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Aggregated Granular Metrics
CREATE TABLE IF NOT EXISTS route_metrics (
    route_signature VARCHAR(255) PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    dex_combo VARCHAR(100) NOT NULL,
    win_rate DECIMAL(5, 4) DEFAULT 0.0,
    revert_rate DECIMAL(5, 4) DEFAULT 0.0,
    avg_net_profit_usd DECIMAL(12, 4) DEFAULT 0.0,
    avg_quote_drift_bps DECIMAL(8, 2) DEFAULT 0.0,
    avg_latency_ms INTEGER DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    current_score DECIMAL(5, 4) DEFAULT 0.50,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pair_metrics (
    pair VARCHAR(100) PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    stability_score DECIMAL(5, 4) DEFAULT 1.0,
    total_trades INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dex_combo_metrics (
    dex_combo VARCHAR(100) PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    reliability_score DECIMAL(5, 4) DEFAULT 1.0,
    total_trades INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chain_metrics (
    chain VARCHAR(50) PRIMARY KEY,
    congestion_loss_rate DECIMAL(5, 4) DEFAULT 0.0,
    current_health_score DECIMAL(5, 4) DEFAULT 1.0
);

-- Automated Enforcement Logic
CREATE TABLE IF NOT EXISTS blacklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL, -- 'ROUTE', 'PAIR', 'DEX_COMBO'
    entity_value VARCHAR(255) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    ban_level VARCHAR(50), -- 'SOFT', 'MEDIUM', 'HARD'
    reason TEXT,
    expires_at TIMESTAMP NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pause_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain VARCHAR(50),
    scope VARCHAR(50), -- 'GLOBAL', 'CHAIN', 'ROUTE'
    trigger_reason TEXT NOT NULL,
    circuit_breaker_type VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auto-Tuner Audit Trails
CREATE TABLE IF NOT EXISTS tuning_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    chains_analyzed INTEGER,
    routes_analyzed INTEGER,
    action_count INTEGER
);

CREATE TABLE IF NOT EXISTS tuning_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tuning_run_id UUID REFERENCES tuning_runs(id),
    parameter_name VARCHAR(100) NOT NULL,
    chain VARCHAR(50),
    old_value VARCHAR(255),
    new_value VARCHAR(255),
    reason TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hourly_performance (
    id SERIAL PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    hour_of_day INTEGER NOT NULL,
    net_profit_usd DECIMAL(12, 4) DEFAULT 0.0,
    total_trades INTEGER DEFAULT 0,
    win_rate DECIMAL(5, 4) DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS daily_performance (
    date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
    net_profit_usd DECIMAL(12, 4) DEFAULT 0.0,
    gross_profit_usd DECIMAL(12, 4) DEFAULT 0.0,
    gas_spent_usd DECIMAL(12, 4) DEFAULT 0.0,
    relayer_spent_usd DECIMAL(12, 4) DEFAULT 0.0,
    total_trades INTEGER DEFAULT 0
);
