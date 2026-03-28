CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain VARCHAR(50) NOT NULL,
    dex_combo VARCHAR(100) NOT NULL,
    token_in VARCHAR(42) NOT NULL,
    token_out VARCHAR(42) NOT NULL,
    expected_profit_usd DECIMAL(10, 2),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID REFERENCES opportunities(id),
    tx_hash VARCHAR(66) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    actual_profit_usd DECIMAL(10, 2),
    gas_used_usd DECIMAL(10, 2),
    latency_ms INTEGER,
    status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'REVERTED', 'PENDING'
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE failures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID REFERENCES trades(id),
    reason TEXT NOT NULL,
    slippage_hit BOOLEAN,
    front_run BOOLEAN,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE strategy_metrics (
    id SERIAL PRIMARY KEY,
    pair VARCHAR(100) NOT NULL,
    dex_combo VARCHAR(100) NOT NULL,
    win_rate DECIMAL(5, 2) DEFAULT 0.0,
    avg_profit_usd DECIMAL(10, 2) DEFAULT 0.0,
    failures_last_24h INTEGER DEFAULT 0,
    banned BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
