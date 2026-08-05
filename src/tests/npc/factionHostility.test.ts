import { describe, it, expect } from "vitest";
import {
  isHostile,
  factionKindOf,
  shipsAreHostile,
  type FactionKind,
  type HostilityContext,
} from "@/systems/npc/factionHostility";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";

const HOSTILE_REP: HostilityContext = { pirateRep: 0 };
const GOOD_REP: HostilityContext = { pirateRep: GOOD_PIRATE_REP_THRESHOLD };

const ALL_KINDS: FactionKind[] = [
  "overmind",
  "pirate",
  "trader",
  "ranger",
  "patrol",
  "player",
];

describe("factionHostility.isHostile", () => {
  it("no kind is hostile to its own kind", () => {
    for (const kind of ALL_KINDS) {
      expect(isHostile(kind, kind, HOSTILE_REP)).toBe(false);
    }
  });

  describe("Overmind attacks everyone indiscriminately", () => {
    for (const target of ALL_KINDS.filter((k) => k !== "overmind")) {
      it(`overmind → ${target} is hostile`, () => {
        expect(isHostile("overmind", target, HOSTILE_REP)).toBe(true);
      });
    }
  });

  describe("Pirate↔Overmind are mutual enemies", () => {
    it("pirate → overmind", () => {
      expect(isHostile("pirate", "overmind", HOSTILE_REP)).toBe(true);
    });
    it("overmind → pirate", () => {
      expect(isHostile("overmind", "pirate", HOSTILE_REP)).toBe(true);
    });
  });

  describe("Pirate preys on weak/valuable targets", () => {
    it("pirate → trader is hostile (prey)", () => {
      expect(isHostile("pirate", "trader", HOSTILE_REP)).toBe(true);
    });
    it("pirate → ranger is hostile (fights the law)", () => {
      expect(isHostile("pirate", "ranger", HOSTILE_REP)).toBe(true);
    });
    it("pirate → patrol is hostile (fights the law)", () => {
      expect(isHostile("pirate", "patrol", HOSTILE_REP)).toBe(true);
    });
    it("pirate → pirate is NOT hostile (pack)", () => {
      expect(isHostile("pirate", "pirate", HOSTILE_REP)).toBe(false);
    });
  });

  describe("Good-pirate-rep player exemption (boundary)", () => {
    it("hostile-rep player is prey", () => {
      expect(isHostile("pirate", "player", { pirateRep: 0 })).toBe(true);
    });
    it("just below threshold is still prey", () => {
      expect(
        isHostile("pirate", "player", {
          pirateRep: GOOD_PIRATE_REP_THRESHOLD - 1,
        }),
      ).toBe(true);
    });
    it("at the threshold the player is exempt (left alone)", () => {
      expect(
        isHostile("pirate", "player", {
          pirateRep: GOOD_PIRATE_REP_THRESHOLD,
        }),
      ).toBe(false);
    });
    it("above the threshold the player is exempt", () => {
      expect(
        isHostile("pirate", "player", {
          pirateRep: GOOD_PIRATE_REP_THRESHOLD + 50,
        }),
      ).toBe(false);
    });
    it("the exemption does not extend to the Overmind", () => {
      expect(isHostile("overmind", "player", GOOD_REP)).toBe(true);
    });
  });

  describe("Rangers/Patrols hunt the lawless, leave others alone", () => {
    for (const law of ["ranger", "patrol"] as const) {
      it(`${law} → pirate is hostile`, () => {
        expect(isHostile(law, "pirate", HOSTILE_REP)).toBe(true);
      });
      it(`${law} → overmind is hostile`, () => {
        expect(isHostile(law, "overmind", HOSTILE_REP)).toBe(true);
      });
      it(`${law} → trader is NOT hostile`, () => {
        expect(isHostile(law, "trader", HOSTILE_REP)).toBe(false);
      });
      it(`${law} → player is NOT hostile`, () => {
        expect(isHostile(law, "player", HOSTILE_REP)).toBe(false);
      });
    }
  });

  describe("Traders/Players are peaceful in the matrix (reactive aggression elsewhere)", () => {
    for (const peaceful of ["trader", "player"] as const) {
      for (const target of ALL_KINDS) {
        it(`${peaceful} → ${target} is NOT hostile`, () => {
          expect(isHostile(peaceful, target, HOSTILE_REP)).toBe(false);
        });
      }
    }
  });
});

describe("factionHostility.factionKindOf", () => {
  it("tags Overmind ships by faction even with a PATROL role", () => {
    expect(
      factionKindOf({ role: NpcRole.PATROL, faction: Faction.OVERMIND }),
    ).toBe("overmind");
  });
  it("tags pirates by role", () => {
    expect(
      factionKindOf({ role: NpcRole.PIRATE, faction: Faction.OUTLANDERS }),
    ).toBe("pirate");
  });
  it("tags traders by role", () => {
    expect(
      factionKindOf({ role: NpcRole.TRADER, faction: Faction.SYNDICATE }),
    ).toBe("trader");
  });
  it("tags rangers by role", () => {
    expect(
      factionKindOf({ role: NpcRole.RANGER, faction: Faction.BASTIONS }),
    ).toBe("ranger");
  });
  it("tags non-Overmind patrols by role", () => {
    expect(
      factionKindOf({ role: NpcRole.PATROL, faction: Faction.BASTIONS }),
    ).toBe("patrol");
  });
});

describe("factionHostility.shipsAreHostile", () => {
  const overmindShip = { role: NpcRole.PATROL, faction: Faction.OVERMIND };
  const pirateShip = { role: NpcRole.PIRATE, faction: Faction.OUTLANDERS };
  const traderShip = { role: NpcRole.TRADER, faction: Faction.SYNDICATE };

  it("Overmind ship engages a pirate ship (cross-faction)", () => {
    expect(shipsAreHostile(overmindShip, pirateShip, HOSTILE_REP)).toBe(true);
  });
  it("a pirate ship engages the Overmind ship (mutual)", () => {
    expect(shipsAreHostile(pirateShip, overmindShip, HOSTILE_REP)).toBe(true);
  });
  it("a pirate ship preys on a trader ship", () => {
    expect(shipsAreHostile(pirateShip, traderShip, HOSTILE_REP)).toBe(true);
  });
  it("two pirate ships do not fight (pack)", () => {
    expect(shipsAreHostile(pirateShip, pirateShip, HOSTILE_REP)).toBe(false);
  });
});
