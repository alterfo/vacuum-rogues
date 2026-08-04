import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FactionType, NpcRole, NpcState } from "@/types";
import { Faction } from "@/types/faction";
import { NpcShip } from "@/domain/NpcShip";
import { RealEngineHarness } from "../realEngineHarness";
import { observe } from "./observe";

vi.mock("pixi.js", async () => (await import("../pixiStub")).makePixiStub());

function garrisonShip(sys: string, id: string, role = NpcRole.PATROL): NpcShip {
  return new NpcShip({
    id,
    name: "Страж",
    race: FactionType.OUTLANDERS,
    faction: Faction.OVERMIND,
    role,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 1,
    damage: 10,
    currentSystemId: sys,
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("observation — a quiet garrison in a held system is a visible hostile (liberation blocker)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot({ seed: "GARRISON-VIS" });
    await harness.newGame();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("an un-aggroed Overmind garrison ship in a held system appears in obs.hostiles", () => {
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId === sys) n.state = NpcState.DEAD;
    }
    galaxy.overmindSystems = [sys];
    const g = garrisonShip(sys, "garrison-quiet");
    expect(g.hostile).toBe(false);
    galaxy.npcShips.push(g);

    const obs = observe(harness.engine);
    expect(obs.hostiles.map((h) => h.id)).toContain("garrison-quiet");
  });

  it("the same quiet Overmind ship in a NON-held system stays non-hostile (narrow scope)", () => {
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId === sys) n.state = NpcState.DEAD;
    }
    galaxy.overmindSystems = [];
    galaxy.pirateSystems = [];
    galaxy.npcShips.push(garrisonShip(sys, "wanderer-quiet"));

    const obs = observe(harness.engine);
    expect(obs.hostiles.map((h) => h.id)).not.toContain("wanderer-quiet");
  });

  it("a neutral trader inside a held system is NOT flagged (only liberation blockers)", () => {
    const galaxy = harness.galaxy()!;
    const sys = harness.player()!.currentSystemId;
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId === sys) n.state = NpcState.DEAD;
    }
    galaxy.overmindSystems = [sys];
    const trader = new NpcShip({
      id: "trader-bystander",
      name: "Торговец",
      race: FactionType.OUTLANDERS,
      faction: Faction.INDEPENDENT,
      role: NpcRole.TRADER,
      hullHP: 100,
      maxHull: 100,
      shields: 0,
      speed: 1,
      damage: 5,
      currentSystemId: sys,
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 100,
      reputation: 0,
    });
    galaxy.npcShips.push(trader);

    const obs = observe(harness.engine);
    expect(obs.hostiles.map((h) => h.id)).not.toContain("trader-bystander");
  });
});
