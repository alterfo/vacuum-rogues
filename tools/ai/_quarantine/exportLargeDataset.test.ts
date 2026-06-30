/**
 * Large-scale BC dataset exporter for training the neural player policy.
 * 
 * Usage:
 *   npx vitest run src/tests/playtest/letsplay/exportLargeDataset.test.ts
 * 
 * This will:
 * 1. Play K sessions × N steps with the MemoryHeuristicPolicy teacher
 * 2. Export the dataset to .letsplay/bc-dataset-large.jsonl
 * 3. Print statistics about the collected data
 */

import { describe, it, expect } from "vitest";
import { exportDataset } from "./exportDataset.run";

describe("Large-scale BC dataset export", () => {
  it("collects and exports a large dataset for training", async () => {
    await exportDataset();
  }, 120000); // 2 minute timeout for large dataset
});
