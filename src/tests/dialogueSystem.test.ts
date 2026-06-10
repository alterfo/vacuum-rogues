import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DialogueSystem,
  T5DialogueAdapter,
  GRUEmotionAdapter,
  type DialogueAnchorRegistry,
  type DialogueAnchorNode,
} from "@/systems/DialogueSystem";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import type { ONNXModelRegistry } from "@/ai/ONNXModelRegistry";
import type { DialogueSession } from "@/domain/DialogueSession";
import type { Player } from "@/domain/Player";
import type { NPC } from "@/domain/NPC";

const openingAnchor: DialogueAnchorNode = {
  id: "opening",
  template: "Приветствую, странник.",
  options: [],
};

const anchorRegistry: DialogueAnchorRegistry = {
  getOpeningAnchor: () => openingAnchor,
  getNextAnchors: () => [],
};

function makeSystem(): DialogueSystem {
  const registry = null as unknown as ONNXModelRegistry;
  return new DialogueSystem(
    anchorRegistry,
    new T5DialogueAdapter(registry),
    new GRUEmotionAdapter(registry),
    new AdaptiveQualityProfile(),
  );
}

function sessionMap(system: DialogueSystem): Map<string, DialogueSession> {
  return (system as unknown as { sessionHistory: Map<string, DialogueSession> })
    .sessionHistory;
}

const npc: NPC = { id: "npc_trader_01", name: "Торговец Зум" };

const player = {
  reputation: {} as Record<string, number>,
  adjustReputation: vi.fn(),
} as unknown as Player;

describe("DialogueSystem session map growth (F7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays bounded at ≤ 2 entries per NPC across repeated dialogues", () => {
    const system = makeSystem();

    for (let i = 0; i < 10; i++) {
      system.startDialogue(player, npc);
      // Each call gets a distinct timestamped session id.
      vi.advanceTimersByTime(1000);
    }

    // One live timestamped session + one npc.id alias — stale sessions deleted.
    expect(sessionMap(system).size).toBeLessThanOrEqual(2);
  });

  it("keeps the latest session reachable by both its id and npc.id", () => {
    const system = makeSystem();

    system.startDialogue(player, npc);
    vi.advanceTimersByTime(1000);
    const latest = system.startDialogue(player, npc);

    expect(sessionMap(system).get(latest.id)).toBe(latest);
    expect(sessionMap(system).get(npc.id)).toBe(latest);
  });

  it("still restores history from the previous session", () => {
    const system = makeSystem();

    const first = system.startDialogue(player, npc);
    first.sendPlayerMessage("Как дела на станции?");
    vi.advanceTimersByTime(1000);

    const second = system.startDialogue(player, npc);
    const texts = second.history.map((m) => m.text);
    expect(texts).toContain("Приветствую, странник.");
    expect(texts).toContain("Как дела на станции?");
  });
});
