const winston = require('winston');

// A structured telemetry logger designed to pipe structured metrics 
// out to the coordination dashboard and trigger learning engine alerts.
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json() // JSON format for strict parsing by external analysis tools
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
                    return `[${timestamp}] ${level}: ${message} ${metaString}`;
                })
            )
        }),
        new winston.transports.File({ filename: '../../logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: '../../logs/combined.log' })
    ]
});

// We expose a metric registry for Prometheus reporting scaling
class MetricsRegistry {
    constructor() {
        this.counters = new Map();
    }
    
    increment(metricName, value = 1) {
        const current = this.counters.get(metricName) || 0;
        this.counters.set(metricName, current + value);
        logger.debug(`Metric Tracked: ${metricName}=${current + value}`);
    }
    
    getMetrics() {
        return Object.fromEntries(this.counters);
    }
}

const metrics = new MetricsRegistry();

module.exports = { logger, metrics };
