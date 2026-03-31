require('dotenv').config();
const { simulate } = require('../apps/simulator');

async function runSoak() {
  console.log("Starting 100-iteration Paper Soak...");
  for (let i = 0; i < 100; i++) {
    // Suppress console.error locally so we don't spam terminal
    const origError = console.error;
    console.error = () => {};

    try {
      const result = await simulate({
        chainKey: process.env.ACTIVE_DEPLOY_CHAIN || 'polygon',
        amountInUsd: Number(process.env.DRY_RUN_USD || '5'),
        nativeTokenUsd: 2200
      });
      process.stdout.write(`Run ${i+1}/100 Completed.\n`);
    } finally {
      console.error = origError;
    }
  }
  console.log("\nSoak test completed.");
}

runSoak().catch(console.error);
