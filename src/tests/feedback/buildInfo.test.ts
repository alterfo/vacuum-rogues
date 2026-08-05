import { describe, it, expect } from "vitest";
import { buildInfo, formatBuildLine } from "@/systems/feedback/buildInfo";

describe("buildInfo", () => {
  it('formats an injected version + sha as "v<version> (<sha>)"', () => {
    expect(formatBuildLine({ version: "1.2.3", sha: "abc1234" })).toBe(
      "v1.2.3 (abc1234)",
    );
  });

  it('formats the dev fallback when both fields are "dev"', () => {
    expect(formatBuildLine({ version: "dev", sha: "dev" })).toBe("vdev (dev)");
  });

  it("reads live build globals via the guard (version defined, sha falls back to dev)", () => {
    const info = buildInfo();
    expect(info.version).toBe("test");
    expect(info.sha).toBe("dev");
  });

  it("default formatBuildLine() composes from the live globals", () => {
    expect(formatBuildLine()).toBe("vtest (dev)");
  });
});
