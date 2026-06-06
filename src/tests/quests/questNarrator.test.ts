import { describe, it, expect, vi } from "vitest";
import {
  TemplateQuestNarrator,
  OnnxQuestNarrator,
  type NarratorContext,
} from "@/ai/adapters/QuestNarrator";

const CTX: NarratorContext = {
  role: "Пилот",
  tone: "Нейтральный",
  systemName: "Солнечная",
  daysSinceStart: 5,
};

const ALL_SAMPLE_KEYS = [
  "secret_cargo.intro",
  "secret_cargo.dilemma",
  "secret_cargo.inspect",
  "secret_cargo.deliver",
  "secret_cargo.refuse",
  "drifting_ship.scan",
  "drifting_ship.board",
  "drifting_ship.rescue",
  "drifting_ship.loot",
  "drifting_ship.report",
];

describe("TemplateQuestNarrator", () => {
  const narrator = new TemplateQuestNarrator();

  it("returns a non-empty string for every sample quest node key", async () => {
    for (const key of ALL_SAMPLE_KEYS) {
      const result = await narrator.narrate(key, CTX);
      expect(result.length).toBeGreaterThan(10);
    }
  });

  it("substitutes systemName into templates that use it", async () => {
    const result = await narrator.narrate("secret_cargo.intro", CTX);
    expect(result).toContain("Солнечная");
  });

  it("substitutes daysSinceStart into templates that use it", async () => {
    const result = await narrator.narrate("drifting_ship.scan", CTX);
    expect(result).toContain("5");
  });

  it("returns a fallback string for an unknown key", async () => {
    const result = await narrator.narrate("unknown.key", CTX);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("OnnxQuestNarrator — fallback when ONNX rejects", () => {
  it("falls back to template when loadModel throws", async () => {
    const fakeRegistry = {
      loadModel: vi.fn().mockRejectedValue(new Error("model not found")),
      infer: vi.fn(),
    };
    const narrator = new OnnxQuestNarrator(fakeRegistry as any);
    const result = await narrator.narrate("secret_cargo.intro", CTX);
    expect(result.length).toBeGreaterThan(10);
    expect(fakeRegistry.infer).not.toHaveBeenCalled();
  });

  it("falls back to template when infer rejects", async () => {
    const fakeRegistry = {
      loadModel: vi.fn().mockResolvedValue({}),
      infer: vi.fn().mockRejectedValue(new Error("inference timeout")),
    };
    const narrator = new OnnxQuestNarrator(fakeRegistry as any);
    const result = await narrator.narrate("drifting_ship.scan", CTX);
    expect(result.length).toBeGreaterThan(10);
  });

  it("falls back to template when infer returns short garbage output", async () => {
    const { Tensor } = await import("onnxruntime-web");
    const fakeRegistry = {
      loadModel: vi.fn().mockResolvedValue({}),
      infer: vi
        .fn()
        .mockResolvedValue(
          new Tensor("float32", new Float32Array([1]), [1, 1]),
        ),
    };
    const narrator = new OnnxQuestNarrator(fakeRegistry as any);
    const result = await narrator.narrate("secret_cargo.dilemma", CTX);
    // Output of length <= 20 triggers fallback, so result should be from template
    expect(result.length).toBeGreaterThan(20);
  });
});
