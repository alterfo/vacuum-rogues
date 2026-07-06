/**
 * Escalation-notice wiring (three-year-campaign plan, Task 5).
 *
 * Drives the REAL `DayTickController` over a real `Galaxy` and asserts the
 * CAMPAIGN_ESCALATION news events land in `galaxy.newsFeed` — i18n-keyed,
 * fired exactly once per threshold, suppressed on terminal arc states and on
 * the first (seeding) observation of an already-escalated run.
 */
import { describe, it, expect, vi } from "vitest";
import {
  DayTickController,
  type DayTickControllerDeps,
} from "@/systems/DayTickController";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Planet } from "@/domain/Planet";
import { Market } from "@/domain/Market";
import { WarpPath } from "@/domain/WarpPath";
import { Overmind } from "@/domain/Overmind";
import { StarType, ResourceType, PlanetType } from "@/types";
import { Faction } from "@/types/faction";
import { NpcSimulator } from "@/systems/npc/NpcSimulator";
import { GalaxySimulator } from "@/systems/GalaxySimulator";
import { TradeSystem } from "@/systems/TradeSystem";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import {
  GAME_BALANCE,
  ESCALATION_NOTICED_POWER,
  ADAPTIVE_GRACE_DAYS,
} from "@/config/balance";
import { t } from "@/i18n/i18n";

function makePlanet(id: string): Planet {
  const market = new Market([ResourceType.METALS], [1], [1]);
  return new Planet(
    id,
    `Planet ${id}`,
    PlanetType.TERRESTRIAL,
    600,
    market,
    [],
    [],
    true,
    0,
    1_000_000,
  );
}

function makeSystem(id: string): StarSystem {
  return new StarSystem(
    id,
    `System ${id}`,
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [makePlanet(`${id}p`)],
    Faction.INDEPENDENT,
    [],
  );
}

function connect(a: StarSystem, b: StarSystem): void {
  a.connections.push(new WarpPath(a.id, b.id, 2));
  b.connections.push(new WarpPath(b.id, a.id, 2));
}

/** Ten-system chain galaxy — enough resolution to place the share on either
 *  side of the OVERMIND_WARNING_THRESHOLD band. */
function makeGalaxy(): Galaxy {
  const systems = Array.from({ length: 10 }, (_, i) => makeSystem(`S${i}`));
  for (let i = 1; i < systems.length; i++) connect(systems[0], systems[i]);
  return new Galaxy("g_escalation", systems, new Overmind(), [], []);
}

function makeDeps(
  galaxy: Galaxy,
  overrides: Partial<DayTickControllerDeps> = {},
): DayTickControllerDeps {
  const bankBus = new BankBus();
  new BankingService(bankBus);
  return {
    getGalaxy: () => galaxy,
    getPlayer: () => null,
    getPlayerLoadout: () => null,
    npcSimulator: new NpcSimulator(),
    galaxySimulator: new GalaxySimulator(),
    tradeSystem: new TradeSystem(),
    bankBus,
    checkWinCondition: () => false,
    checkExpiredQuests: vi.fn(),
    isOutcomeShown: () => false,
    showGameOutcomeScreen: vi.fn(),
    isWinScreenShown: () => false,
    markWinScreenShown: vi.fn(),
    transitionToWinScreen: vi.fn(),
    invalidateInfoRegistryCache: vi.fn(),
    ...overrides,
  };
}

function escalationEvents(galaxy: Galaxy) {
  return galaxy.newsFeed.filter((e) => e.type === "CAMPAIGN_ESCALATION");
}

