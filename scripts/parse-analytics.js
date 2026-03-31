const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logFile = path.resolve(__dirname, '../runtime/paper-trades.jsonl');

async function parseLogs() {
  if (!fs.existsSync(logFile)) {
    console.log("No paper-trades.jsonl found.");
    return;
  }

  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let totalSummaryRuns = 0;
  let wouldSendCount = 0;

  const bucketCounts = {
    strong_candidate: 0,
    candidate: 0,
    near_miss: 0,
    reject: 0
  };

  const familyStats = new Map();

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      // Track the distribution natively output by the engine loop
      if (entry.type === "paper-summary" && entry.summary) {
        totalSummaryRuns++;
        bucketCounts.strong_candidate += (entry.summary.strong_candidate || 0);
        bucketCounts.candidate += (entry.summary.candidate || 0);
        bucketCounts.near_miss += (entry.summary.near_miss || 0);
        bucketCounts.reject += (entry.summary.reject || 0);
      }

      if (entry.type === "would-send" && entry.status === "WOULD_SEND_OK") {
         wouldSendCount++;
      }

      if (entry.type === "family-analytics") {
        const family = entry.summary?.topFamily;
        if (family) {
           familyStats.set(family.familyKey, family);
        }
      }

    } catch (e) {}
  }

  const families = [...familyStats.values()];
  const topScores = [...families].sort((a, b) => (b.avgScore || -999999) - (a.avgScore || -999999)).slice(0, 10);
  const topDrift = [...families].filter(f => f.avgDriftPct > 0) // discard empty/0-drift placeholders
                                .sort((a, b) => (a.avgDriftPct || 9999) - (b.avgDriftPct || 9999))
                                .slice(0, 10);

  console.log("=== PAPER ANALYTICS SUMMARY ===");
  console.log(`Total Simulation Returns: ${totalSummaryRuns}`);
  console.log(`Total Valid 'would-send' Payloads Generated: ${wouldSendCount}\n`);

  console.log("--- BUCKET DISTRIBUTION ---");
  console.log(`- strong_candidate: ${bucketCounts.strong_candidate}`);
  console.log(`- candidate:        ${bucketCounts.candidate}`);
  console.log(`- near_miss:        ${bucketCounts.near_miss}`);
  console.log(`- reject:           ${bucketCounts.reject}\n`);

  console.log("--- TOP 10 FAMILIES BY SCORE ---");
  if (topScores.length === 0) console.log("  (No families tracked yet)");
  topScores.forEach((f, i) => {
    console.log(`${i+1}. [${f.dominantBucket}] Score: ${f.avgScore?.toFixed(4)}, Drift: ${(f.avgDriftPct*100)?.toFixed(2)}% | ${f.familyKey}`);
  });

  console.log("\n--- TOP 10 FAMILIES BY LOWEST (NON-ZERO) DRIFT ---");
  if (topDrift.length === 0) console.log("  (No families tracked yet)");
  topDrift.forEach((f, i) => {
    console.log(`${i+1}. [${f.dominantBucket}] Drift: ${(f.avgDriftPct*100)?.toFixed(2)}%, Score: ${f.avgScore?.toFixed(4)} | ${f.familyKey}`);
  });
}

parseLogs().catch(console.error);
