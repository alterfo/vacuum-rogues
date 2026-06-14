import { describe, it, expect } from "vitest";
import { getRepLabel, getRepColor } from "@/utils/reputationUtils";

describe("getRepLabel — 5-tier scale", () => {
  it("returns Нейтральный at -10", () => {
    expect(getRepLabel(-10)).toBe("Нейтральный");
  });

  it("returns Враждебный at -25 (boundary: both scenes must agree)", () => {
    expect(getRepLabel(-25)).toBe("Враждебный");
  });

  it("returns Враждебный at -35", () => {
    expect(getRepLabel(-35)).toBe("Враждебный");
  });

  it("returns Война at -75", () => {
    expect(getRepLabel(-75)).toBe("Война");
  });

  it("returns Нейтральный at exactly -20 (boundary)", () => {
    expect(getRepLabel(-20)).toBe("Нейтральный");
  });

  it("returns Враждебный at -21", () => {
    expect(getRepLabel(-21)).toBe("Враждебный");
  });

  it("returns Враждебный at exactly -50", () => {
    expect(getRepLabel(-50)).toBe("Враждебный");
  });

  it("returns Война at -51", () => {
    expect(getRepLabel(-51)).toBe("Война");
  });

  it("returns Дружелюбный at 10", () => {
    expect(getRepLabel(10)).toBe("Дружелюбный");
  });

  it("returns Союзник at 50", () => {
    expect(getRepLabel(50)).toBe("Союзник");
  });
});

describe("getRepColor — matches label tiers", () => {
  it("hostile range is red", () => {
    expect(getRepColor(-25)).toBe(0xff8888);
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