describe("DayTickController escalation notices (wiring)", () => {
  it("crossing the power threshold emits NOTICED exactly once, i18n-keyed", () => {
    const galaxy = makeGalaxy();
    let power = 0;
    const controller = new DayTickController(
      makeDeps(galaxy, { updateCampaignPeakPower: () => power }),
    );

    controller.run(); // baseline tick — nothing crossed
    expect(escalationEvents(galaxy)).toEqual([]);

    power = ESCALATION_NOTICED_POWER + 0.01;
    controller.run();
    const fired = escalationEvents(galaxy);
    expect(fired).toHaveLength(1);
    expect(fired[0].description).toBe(t("news.escalation.NOTICED"));
    // The description is a real translation, not a bare fallback key.
    expect(fired[0].description).not.toContain("news.escalation");
    expect(fired[0].systemId).toBe(galaxy.systems[0].id);
    expect(fired[0].day).toBe(galaxy.gameDays);

    controller.run(); // ratchet stays crossed — must NOT re-fire
    controller.run();
    expect(escalationEvents(galaxy)).toHaveLength(1);
  });

  it("the Overmind share crossing the warning band emits HARDENING once", () => {
    const galaxy = makeGalaxy();
    const controller = new DayTickController(makeDeps(galaxy));

    controller.run(); // baseline: share 0
    expect(escalationEvents(galaxy)).toEqual([]);

    // Push the share past OVERMIND_WARNING_THRESHOLD (4/10 = 0.4 ≥ 0.35).
    // Keep it dormant-safe: well below the 0.85 loss share.
    for (const id of ["S1", "S2", "S3", "S4"]) galaxy.addOvermindSystem(id);
    controller.run();

    const fired = escalationEvents(galaxy);
    expect(fired).toHaveLength(1);
    expect(fired[0].description).toBe(t("news.escalation.HARDENING"));

    controller.run();
    expect(escalationEvents(galaxy)).toHaveLength(1);
  });

  it("an arc pushed back to contained emits FINAL_PUSH once", () => {
    const galaxy = makeGalaxy();
    const controller = new DayTickController(makeDeps(galaxy));

    controller.run(); // baseline: dormant, no front
    expect(escalationEvents(galaxy)).toEqual([]);

    // An engaged arc that once peaked above the contained line, now cleared:
    // past grace with zero Overmind systems ⇒ the machine derives `contained`.
    // (peakThreat 0.5 > containedShare, share 0 ≤ containedShare; not a win —
    // eradication requires an engaged front, lastSpreadDay stays -1.)
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: -1,
      status: "advancing",
      threat: 0.5,
      peakThreat: 0.5,
    };
    while (galaxy.gameDays < galaxy.overmindArc.dayZero + ADAPTIVE_GRACE_DAYS) {
      galaxy.simulateDay();
    }
    controller.run();

    const fired = escalationEvents(galaxy);
    expect(fired).toHaveLength(1);
    expect(fired[0].description).toBe(t("news.escalation.FINAL_PUSH"));

    controller.run();
    expect(escalationEvents(galaxy)).toHaveLength(1);
  });

  it("a terminal (won) arc suppresses escalation notices entirely", () => {
    const galaxy = makeGalaxy();
    const controller = new DayTickController(
      makeDeps(galaxy, { updateCampaignPeakPower: () => 1 }),
    );

    controller.run(); // seeds — and power=1 is pre-crossed ⇒ silent
    galaxy.overmindArc = {
      dayZero: 1,
      lastSpreadDay: 5,
      status: "won",
      threat: 0,
      peakThreat: 0.5,
    };
    for (const id of ["S1", "S2", "S3", "S4"]) galaxy.addOvermindSystem(id);
    controller.run();

    expect(escalationEvents(galaxy)).toEqual([]);
  });

  it("first observation of an already-escalated run seeds silently (no retroactive spam on load)", () => {
    const galaxy = makeGalaxy();
    for (const id of ["S1", "S2", "S3", "S4"]) galaxy.addOvermindSystem(id);
    const controller = new DayTickController(
      makeDeps(galaxy, {
        updateCampaignPeakPower: () => ESCALATION_NOTICED_POWER + 0.2,
      }),
    );

    controller.run(); // both NOTICED and HARDENING are pre-crossed
    controller.run();
    expect(escalationEvents(galaxy)).toEqual([]);
  });

  it("share stays under the warning band ⇒ nothing fires (negative path)", () => {
    const galaxy = makeGalaxy();
    const controller = new DayTickController(makeDeps(galaxy));

    controller.run();
    // 3/10 = 0.30 < 0.35 warning threshold.
    for (const id of ["S1", "S2", "S3"]) galaxy.addOvermindSystem(id);
    controller.run();

    expect(3 / galaxy.systems.length).toBeLessThan(
      GAME_BALANCE.OVERMIND_WARNING_THRESHOLD,
    );
    expect(escalationEvents(galaxy)).toEqual([]);
  });
});
