import { describe, it, expect, beforeEach } from "vitest";
import { Galaxy } from "@/domain/Galaxy";
import { Player } from "@/domain/Player";
import type { NewsEvent } from "@/types";
import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import { MigrationPipeline } from "@/data/MigrationPipeline";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeGalaxy(): Galaxy {
  const systems: StarSystem[] = [];
  const npcShips: NpcShip[] = [];
  return new Galaxy("test-seed", systems, {} as never, [], npcShips);
}

function makeEvent(
  type: NewsEvent["type"],
  systemId: string,
  day: number,
  description = "",
): NewsEvent {
  return { type, systemId, day, description };
}

// ── Galaxy.addNewsEvent ───────────────────────────────────────────────────────

describe("Galaxy.addNewsEvent", () => {
  it("appends events and keeps them in order", () => {
    const g = makeGalaxy();
    g.addNewsEvent(makeEvent("PIRATE_ATTACK", "sys1", 1, "Атака пиратов"));
    g.addNewsEvent(
      makeEvent("NPC_QUEST_COMPLETE", "sys2", 2, "Квест выполнен"),
    );
    expect(g.newsFeed).toHaveLength(2);
    expect(g.newsFeed[0].type).toBe("PIRATE_ATTACK");
    expect(g.newsFeed[1].type).toBe("NPC_QUEST_COMPLETE");
  });

  it("trims feed to 100 events max", () => {
    const g = makeGalaxy();
    for (let i = 0; i < 110; i++) {
      g.addNewsEvent(makeEvent("MARKET_SHIFT", "s", i, `event ${i}`));
    }
    expect(g.newsFeed.length).toBe(100);
    // Oldest entries removed; newest (day 109) still present.
    expect(g.newsFeed[g.newsFeed.length - 1].day).toBe(109);
  });

  it("stores description on events", () => {
    const g = makeGalaxy();
    g.addNewsEvent(makeEvent("PIRATE_ATTACK", "s1", 5, "Пираты в секторе"));
    expect(g.newsFeed[0].description).toBe("Пираты в секторе");
  });

  it("supports MARKET_SHIFT and OVERMIND_EXPANSION event types", () => {
    const g = makeGalaxy();
    g.addNewsEvent(makeEvent("MARKET_SHIFT", "s1", 1, "Цены упали"));
    g.addNewsEvent(
      makeEvent("OVERMIND_EXPANSION", "s2", 2, "Захвачена система"),
    );
    expect(g.newsFeed[0].type).toBe("MARKET_SHIFT");
    expect(g.newsFeed[1].type).toBe("OVERMIND_EXPANSION");
  });
});

// ── Player.newsBookmarks ──────────────────────────────────────────────────────

function makePlayer(): Player {
  return new Player(
    "p1",
    "Test",
    "INDEPENDENT" as never,
    0,
    1,
    {} as never,
    {},
    { activeQuests: [], completedQuests: [] },
    { entries: [] },
    1000,
    {} as never,
    { modules: [], micromodules: [], cargo: [], items: [] } as never,
  );
}

describe("Player.newsBookmarks", () => {
  let player: Player;

  beforeEach(() => {
    player = makePlayer();
  });

  it("starts with empty bookmarks", () => {
    expect(player.newsBookmarks).toEqual([]);
  });

  it("can add and retrieve a bookmark key", () => {
    player.newsBookmarks.push(12345);
    expect(player.newsBookmarks).toContain(12345);
  });

  it("can remove a bookmark key", () => {
    player.newsBookmarks.push(99);
    player.newsBookmarks.push(100);
    const idx = player.newsBookmarks.indexOf(99);
    player.newsBookmarks.splice(idx, 1);
    expect(player.newsBookmarks).not.toContain(99);
    expect(player.newsBookmarks).toContain(100);
  });

  it("toggle: adds key if not present, removes if present", () => {
    const key = 42;
    // Toggle on
    const idx1 = player.newsBookmarks.indexOf(key);
    if (idx1 >= 0) player.newsBookmarks.splice(idx1, 1);
    else player.newsBookmarks.push(key);
    expect(player.newsBookmarks).toContain(key);
    // Toggle off
    const idx2 = player.newsBookmarks.indexOf(key);
    if (idx2 >= 0) player.newsBookmarks.splice(idx2, 1);
    else player.newsBookmarks.push(key);
    expect(player.newsBookmarks).not.toContain(key);
  });
});

// ── Migration 10→11 ───────────────────────────────────────────────────────────

describe("Migration 10→11: newsBookmarks backfill", () => {
  it("adds newsBookmarks to player if missing", () => {
    const state = {
      version: 10,
      timestamp: 0,
      galaxy: {
        id: "g1",
        gameDays: 0,
        systems: [],
        npcShips: [],
        newsFeed: [],
        questBoards: {},
      },
      player: {
        id: "p1",
        name: "Test",
        experience: 0,
        level: 1,
        credits: 100,
        reputation: {},
        questLog: { activeQuests: [], completedQuests: [] },
        journal: { entries: [] },
        ship: { hullHP: 100, maxHull: 100, hullClass: "CORVETTE" },
        inventory: { modules: [], micromodules: [], cargo: [], items: [] },
        currentSystemId: "",
        contrabandGoods: [],
        completedQuestChains: [],
        activeTextQuestState: null,
        // newsBookmarks intentionally absent
      },
      persistentDialogs: [],
    } as unknown as Parameters<typeof MigrationPipeline.migrate>[0];

    const migrated = MigrationPipeline.migrate(state);
    const player = migrated.player as unknown as { newsBookmarks?: number[] };
    expect(Array.isArray(player.newsBookmarks)).toBe(true);
    expect(player.newsBookmarks).toEqual([]);
  });

  it("backfills description on legacy news events without it", () => {
    const state = {
      version: 10,
      timestamp: 0,
      galaxy: {
        id: "g1",
        gameDays: 5,
        systems: [],
        npcShips: [],
        newsFeed: [
          { type: "PIRATE_ATTACK", systemId: "s1", day: 3 }, // no description
        ],
        questBoards: {},
      },
      player: {
        id: "p1",
        name: "Test",
        experience: 0,
        level: 1,
        credits: 100,
        reputation: {},
        questLog: { activeQuests: [], completedQuests: [] },
        journal: { entries: [] },
        ship: { hullHP: 100, maxHull: 100, hullClass: "CORVETTE" },
        inventory: { modules: [], micromodules: [], cargo: [], items: [] },
        currentSystemId: "",
        contrabandGoods: [],
        completedQuestChains: [],
        activeTextQuestState: null,
      },
      persistentDialogs: [],
    } as unknown as Parameters<typeof MigrationPipeline.migrate>[0];

    const migrated = MigrationPipeline.migrate(state);
    const galaxy = migrated.galaxy as unknown as {
      newsFeed: Array<{ description?: string }>;
    };
    expect(galaxy.newsFeed[0].description).toBeDefined();
    expect(typeof galaxy.newsFeed[0].description).toBe("string");
  });
});
