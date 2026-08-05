import { describe, it, expect } from "vitest";
import {
  COMBAT_COMMS_ACTIONS,
  COMBAT_COMMS_CATEGORY_KEY,
  DEFAULT_COMBAT_COMMS,
  commsActionById,
  resolveBribe,
  surrenderThreshold,
  resolveSurrenderDemand,
  findCallForHelpAlly,
} from "@/presentation/flight/combatComms";
import { COMBAT_COMMS } from "@/config/balance";
import { shakedownTribute } from "@/systems/npc/NpcBrain";
import { ru } from "@/i18n/ru";
import { en } from "@/i18n/en";

const CFG = DEFAULT_COMBAT_COMMS;

describe("COMBAT_COMMS config parity (single source of truth)", () => {
  it("balance.ts COMBAT_COMMS mirrors the module default", () => {
    expect(DEFAULT_COMBAT_COMMS).toEqual({
      surrenderHullThreshold: COMBAT_COMMS.surrenderHullThreshold,
      defaultSurrenderThreshold: COMBAT_COMMS.defaultSurrenderThreshold,
      allyProximityRadius: COMBAT_COMMS.allyProximityRadius,
      allyRoles: COMBAT_COMMS.allyRoles,
    });
  });
});

describe("comms action catalog + i18n (Task 10)", () => {
  it("has the three branches with unique ids", () => {
    const ids = COMBAT_COMMS_ACTIONS.map((a) => a.id);
    expect(new Set(ids)).toEqual(
      new Set(["bribe", "demand-surrender", "call-for-help"]),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every name/desc key + the category key resolve in both dictionaries", () => {
    const keys = [
      COMBAT_COMMS_CATEGORY_KEY,
      ...COMBAT_COMMS_ACTIONS.flatMap((a) => [a.nameKey, a.descKey]),
    ];
    for (const k of keys) {
      expect(ru[k as keyof typeof ru], `ru:${k}`).toBeTruthy();
      expect(en[k as keyof typeof en], `en:${k}`).toBeTruthy();
    }
  });

  it("comms category is distinct from the consumable/artifact naming", () => {
    expect(COMBAT_COMMS_CATEGORY_KEY).not.toBe("combat.consumable.category");
    expect(ru[COMBAT_COMMS_CATEGORY_KEY as keyof typeof ru]).not.toBe(
      ru["combat.consumable.category" as keyof typeof ru],
    );
  });

  it("commsActionById looks up a branch and rejects unknown/empty ids", () => {
    expect(commsActionById("bribe")?.id).toBe("bribe");
    expect(commsActionById("nope")).toBeNull();
    expect(commsActionById(null)).toBeNull();
    expect(commsActionById(undefined)).toBeNull();
  });
});

describe("branch 1 — bribe (reuses shakedownTribute)", () => {
  it("tribute equals the existing shakedown economy math", () => {
    for (const purse of [0, 500, 5000, 250000]) {
      expect(resolveBribe(purse).tribute).toBe(shakedownTribute(purse));
    }
  });

  it("a penniless player owes 0 and the target still disengages", () => {
    const r = resolveBribe(0);
    expect(r.tribute).toBe(0);
    expect(r.disengages).toBe(true);
  });

  it("a paying player disengages the target", () => {
    expect(resolveBribe(10000).disengages).toBe(true);
  });
});

describe("branch 2 — demand-surrender (role + hull-fraction gated)", () => {
  it("resolves the role's threshold, falling back to the default", () => {
    expect(surrenderThreshold("TRADER")).toBe(
      CFG.surrenderHullThreshold.TRADER,
    );
    expect(surrenderThreshold("PIRATE")).toBe(
      CFG.surrenderHullThreshold.PIRATE,
    );
    expect(surrenderThreshold("UNKNOWN_ROLE")).toBe(
      CFG.defaultSurrenderThreshold,
    );
  });

  it("a cowardly trader yields even at fairly high hull; a brave pirate does not", () => {
    expect(resolveSurrenderDemand("TRADER", 0.5).surrenders).toBe(true);
    expect(resolveSurrenderDemand("PIRATE", 0.5).surrenders).toBe(false);
  });

  it("surrender requires hull at/below the role threshold (boundary inclusive)", () => {
    const th = CFG.surrenderHullThreshold.PATROL;
    expect(resolveSurrenderDemand("PATROL", th).surrenders).toBe(true);
    expect(resolveSurrenderDemand("PATROL", th + 0.01).surrenders).toBe(false);
    expect(resolveSurrenderDemand("PATROL", 0).surrenders).toBe(true);
  });

  it("a full-hull ship never surrenders regardless of role", () => {
    for (const role of ["TRADER", "PATROL", "RANGER", "PIRATE"]) {
      expect(resolveSurrenderDemand(role, 1).surrenders).toBe(false);
    }
  });

  it("the hive OVERMIND (threshold 0) never surrenders, even at 0 hull", () => {
    expect(surrenderThreshold("OVERMIND")).toBe(0);
    expect(resolveSurrenderDemand("OVERMIND", 0).surrenders).toBe(false);
    expect(resolveSurrenderDemand("OVERMIND", 0.01).surrenders).toBe(false);
  });

  it("clamps out-of-range / non-finite hull fractions", () => {
    expect(resolveSurrenderDemand("TRADER", 2).surrenders).toBe(false);
    expect(resolveSurrenderDemand("TRADER", -1).surrenders).toBe(true);
    expect(resolveSurrenderDemand("TRADER", NaN).surrenders).toBe(false);
  });
});

describe("branch 3 — call-for-help (nearest eligible friendly in range)", () => {
  const player = { x: 0, y: 0 };
  interface Ship {
    id: string;
    x: number;
    y: number;
    role: string;
    available?: boolean;
  }
  const posOf = (s: Ship) => ({ x: s.x, y: s.y });
  const roleOf = (s: Ship) => s.role;

  it("returns the closest eligible ally in range", () => {
    const ships: Ship[] = [
      { id: "far", x: 400, y: 0, role: "TRADER" },
      { id: "near", x: 100, y: 0, role: "PATROL" },
    ];
    expect(findCallForHelpAlly(player, ships, posOf, roleOf)?.id).toBe("near");
  });

  it("ignores ineligible roles (pirate / overmind)", () => {
    const ships: Ship[] = [
      { id: "pirate", x: 50, y: 0, role: "PIRATE" },
      { id: "hive", x: 60, y: 0, role: "OVERMIND" },
      { id: "trader", x: 300, y: 0, role: "TRADER" },
    ];
    expect(findCallForHelpAlly(player, ships, posOf, roleOf)?.id).toBe(
      "trader",
    );
  });

  it("returns null when no eligible ally is in range (the failure case)", () => {
    const ships: Ship[] = [
      { id: "trader", x: CFG.allyProximityRadius + 1, y: 0, role: "TRADER" },
      { id: "pirate", x: 10, y: 0, role: "PIRATE" },
    ];
    expect(findCallForHelpAlly(player, ships, posOf, roleOf)).toBeNull();
  });

  it("returns null with no candidates at all", () => {
    expect(findCallForHelpAlly(player, [], posOf, roleOf)).toBeNull();
  });

  it("honours the proximity radius boundary (inclusive)", () => {
    const onEdge: Ship[] = [
      { id: "edge", x: CFG.allyProximityRadius, y: 0, role: "RANGER" },
    ];
    expect(findCallForHelpAlly(player, onEdge, posOf, roleOf)?.id).toBe("edge");
  });

  it("skips a candidate the availability predicate rejects", () => {
    const ships: Ship[] = [
      { id: "busy", x: 100, y: 0, role: "PATROL", available: false },
      { id: "free", x: 200, y: 0, role: "PATROL", available: true },
    ];
    const chosen = findCallForHelpAlly(
      player,
      ships,
      posOf,
      roleOf,
      (s) => s.available === true,
    );
    expect(chosen?.id).toBe("free");
  });

  it("accepts all military + trader roles as eligible allies", () => {
    for (const role of ["TRADER", "PATROL", "RANGER"]) {
      const ship: Ship = { id: role, x: 50, y: 0, role };
      expect(findCallForHelpAlly(player, [ship], posOf, roleOf)?.id).toBe(role);
    }
  });
});
