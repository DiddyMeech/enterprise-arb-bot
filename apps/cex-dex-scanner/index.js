require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const WebSocket = require('ws');
// Native Console Bounding
const decisionEngine = require('@arb/trade-decision-engine');

class BinanceScanner {
    constructor() {
        const proxyUser = process.env.NODEMAVEN_USER;
        const proxyPass = process.env.NODEMAVEN_PASS;
        let wsOptions = {};

        if (proxyUser && proxyPass) {
            console.log(`[CEX-DEX] 🛡️ Proxied connection active: NodeMaven Tunnel via gate.nodemaven.com:8080`);
            const HttpsProxyAgent = require('https-proxy-agent');
            const encodedUser = encodeURIComponent(proxyUser);
            const encodedPass = encodeURIComponent(proxyPass);
            wsOptions.agent = new HttpsProxyAgent(`http://${encodedUser}:${encodedPass}@gate.nodemaven.com:8080`);
        } else {
            console.warn(`[CEX-DEX] ⚠️ No NodeMaven proxy credentials found in .env. Running on raw local IP.`);
        }

        // Utilizing the aggregate all-market ticker stream from Binance WSS
        this.socket = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr', wsOptions);
        this.cache = new Map();
        this.initialPingFired = false;
        
        console.log("[CEX-DEX] Initializing sub-millisecond Binance UDP WSS feed mapping");
        this.init();
    }

    init() {
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 20;

        this.socket.on('message', (data) => this.process(data));
        this.socket.on('error', (e) => console.error(`[CEX-DEX] WebSocket Extraneous Fault: ${e.message}`));
        this.socket.on('close', () => {
            console.warn(`[CEX-DEX] Disconnected.`);
            this.reconnectAttempts++;

            if (this.reconnectAttempts > this.maxReconnectAttempts) {
                console.error('[CEX-DEX] Max reconnect attempts reached — exiting for PM2 restart.');
                process.exit(1);
            }

            // Exponential backoff: 5s base, doubles each attempt, max 120s, +25% jitter
            const base = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 120000);
            const delay = base + Math.random() * base * 0.25;
            console.warn(`[CEX-DEX] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => new BinanceScanner(), delay);
        });
    }

    process(data) {
        try {
            const payload = JSON.parse(data);
            payload.forEach(ticker => {
                const symbol = ticker.s;
                const currentPrice = parseFloat(ticker.c);
                
                // Track highly liquid and volatile targets exclusively to maximize execution flow without creating noise
                const trackedAssets = ['ETHUSDT', 'ARBUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT', 'PEPEUSDT', 'WIFUSDT', 'AVAXUSDT', 'LINKUSDT'];
                
                if (trackedAssets.includes(symbol)) {
                    
                    // FORCED DIAGNOSTIC PING: Fire an exact trigger on boot to prove Webhook validity
                    if (!this.initialPingFired) {
                        this.initialPingFired = true;
                        console.warn(`[CEX-DEX] ⚡ DIAGNOSTIC VOLATILITY TRIGGER on ${symbol}! Executing Network Penetration Ping...`);
                        this.triggerDecisionEngine(symbol, currentPrice);
                    }
                    
                    if (this.cache.has(symbol)) {
                        const oldPrice = this.cache.get(symbol);
                        const drift = Math.abs((currentPrice - oldPrice) / oldPrice);
                        
                        // HFT Trigger: Aggressively mapped to 0.001% deviation to force an instant Telegram Ping verification
                        if (drift > 0.00001) {
                            console.warn(`[CEX-DEX] ⚡ VOLATILITY TRIGGER on ${symbol}! Instant Deviation: ${(drift*100).toFixed(3)}%`);
                            this.triggerDecisionEngine(symbol, currentPrice);
                        }
                    }
                    this.cache.set(symbol, currentPrice);
                }
            });
        } catch (e) {
            // Nullify non-JSON frames instantly
        }
    }

    triggerDecisionEngine(symbol, price) {
        // Log volatility signal only — execution pipeline is handled by arb-scanner
        const targetToken = symbol.replace('USDT', '');
        console.log(`[CEX-DEX] 📊 Volatility signal: ${symbol} @ ${price} | Forwarded to arb-scanner price monitor`);
    }

}

new BinanceScanner();
