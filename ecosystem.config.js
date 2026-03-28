module.exports = {
  apps: [
    {
      name: "arb-scanner",
      script: "npm",
      args: "run start:scanner",
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-simulator",
      script: "npm",
      args: "run start:simulator",
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-executor",
      script: "npm",
      args: "run start:executor",
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-learner",
      script: "npm",
      args: "run start:learner",
      autorestart: true,
      cron_restart: "0 0 * * *", // Hard reboot memory constraints safely
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-dashboard",
      script: "npm",
      args: "run start:dashboard",
      autorestart: true,
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-cex-dex-scanner",
      script: "npm",
      args: "run start:cex",
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-spatial-scanner",
      script: "npm",
      args: "run start:spatial",
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-frontend",
      script: "npm",
      args: "run dev",
      cwd: "./apps/frontend",
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: "production" }
    },
    {
      name: "arb-overseer",
      script: "npm",
      args: "run start:overseer",
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: "production" }
    }
  ]
};
