
import { describe, it, expect } from "vitest";
import { exportDataset } from "./exportDataset.run";

describe("Large-scale BC dataset export", () => {
  it("collects and exports a large dataset for training", async () => {
    await exportDataset();
  }, 120000); // 2 minute timeout for large dataset
});
