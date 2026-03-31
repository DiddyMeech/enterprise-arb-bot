module.exports = {
  apps: [
    {
      name: "titan-arb-bot",
      script: "scripts/dry-run-flash-sim.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      // No env overrides here — all config comes from .env
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "arb-scanner",
      script: "apps/scanner/index.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "arb-executor",
      script: "npm",
      args: "run start:executor",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "arb-simulator",
      script: "npm",
      args: "run start:simulator",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "arb-learner",
      script: "apps/learner/index.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "arb-overseer",
      script: "apps/overseer/index.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "arb-dashboard",
      script: "apps/dashboard/index.js",
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // CEX-DEX scanner: disabled until Binance 451 IP block is resolved
      // (DigitalOcean IPs are blocked by Binance without a proxy)
      // Re-enable by adding NODEMAVEN_USER / NODEMAVEN_PASS to .env
      name: "arb-cex-dex-scanner",
      script: "apps/cex-dex-scanner/index.js",
      interpreter: "node",
      autorestart: false,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        CEX_DEX_DISABLED: "true",
      },
    },
    {
      // Spatial scanner: deactivated (Phase 13 LayerZero not yet implemented)
      name: "arb-spatial-scanner",
      script: "apps/spatial-scanner/index.js",
      interpreter: "node",
      autorestart: false,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
