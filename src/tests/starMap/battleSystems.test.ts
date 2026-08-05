import { describe, it, expect } from "vitest";
import {
  systemsWithActiveBattle,
  type BattleShip,
} from "@/utils/battleSystems";
import { Faction } from "@/types/faction";
import { NpcRole } from "@/types";

describe("systemsWithActiveBattle", () => {
  const pirate = (systemId: string): BattleShip => ({
    systemId,
    hostile: true,
    faction: Faction.SYNDICATE,
  });
  const overmind = (systemId: string): BattleShip => ({
    systemId,
    hostile: false, // not flagged, but Overmind still counts as hostile
    faction: Faction.OVERMIND,
  });
  const ranger = (systemId: string): BattleShip => ({
    systemId,
    hostile: false,
    faction: Faction.BASTIONS,
  });
  const roguePirate = (systemId: string): BattleShip => ({
    systemId,
    hostile: false,
    faction: Faction.SYNDICATE,
    role: NpcRole.PIRATE,
  });

  it("flags a system with both a hostile and a friendly ship", () => {
    const battle = systemsWithActiveBattle([pirate("S1"), ranger("S1")]);
    expect(battle.has("S1")).toBe(true);
    expect(battle.size).toBe(1);
  });

  it("treats an Overmind ship as the hostile side even if not flagged hostile", () => {
    const battle = systemsWithActiveBattle([overmind("S2"), ranger("S2")]);
    expect(battle.has("S2")).toBe(true);
  });

  it("treats a PIRATE-role ship as the hostile side even if not flagged hostile", () => {
    const battle = systemsWithActiveBattle([roguePirate("S5"), ranger("S5")]);
    expect(battle.has("S5")).toBe(true);
  });

  it("returns none for a PIRATE-role ship alone (no friendly side present)", () => {
    const battle = systemsWithActiveBattle([
      roguePirate("S6"),
      roguePirate("S6"),
    ]);
    expect(battle.size).toBe(0);
  });

  it("returns none when only hostiles are present", () => {
    const battle = systemsWithActiveBattle([
      pirate("S1"),
      pirate("S1"),
      overmind("S2"),
    ]);
    expect(battle.size).toBe(0);
  });

  it("returns none when only friendlies are present", () => {
    const battle = systemsWithActiveBattle([ranger("S1"), ranger("S2")]);
    expect(battle.size).toBe(0);
  });

  it("returns none for an empty ship list", () => {
    expect(systemsWithActiveBattle([]).size).toBe(0);
  });

  it("detects multiple simultaneous battles and ignores one-sided systems", () => {
    const battle = systemsWithActiveBattle([
      pirate("S1"),
      ranger("S1"), // battle
      overmind("S2"),
      ranger("S2"), // battle
      pirate("S3"), // hostiles only — not a battle
      ranger("S4"), // friendlies only — not a battle
    ]);
    expect(battle).toEqual(new Set(["S1", "S2"]));
  });
});
