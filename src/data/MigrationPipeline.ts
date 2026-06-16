import type { SaveState } from "@/domain/SaveState";
import type { ShipLoadoutSnapshot } from "@/types";
import {
  GEAR_CATALOG,
  GearKind,
  EquipmentClass,
  gearById,
  type HullSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";
import { logger } from "@/utils/logger";

/** A legacy ShipModule as it appears in an un-rehydrated save (plain JSON). */
interface LegacyModuleJSON {
  id: string;
  micromoduleId?: string;
}

/** Default fitting that keeps a migrated ship flyable (mirrors starterLoadout). */
const MIGRATION_ENGINE_ID = "eq_engine_i";
const MIGRATION_TANK_ID = "eq_tank";

/** Resolve a legacy `hullClass` label to its GearCatalog hull id. */
function hullIdForHullClass(hullClass: string | undefined): string {
  const match = GEAR_CATALOG.find(
    (g): g is HullSpec => g.kind === GearKind.HULL && g.hullClass === hullClass,
  );
  return match?.id ?? "hull_corvette";
}

function isEquipmentClass(id: string, cls: EquipmentClass): boolean {
  const g = gearById(id);
  return (
    g?.kind === GearKind.EQUIPMENT &&
    (g as EquipmentSpec).equipmentClass === cls
  );
}

export class MigrationPipeline {
  static readonly CURRENT_VERSION = 23;

  static migrate(state: SaveState): SaveState {
    const fromVersion = state.version ?? 0;
    if (fromVersion >= MigrationPipeline.CURRENT_VERSION) {
      return state;
    }

    logger.info(
      `Migrating save from version ${fromVersion} to ${MigrationPipeline.CURRENT_VERSION}`,
    );

    for (let v = fromVersion; v < MigrationPipeline.CURRENT_VERSION; v++) {
      const migrator = this.migrations[v];
      if (migrator) {
        migrator(state);
      }
    }

    state.version = MigrationPipeline.CURRENT_VERSION;
    return state;
  }

  private static migrations: Record<number, (state: SaveState) => void> = {
    // Example migration from 0 -> 1
    0: (state: SaveState) => {
      // Initialize any missing fields for v1 schema
      if (!state.persistentDialogs) {
        state.persistentDialogs = [];
      }
    },
    // 1 -> 2: living-galaxy NPC ships (Feature 8). Old saves predate the NPC
    // population; start them empty so the simulation can repopulate going
    // forward without breaking the loaded galaxy.
    1: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { npcShips?: unknown[] };
      if (galaxy && !Array.isArray(galaxy.npcShips)) {
        galaxy.npcShips = [];
      }
    },
    // 2 -> 3: economy type and political system (Task 1). Old saves don't have
    // these fields; default to MIXED/REPUBLIC so every system is functional.
    2: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        systems?: Array<{ economyType?: string; politicalSystem?: string }>;
      };
      if (galaxy && Array.isArray(galaxy.systems)) {
        for (const sys of galaxy.systems) {
          if (!sys.economyType) sys.economyType = "MIXED";
          if (!sys.politicalSystem) sys.politicalSystem = "REPUBLIC";
        }
      }
    },
    // 3 -> 4: smuggling (Task 3). Old saves lack contrabandGoods on player.
    3: (state: SaveState) => {
      const player = state.player as unknown as { contrabandGoods?: string[] };
      if (player && !Array.isArray(player.contrabandGoods)) {
        player.contrabandGoods = [];
      }
    },
    // 4 -> 5: hull classes (Task 5). Old saves lack hullClass on player.ship.
    4: (state: SaveState) => {
      const ship = (
        state.player as unknown as { ship?: { hullClass?: string } }
      )?.ship;
      if (ship && !ship.hullClass) {
        ship.hullClass = "CORVETTE";
      }
    },
    // 5 -> 6: micromodule inventory (Task 7). Old saves lack micromodules in player inventory.
    5: (state: SaveState) => {
      const inventory = (
        state.player as unknown as { inventory?: { micromodules?: unknown[] } }
      )?.inventory;
      if (inventory && !Array.isArray(inventory.micromodules)) {
        inventory.micromodules = [];
      }
    },
    // 6 -> 7: NPC questing and news feed (Task 13). Old saves lack activeQuestTarget
    // on NPC ships and the galaxy newsFeed array.
    6: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        npcShips?: Array<{ activeQuestTarget?: unknown }>;
        newsFeed?: unknown[];
      };
      if (galaxy) {
        if (!Array.isArray(galaxy.newsFeed)) {
          galaxy.newsFeed = [];
        }
        if (Array.isArray(galaxy.npcShips)) {
          for (const npc of galaxy.npcShips) {
            if (npc.activeQuestTarget === undefined) {
              npc.activeQuestTarget = null;
            }
          }
        }
      }
    },
    // 7 -> 8: Galaxy-spanning quest objectives (Task 14). Old saves lack
    // targetSystemId and targetObjectId on persisted active quests.
    7: (state: SaveState) => {
      const quests = (
        state.player as unknown as {
          questLog?: { activeQuests?: Array<Record<string, unknown>> };
        }
      )?.questLog?.activeQuests;
      if (Array.isArray(quests)) {
        for (const q of quests) {
          if (q.targetSystemId === undefined) q.targetSystemId = null;
          if (q.targetObjectId === undefined) q.targetObjectId = null;
        }
      }
    },
    // 8 -> 9: Quest board persistence (Task 15). Old saves lack questBoards on
    // galaxy; initialize to empty record so board tracking starts fresh.
    8: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { questBoards?: unknown };
      if (galaxy && !galaxy.questBoards) {
        galaxy.questBoards = {};
      }
    },
    // 9 -> 10: Reputation gates and quest chains (Task 16). Old saves lack
    // minReputation/chainId/chainPart on quests and completedQuestChains on player.
    9: (state: SaveState) => {
      const player = state.player as unknown as {
        completedQuestChains?: string[];
        questLog?: { activeQuests?: Array<Record<string, unknown>> };
      };
      if (player) {
        if (!Array.isArray(player.completedQuestChains)) {
          player.completedQuestChains = [];
        }
        const quests = player.questLog?.activeQuests;
        if (Array.isArray(quests)) {
          for (const q of quests) {
            if (q.minReputation === undefined) q.minReputation = 0;
            if (q.chainId === undefined) q.chainId = null;
            if (q.chainPart === undefined) q.chainPart = -1;
          }
        }
      }
    },
    // 10 -> 11: News feed bookmarks (Task 20). Add newsBookmarks to player;
    // backfill description on legacy news events that lack it.
    10: (state: SaveState) => {
      const player = state.player as unknown as { newsBookmarks?: number[] };
      if (player && !Array.isArray(player.newsBookmarks)) {
        player.newsBookmarks = [];
      }
      const galaxy = state.galaxy as unknown as {
        newsFeed?: Array<{ description?: string }>;
      };
      if (galaxy && Array.isArray(galaxy.newsFeed)) {
        for (const event of galaxy.newsFeed) {
          if (!event.description) event.description = "";
        }
      }
    },
    // 11 -> 12: Data fog (Task 21). lastVisitedDay on StarSystem is optional;
    // undefined means "never visited" which is the correct default for old saves.
    11: (_state: SaveState) => {
      // No migration needed — field is optional with no required default value.
    },
    // 12 -> 13: Rank system (Task 22). Old saves lack killPoints and rank on player.
    12: (state: SaveState) => {
      const player = state.player as unknown as {
        killPoints?: number;
        rank?: number;
      };
      if (player) {
        if (player.killPoints === undefined) player.killPoints = 0;
        if (player.rank === undefined) player.rank = 0;
      }
    },
    // 13 -> 14: OVERMIND threat arc (Task 23). Old saves lack overmindSystems and
    // overmindCoreSystemId on galaxy; default to empty set, core = last system by ID.
    13: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        systems?: Array<{ id: string }>;
        overmindSystems?: string[];
        overmindCoreSystemId?: string;
      };
      if (galaxy) {
        if (!Array.isArray(galaxy.overmindSystems)) {
          galaxy.overmindSystems = [];
        }
        if (!galaxy.overmindCoreSystemId) {
          const lastSystem = Array.isArray(galaxy.systems)
            ? [...galaxy.systems].sort((a, b) => a.id.localeCompare(b.id)).pop()
            : null;
          galaxy.overmindCoreSystemId = lastSystem?.id ?? "";
        }
      }
    },
    // 14 -> 15: Comprehensive gap-fill for fields that were added in Tasks
    // 8/12/17/24 but never got their own migration steps. Old saves upgraded
    // through v14 may still be missing these — this step ensures they are
    // present so runtime code never sees undefined for expected fields.
    14: (state: SaveState) => {
      // Task 24: activeTradeBoomSystems on galaxy
      const galaxy = state.galaxy as unknown as {
        activeTradeBoomSystems?: Record<string, number>;
        npcShips?: Array<{
          cargo?: unknown[];
          loadoutSummary?: unknown[];
          shieldPower?: number;
        }>;
      };
      if (galaxy) {
        if (!galaxy.activeTradeBoomSystems) {
          galaxy.activeTradeBoomSystems = {};
        }
        // Tasks 8/12: cargo, loadoutSummary, shieldPower on NPC ships
        if (Array.isArray(galaxy.npcShips)) {
          for (const npc of galaxy.npcShips) {
            if (!Array.isArray(npc.cargo)) npc.cargo = [];
            if (!Array.isArray(npc.loadoutSummary)) npc.loadoutSummary = [];
            if (npc.shieldPower === undefined) npc.shieldPower = 0;
          }
        }
      }
      // Task 17: activeTextQuestState on player
      const player = state.player as unknown as {
        activeTextQuestState?: unknown;
      };
      if (player && player.activeTextQuestState === undefined) {
        player.activeTextQuestState = null;
      }
    },
    // 15 -> 16: Visited systems (Task 29). Add visitedSystems to player;
    // old saves start with an empty list (player must re-visit to populate).
    15: (state: SaveState) => {
      const player = state.player as unknown as { visitedSystems?: string[] };
      if (player && !Array.isArray(player.visitedSystems)) {
        player.visitedSystems = [];
      }
    },
    // 16 -> 17: Faction home systems (Task 29). Add isFactionHome and
    // homeFactionId to each StarSystem; defaults to false/null for old saves
    // (the generator assigns them for new galaxies).
    16: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        systems?: Array<{ isFactionHome?: boolean; homeFactionId?: unknown }>;
      };
      if (galaxy && Array.isArray(galaxy.systems)) {
        for (const sys of galaxy.systems) {
          if (sys.isFactionHome === undefined) sys.isFactionHome = false;
          if (sys.homeFactionId === undefined) sys.homeFactionId = null;
        }
      }
    },
    // 17 -> 18: Pirate-held systems (Task 2, overmind balance). Add pirateSystems
    // to galaxy; old saves start with empty list (no pirate-held systems).
    17: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { pirateSystems?: string[] };
      if (galaxy && !Array.isArray(galaxy.pirateSystems)) {
        galaxy.pirateSystems = [];
      }
    },
    // 18 -> 19: Galaxy tech level (Task 1, living-galaxy economy). Old saves
    // lack techLevel on StarSystem; default every system to 1.
    18: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        systems?: Array<{ techLevel?: number }>;
      };
      if (galaxy && Array.isArray(galaxy.systems)) {
        for (const sys of galaxy.systems) {
          if (sys.techLevel === undefined) sys.techLevel = 1;
        }
      }
    },
    // 19 -> 20: Artifact upgrade counts per loadout slot (Task 5). Old saves
    // lack upgrades on each slotted item; default to 0 (no upgrades applied).
    19: (state: SaveState) => {
      const loadout = (
        state as unknown as {
          loadout?: { slotted?: Array<{ upgrades?: number }> };
        }
      ).loadout;
      if (loadout && Array.isArray(loadout.slotted)) {
        for (const slot of loadout.slotted) {
          if (slot.upgrades === undefined) slot.upgrades = 0;
        }
      }
    },
    // 20 -> 21: NPC convoy IDs (Task 6, living-galaxy economy). convoyId is
    // optional so old NPC ships load fine without it — no data backfill needed.
    20: (_state: SaveState) => {
      // No-op: convoyId is optional and absent by default on old ships.
    },
    // 21 -> 22: Quest isPendingReturn + pendingReturnQuests (Task 5, quest polish).
    // Old saves lack isPendingReturn on quests and pendingReturnQuests in questLog.
    21: (state: SaveState) => {
      const questLog = (
        state.player as unknown as {
          questLog?: {
            activeQuests?: Array<Record<string, unknown>>;
            pendingReturnQuests?: unknown[];
          };
        }
      )?.questLog;
      if (questLog) {
        if (!Array.isArray(questLog.pendingReturnQuests)) {
          questLog.pendingReturnQuests = [];
        }
        if (Array.isArray(questLog.activeQuests)) {
          for (const q of questLog.activeQuests) {
            if (q.isPendingReturn === undefined) q.isPendingReturn = false;
          }
        }
      }
    },
    // 22 -> 23: Dual-hull unification (Task 4). Synthesize the canonical
    // ShipLoadoutSnapshot from the legacy `ship.modules` + `inventory.modules`
    // so the fitting carries forward once the legacy arrays are retired
    // (Task 5). One-way and idempotent: saves that already carry a `loadout`
    // (made after loadout persistence) keep their authoritative snapshot and
    // are never rebuilt. Unknown/hull gear ids are skipped item-by-item
    // (mirrors ShipLoadout.fromJSON) so one stale id never voids the loadout.
    22: (state: SaveState) => {
      const s = state as unknown as {
        loadout?: ShipLoadoutSnapshot;
        player?: {
          ship?: {
            hullClass?: string;
            modules?: Array<LegacyModuleJSON | null>;
          };
          inventory?: { modules?: Array<LegacyModuleJSON | null> };
        };
      };
      const ship = s.player?.ship;

      // Installed fitting first (priority), then the loose inventory bag; the
      // canonical model has no bag, so spares are installed into free slots.
      const candidates = [
        ...(ship?.modules ?? []),
        ...(s.player?.inventory?.modules ?? []),
      ].filter(
        (m): m is LegacyModuleJSON =>
          !!m && !!gearById(m.id) && gearById(m.id)!.kind !== GearKind.HULL,
      );

      const toSlot = (
        m: LegacyModuleJSON,
      ): ShipLoadoutSnapshot["slotted"][number] =>
        m.micromoduleId
          ? { gearId: m.id, micromoduleId: m.micromoduleId }
          : { gearId: m.id };

      // A pre-v23 save can already carry a persisted `loadout`, but between
      // loadout-persistence (v19) and this migration NO shop flow fed the
      // loadout's *fitting* — only hull purchases reached it (via setHull), so
      // its hull + starter engine/tank are authoritative while the player's
      // bought and looted weapons/equipment still live in the legacy
      // `ship.modules` / `inventory.modules`. Fold that legacy fitting into the
      // loadout's free slots so it carries forward without data loss; we only
      // append (never drop existing loadout gear), so a genuinely authoritative
      // snapshot is preserved unchanged when there is nothing legacy to add.
      if (s.loadout) {
        const existing = s.loadout;
        const existingHull = gearById(existing.hullId) as HullSpec | undefined;
        const cap = existingHull?.slots ?? existing.slotted.length;
        const slotKey = (gearId: string, micromoduleId?: string): string =>
          micromoduleId ? `${gearId}#${micromoduleId}` : gearId;
        // Multiset of fittings already in the loadout, so a legacy module that is
        // already reflected there is consumed rather than duplicated — this keeps
        // the merge idempotent — while genuine duplicate copies (e.g. an installed
        // weapon plus a spare of the same id) still each land in their own slot.
        const present = new Map<string, number>();
        for (const slot of existing.slotted) {
          const key = slotKey(slot.gearId, slot.micromoduleId);
          present.set(key, (present.get(key) ?? 0) + 1);
        }
        for (const m of candidates) {
          const key = slotKey(m.id, m.micromoduleId);
          const have = present.get(key) ?? 0;
          if (have > 0) {
            present.set(key, have - 1);
            continue;
          }
          if (existing.slotted.length >= cap) break;
          existing.slotted.push(toSlot(m));
        }
        return;
      }

      const hullId = hullIdForHullClass(ship?.hullClass);
      const hull = gearById(hullId) as HullSpec | undefined;
      const slots = hull?.slots ?? 0;

      // Reserve an engine + fuel tank FIRST so the migrated ship can always take
      // off (legacy ships flew on a flat speed stat with no engine module; the
      // canonical model gates takeoff on an installed engine + tank). Prefer a
      // real migrated copy if the legacy fitting/bag carries one, else synthesize
      // the starter equivalent. Reserving *before* the slot-cap fill is what
      // guarantees both survive — otherwise a full set of installed weapons could
      // push a bagged engine/tank past the hull's slot count and ground the ship.
      const engineIdx = candidates.findIndex((m) =>
        isEquipmentClass(m.id, EquipmentClass.ENGINE),
      );
      const tankIdx = candidates.findIndex((m) =>
        isEquipmentClass(m.id, EquipmentClass.FUEL_TANK),
      );

      const slotted: ShipLoadoutSnapshot["slotted"] = [];
      slotted.push(
        engineIdx >= 0
          ? toSlot(candidates[engineIdx])
          : { gearId: MIGRATION_ENGINE_ID },
      );
      slotted.push(
        tankIdx >= 0
          ? toSlot(candidates[tankIdx])
          : { gearId: MIGRATION_TANK_ID },
      );

      // Fill the remaining slots with the rest of the fitting — installed gear
      // first (it precedes the bag in `candidates`), then loose spares — skipping
      // the engine/tank already reserved above.
      for (let i = 0; i < candidates.length; i++) {
        if (i === engineIdx || i === tankIdx) continue;
        if (slotted.length >= slots) break;
        slotted.push(toSlot(candidates[i]));
      }
      // A hull with fewer slots than the reserved engine+tank can't carry both;
      // never exceed the hull's slot count.
      if (slotted.length > slots) slotted.length = slots;

      s.loadout = { hullId, slotted };
    },
  };
}
