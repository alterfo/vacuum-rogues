import { describe, it, expect } from "vitest";
import {
  updateRumors,
  type RumorDirectorConfig,
} from "@/systems/trade/RumorDirector";
import type { RouteCandidate } from "@/systems/trade/RouteScanner";
import { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { Overmind } from "@/domain/Overmind";
import { ResourceType } from "@/types";

const CFG: RumorDirectorConfig = {
  marginOpen: 25,
  marginExpire: 10,
  maxActive: 4,
};

function makeGalaxy(systems: { id: string; name: string }[]): Galaxy {
  return new Galaxy(
    "g1",
    systems as unknown as StarSystem[],
    {} as unknown as Overmind,
    [],
  );
}

const SYS = [
  { id: "S1", name: "Соль" },
  { id: "S2", name: "Вега" },
  { id: "S3", name: "Орион" },
];

function candidate(
  resource: ResourceType,
  from: string,
  to: string,
  marginPct: number,
  fromPrice = 100,
): RouteCandidate {
  return {
    resource,
    fromSystemId: from,
    fromPlanetId: `${from}p`,
    toSystemId: to,
    toPlanetId: `${to}p`,
    fromPrice,
    toPrice: fromPrice * (1 + marginPct / 100),
    marginPct,
  };
}

function scanOf(...candidates: RouteCandidate[]) {
  return () => candidates;
}

describe("RumorDirector.updateRumors — opening", () => {
  it("opens a rumor for every route above marginOpen, news once each", () => {
    const galaxy = makeGalaxy(SYS);
    const res = updateRumors(
      galaxy,
      scanOf(
        candidate(ResourceType.METALS, "S1", "S2", 40),
        candidate(ResourceType.FUEL, "S1", "S3", 30),
        candidate(ResourceType.CRYSTALS, "S2", "S3", 15), // below open → skipped
      ),
      5,
      CFG,
    );

    expect(res.opened.map((r) => r.resource)).toEqual([
      ResourceType.METALS,
      ResourceType.FUEL,
    ]);
    expect(galaxy.activeRumors).toHaveLength(2);

    const tradeNews = galaxy.newsFeed.filter(
      (n) => n.type === "TRADE_OPPORTUNITY",
    );
    expect(tradeNews).toHaveLength(2);
    expect(tradeNews[0].description).toContain("Везите");
    expect(tradeNews[0]).toMatchObject({
      resource: ResourceType.METALS,
      fromSystemId: "S1",
      toSystemId: "S2",
      marginPct: 40,
    });
  });

  it("treats marginOpen as exclusive (a route exactly at the threshold is not opened)", () => {
    const galaxy = makeGalaxy(SYS);
    const res = updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 25)),
      1,
      CFG,
    );
    expect(res.opened).toHaveLength(0);
    expect(galaxy.activeRumors).toHaveLength(0);
  });

  it("does not re-open or re-announce an already-active rumor", () => {
    const galaxy = makeGalaxy(SYS);
    const scan = scanOf(
      candidate(ResourceType.METALS, "S1", "S2", 40),
      candidate(ResourceType.FUEL, "S1", "S3", 30),
    );
    updateRumors(galaxy, scan, 5, CFG);
    const res2 = updateRumors(galaxy, scan, 6, CFG);

    expect(res2.opened).toHaveLength(0);
    expect(galaxy.activeRumors).toHaveLength(2);
    expect(
      galaxy.newsFeed.filter((n) => n.type === "TRADE_OPPORTUNITY"),
    ).toHaveLength(2);
  });
});

