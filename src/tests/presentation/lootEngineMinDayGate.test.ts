import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { LootDropHandler } from "@/presentation/flight/LootDropHandler";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { ROLE_LOADOUT } from "@/systems/npc/NpcSimulator";
import { gearIdForToken } from "@/systems/equipment/GearCatalog";
import { APEX_ENGINE_MIN_DAY } from "@/config/balance";

function makeOvermind(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.OVERMIND,
    role: NpcRole.OVERMIND,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
    loadoutSummary: ROLE_LOADOUT[NpcRole.OVERMIND],
  });
}

function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("LootDropHandler — apex engine loot respects APEX_ENGINE_MIN_DAY", () => {
  it("never drops the eq_engine_v token before the gate day", () => {
    const handler = new LootDropHandler(new Container());
    handler.spawn(
      makeOvermind("ov1"),
      0,
      0,
      seqRng([0.5, 0.9, 0.0]),
      APEX_ENGINE_MIN_DAY - 1,
    );
    expect(handler.spaceLoot.length).toBe(1);
    const moduleId = handler.spaceLoot[0].moduleId;
    expect(moduleId).toBeDefined();
    expect(gearIdForToken(moduleId as string)).not.toBe("eq_engine_v");
    handler.destroy();
  });

  it("can drop the eq_engine_v token at/after the gate day (same rng sequence)", () => {
    const handler = new LootDropHandler(new Container());
    handler.spawn(
      makeOvermind("ov2"),
      0,
      0,
      seqRng([0.5, 0.9, 0.0]),
      APEX_ENGINE_MIN_DAY,
    );
    expect(handler.spaceLoot.length).toBe(1);
    const moduleId = handler.spaceLoot[0].moduleId;
    expect(gearIdForToken(moduleId as string)).toBe("eq_engine_v");
    handler.destroy();
  });

  it("defaults to no gate when day is omitted (back-compat for direct callers)", () => {
    const handler = new LootDropHandler(new Container());
    handler.spawn(makeOvermind("ov3"), 0, 0, seqRng([0.5, 0.9, 0.0]));
    expect(gearIdForToken(handler.spaceLoot[0].moduleId as string)).toBe(
      "eq_engine_v",
    );
    handler.destroy();
  });
});
