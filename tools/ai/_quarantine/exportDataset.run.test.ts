
import { collectBcDataset, bcDatasetToJsonl, writeBcDataset } from "./exportBcData";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function exportDataset(): Promise<void> {
  const SESSIONS = 20;  // K sessions
  const STEPS = 100;    // N steps per session
  const SEED_PREFIX = "BC-LARGE";
  
  console.log(`\n🚀 Collecting BC dataset: ${SESSIONS} sessions × ${STEPS} steps = ${SESSIONS * STEPS} examples`);
  
  const rows = await collectBcDataset({
    sessions: SESSIONS,
    steps: STEPS,
    seedPrefix: SEED_PREFIX,
    policy: () => new MemoryHeuristicPolicy(),
  });
  
  console.log(`\n📊 Collected ${rows.length} training examples`);
  
  const actionCounts = new Map<number, number>();
  for (const row of rows) {
    actionCounts.set(row.action, (actionCounts.get(row.action) ?? 0) + 1);
  }
  
  console.log("\n📈 Action distribution:");
  const ACTION_NAMES = ["move", "warp", "land", "dock", "trade", "take-quest", "attack", "flee", "repair", "wait"];
  for (let i = 0; i < ACTION_NAMES.length; i++) {
    const count = actionCounts.get(i) ?? 0;
    const pct = rows.length > 0 ? (count / rows.length * 100).toFixed(1) : "0.0";
    console.log(`  ${ACTION_NAMES[i].padEnd(12)}: ${count.toString().padStart(5)} (${pct}%)`);
  }
  
  const featureWidth = rows[0]?.features.length ?? 0;
  console.log(`\n📐 Feature vector width: ${featureWidth}`);
  console.log(`   - Observation features: 12`);
  console.log(`   - Memory features: 6`);
  console.log(`   - Total: 18`);
  
  let minFeature = Infinity;
  let maxFeature = -Infinity;
  for (const row of rows) {
    for (const f of row.features) {
      if (f < minFeature) minFeature = f;
      if (f > maxFeature) maxFeature = f;
    }
  }
  console.log(`\n📏 Feature value range: [${minFeature.toFixed(4)}, ${maxFeature.toFixed(4)}]`);
  console.log(`   Expected: [0, 1]`);
  
  const jsonl = bcDatasetToJsonl(rows);
  const written = writeBcDataset(rows, ".letsplay", "bc-dataset-large.jsonl");
  
  console.log(`\n💾 Dataset saved to: ${written.path}`);
  console.log(`   File size: ${(jsonl.length / 1024).toFixed(1)} KB`);
  
  const summary = {
    totalRows: rows.length,
    sessions: SESSIONS,
    stepsPerSession: STEPS,
    featureWidth,
    actionDistribution: Object.fromEntries(actionCounts),
    featureRange: { min: minFeature, max: maxFeature },
    seedPrefix: SEED_PREFIX,
    timestamp: new Date().toISOString(),
  };
  
  const summaryPath = join(".letsplay", "bc-dataset-large-summary.json");
  mkdirSync(".letsplay", { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`\n📋 Summary saved to: ${summaryPath}`);
  
  console.log("\n✅ Dataset export complete!");
  console.log(`\n🐍 Next step: train the model with:`);
  console.log(`   python3 tools/ai/train_player.py \\`);
  console.log(`     --data .letsplay/bc-dataset-large.jsonl \\`);
  console.log(`     --out src/tests/playtest/letsplay/weights/player.weights.json \\`);
  console.log(`     --hidden 32 --epochs 200 --seed 0`);
}

export { exportDataset };

import { it } from "vitest";

it("exports large BC dataset for training", async () => {
  await exportDataset();
}, 180000); // 3 minute timeout