describe("RumorDirector.updateRumors — re-scoring & expiry", () => {
  it("re-scores an active rumor's live margin without expiring while above threshold", () => {
    const galaxy = makeGalaxy(SYS);
    updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 40)),
      1,
      CFG,
    );
    const res = updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 18)),
      2,
      CFG,
    );

    expect(res.expired).toHaveLength(0);
    expect(res.opened).toHaveLength(0);
    expect(galaxy.activeRumors).toHaveLength(1);
    expect(galaxy.activeRumors[0].lastMarginPct).toBe(18);
    expect(galaxy.activeRumors[0].marginPct).toBe(40);
  });

  it("expires a rumor once its spread closes, emitting one 'акция закончилась' line", () => {
    const galaxy = makeGalaxy(SYS);
    updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 40)),
      1,
      CFG,
    );
    const res = updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 8)),
      3,
      CFG,
    );

    expect(res.expired.map((r) => r.resource)).toEqual([ResourceType.METALS]);
    expect(galaxy.activeRumors).toHaveLength(0);
    const closed = galaxy.newsFeed.filter((n) =>
      n.description.includes("акция закончилась"),
    );
    expect(closed).toHaveLength(1);
  });

  it("treats marginExpire as inclusive (a rumor exactly at the threshold expires)", () => {
    const galaxy = makeGalaxy(SYS);
    updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 40)),
      1,
      CFG,
    );
    updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 10)),
      2,
      CFG,
    );
    expect(galaxy.activeRumors).toHaveLength(0);
  });

  it("expires a rumor whose route drops out of the scan entirely", () => {
    const galaxy = makeGalaxy(SYS);
    updateRumors(
      galaxy,
      scanOf(candidate(ResourceType.METALS, "S1", "S2", 40)),
      1,
      CFG,
    );
    const res = updateRumors(galaxy, scanOf(), 2, CFG);
    expect(res.expired).toHaveLength(1);
    expect(galaxy.activeRumors).toHaveLength(0);
  });
});

describe("RumorDirector.updateRumors — cap", () => {
  it("caps active rumors at maxActive, keeping the most profitable", () => {
    const galaxy = makeGalaxy(SYS);
    const cfg: RumorDirectorConfig = { ...CFG, maxActive: 2 };
    const res = updateRumors(
      galaxy,
      scanOf(
        candidate(ResourceType.CRYSTALS, "S1", "S2", 60),
        candidate(ResourceType.METALS, "S1", "S3", 50),
        candidate(ResourceType.FUEL, "S2", "S3", 40),
      ),
      1,
      cfg,
    );

    expect(galaxy.activeRumors).toHaveLength(2);
    expect(res.opened.map((r) => r.resource)).toEqual([
      ResourceType.CRYSTALS,
      ResourceType.METALS,
    ]);
  });

  it("holds at capacity across ticks, then opens a waiting route after one expires", () => {
    const galaxy = makeGalaxy(SYS);
    const cfg: RumorDirectorConfig = { ...CFG, maxActive: 2 };

    updateRumors(
      galaxy,
      scanOf(
        candidate(ResourceType.CRYSTALS, "S1", "S2", 60),
        candidate(ResourceType.METALS, "S1", "S3", 50),
      ),
      1,
      cfg,
    );
    expect(galaxy.activeRumors).toHaveLength(2);

    const held = updateRumors(
      galaxy,
      scanOf(
        candidate(ResourceType.CRYSTALS, "S1", "S2", 60),
        candidate(ResourceType.METALS, "S1", "S3", 50),
        candidate(ResourceType.FUEL, "S2", "S3", 55),
      ),
      2,
      cfg,
    );
    expect(held.opened).toHaveLength(0);
    expect(galaxy.activeRumors).toHaveLength(2);

    const rotated = updateRumors(
      galaxy,
      scanOf(
        candidate(ResourceType.CRYSTALS, "S1", "S2", 5), // expires
        candidate(ResourceType.METALS, "S1", "S3", 50),
        candidate(ResourceType.FUEL, "S2", "S3", 55),
      ),
      3,
      cfg,
    );
    expect(rotated.expired.map((r) => r.resource)).toEqual([
      ResourceType.CRYSTALS,
    ]);
    expect(rotated.opened.map((r) => r.resource)).toEqual([ResourceType.FUEL]);
    expect(galaxy.getActiveRumors().map((r) => r.resource)).toEqual([
      ResourceType.FUEL, // 55
      ResourceType.METALS, // 50
    ]);
  });
});

describe("Galaxy.getActiveRumors", () => {
  it("returns active rumors sorted by live margin descending, without aliasing the store", () => {
    const galaxy = makeGalaxy(SYS);
    updateRumors(
      galaxy,
      scanOf(
        candidate(ResourceType.METALS, "S1", "S2", 30),
        candidate(ResourceType.FUEL, "S1", "S3", 50),
      ),
      1,
      CFG,
    );
    const sorted = galaxy.getActiveRumors();
    expect(sorted.map((r) => r.resource)).toEqual([
      ResourceType.FUEL,
      ResourceType.METALS,
    ]);
    sorted.pop();
    expect(galaxy.activeRumors).toHaveLength(2);
  });
});
