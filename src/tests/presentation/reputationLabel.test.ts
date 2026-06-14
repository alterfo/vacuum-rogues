import { describe, it, expect } from "vitest";
import { getRepLabel, getRepColor } from "@/utils/reputationUtils";

describe("getRepLabel — 5-tier scale", () => {
  it("returns Нейтральный at -10", () => {
    expect(getRepLabel(-10)).toBe("Нейтральный");
  });

  it("returns Недовольный at -25", () => {
    expect(getRepLabel(-25)).toBe("Недовольный");
  });

  it("returns Недовольный at -35", () => {
    expect(getRepLabel(-35)).toBe("Недовольный");
  });

  it("returns Враждебный at -75", () => {
    expect(getRepLabel(-75)).toBe("Враждебный");
  });

  it("returns Нейтральный at exactly -20 (boundary)", () => {
    expect(getRepLabel(-20)).toBe("Нейтральный");
  });

  it("returns Недовольный at -21", () => {
    expect(getRepLabel(-21)).toBe("Недовольный");
  });

  it("returns Недовольный at exactly -50", () => {
    expect(getRepLabel(-50)).toBe("Недовольный");
  });

  it("returns Враждебный at -51", () => {
    expect(getRepLabel(-51)).toBe("Враждебный");
  });

  it("returns Дружелюбный at 10", () => {
    expect(getRepLabel(10)).toBe("Дружелюбный");
  });

  it("returns Союзник at 50", () => {
    expect(getRepLabel(50)).toBe("Союзник");
  });
});

describe("getRepColor — matches label tiers", () => {
  it("displeased range is pink", () => {
    expect(getRepColor(-25)).toBe(0xff8888);
    expect(getRepColor(-50)).toBe(0xff8888);
  });

  it("hostile range is red", () => {
    expect(getRepColor(-75)).toBe(0xff2222);
  });

  it("neutral range is grey", () => {
    expect(getRepColor(-10)).toBe(0xaaaaaa);
  });

  it("ally range is green", () => {
    expect(getRepColor(20)).toBe(0x88ff88);
    expect(getRepColor(100)).toBe(0x00ff88);
  });
});
