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

  it("stays bounded per NPC when dialogues with several NPCs interleave", () => {
    const system = makeSystem();
    const other = { id: "npc_pirate_02", name: "Пират Крюк" } as NPC;

    for (let i = 0; i < 10; i++) {
      system.startDialogue(player, npc);
      vi.advanceTimersByTime(1000);
      system.startDialogue(player, other);
      vi.advanceTimersByTime(1000);
    }

    // ≤ 2 entries per NPC (latest session + npc.id alias), and each NPC's
    // alias still points at ITS OWN latest session — a regression that deletes
    // by npc.id instead of previous.id would corrupt one of them.
    expect(sessionMap(system).size).toBeLessThanOrEqual(4);
    expect(sessionMap(system).get(npc.id)!.npc.id).toBe(npc.id);
    expect(sessionMap(system).get(other.id)!.npc.id).toBe(other.id);
  });

  it("stays bounded when two dialogues start in the same millisecond", () => {
    const system = makeSystem();

    // Same timestamp → identical `dlg_<id>_<ts>` session key for both calls.
    system.startDialogue(player, npc);
    const second = system.startDialogue(player, npc);

    expect(sessionMap(system).size).toBeLessThanOrEqual(2);
    expect(sessionMap(system).get(npc.id)).toBe(second);
  });

  it("caps the carried-over history so open/close cycles cannot grow it forever", () => {
    const system = makeSystem();

    // Each startDialogue adds one opening anchor on top of the restored
    // history; without the restore cap this grows by 1 per cycle, unbounded
    // (submitPlayerChoice — the only other prune point — never runs here).
    for (let i = 0; i < 80; i++) {
      system.startDialogue(player, npc);
      vi.advanceTimersByTime(1000);
    }

    const latest = system.startDialogue(player, npc);
    expect(latest.history.length).toBeLessThanOrEqual(51); // 50 restored + anchor
  });
});
