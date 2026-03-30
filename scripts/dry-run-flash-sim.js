require('dotenv').config();
const { simulate } = require('../apps/simulator');

async function main() {
  const chainKey = process.env.ACTIVE_DEPLOY_CHAIN || 'polygon';
  const amountInUsd = Number(process.env.DRY_RUN_USD || '25');
  const nativeTokenUsd = Number(process.env.ETH_PRICE_USD_HINT || '2200');

  const result = await simulate({
    chainKey,
    amountInUsd,
    nativeTokenUsd
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[dry-run] fatal', err);
  process.exit(1);
});
