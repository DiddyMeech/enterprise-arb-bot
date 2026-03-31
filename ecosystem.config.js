module.exports = {
  apps: [
    {
      name: "titan-arb-bot",
      script: "scripts/dry-run-flash-sim.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        TRADING_MODE: "paper",
        LIVE_TRADING_ENABLED: "false",
        SEND_TRANSACTIONS: "false",
      },
    },
  ],
};
