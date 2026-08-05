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
import { legacyModuleToGearId } from "@/systems/equipment/GearBridge";
import { deterministicNpcOffset } from "@/systems/npc/npcPlacement";
import { initialOvermindSpreadState } from "@/systems/overmind/overmindSpread";
import { logger } from "@/utils/logger";

interface LegacyModuleJSON {
  id: string;
  micromoduleId?: string;
}

const MIGRATION_ENGINE_ID = "eq_engine_i";
const MIGRATION_TANK_ID = "eq_tank";

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
  static readonly CURRENT_VERSION = 28;

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
    0: (state: SaveState) => {
      if (!state.persistentDialogs) {
        state.persistentDialogs = [];
      }
    },
    1: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { npcShips?: unknown[] };
      if (galaxy && !Array.isArray(galaxy.npcShips)) {
        galaxy.npcShips = [];
      }
    },
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
    3: (state: SaveState) => {
      const player = state.player as unknown as { contrabandGoods?: string[] };
      if (player && !Array.isArray(player.contrabandGoods)) {
        player.contrabandGoods = [];
      }
    },
    4: (state: SaveState) => {
      const ship = (
        state.player as unknown as { ship?: { hullClass?: string } }
      )?.ship;
      if (ship && !ship.hullClass) {
        ship.hullClass = "CORVETTE";
      }
    },
    5: (state: SaveState) => {
      const inventory = (
        state.player as unknown as { inventory?: { micromodules?: unknown[] } }
      )?.inventory;
      if (inventory && !Array.isArray(inventory.micromodules)) {
        inventory.micromodules = [];
      }
    },
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
    8: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { questBoards?: unknown };
      if (galaxy && !galaxy.questBoards) {
        galaxy.questBoards = {};
      }
    },
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
    11: (_state: SaveState) => {
      // No migration needed — field is optional with no required default value.
    },
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
    14: (state: SaveState) => {
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
        if (Array.isArray(galaxy.npcShips)) {
          for (const npc of galaxy.npcShips) {
            if (!Array.isArray(npc.cargo)) npc.cargo = [];
            if (!Array.isArray(npc.loadoutSummary)) npc.loadoutSummary = [];
            if (npc.shieldPower === undefined) npc.shieldPower = 0;
          }
        }
      }
      const player = state.player as unknown as {
        activeTextQuestState?: unknown;
      };
      if (player && player.activeTextQuestState === undefined) {
        player.activeTextQuestState = null;
      }
    },
    15: (state: SaveState) => {
      const player = state.player as unknown as { visitedSystems?: string[] };
      if (player && !Array.isArray(player.visitedSystems)) {
        player.visitedSystems = [];
      }
    },
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
    17: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as { pirateSystems?: string[] };
      if (galaxy && !Array.isArray(galaxy.pirateSystems)) {
        galaxy.pirateSystems = [];
      }
    },
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
    20: (_state: SaveState) => {
      // No-op: convoyId is optional and absent by default on old ships.
    },
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

      const folded = new Set<LegacyModuleJSON>();
      const dropFoldedFromBag = (): void => {
        const bag = s.player?.inventory?.modules;
        if (!bag || folded.size === 0) return;
        s.player!.inventory!.modules = bag.filter((m) => !m || !folded.has(m));
      };

      if (s.loadout) {
        const existing = s.loadout;
        const existingHull = gearById(existing.hullId) as HullSpec | undefined;
        const cap = existingHull?.slots ?? existing.slotted.length;
        const slotKey = (gearId: string, micromoduleId?: string): string =>
          micromoduleId ? `${gearId}#${micromoduleId}` : gearId;
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
          folded.add(m);
        }
        dropFoldedFromBag();
        return;
      }

      const hullId = hullIdForHullClass(ship?.hullClass);
      const hull = gearById(hullId) as HullSpec | undefined;
      const slots = hull?.slots ?? 0;

      const engineIdx = candidates.findIndex((m) =>
        isEquipmentClass(m.id, EquipmentClass.ENGINE),
      );
      const tankIdx = candidates.findIndex((m) =>
        isEquipmentClass(m.id, EquipmentClass.FUEL_TANK),
      );

      const slotted: ShipLoadoutSnapshot["slotted"] = [];
      if (engineIdx >= 0) {
        slotted.push(toSlot(candidates[engineIdx]));
        folded.add(candidates[engineIdx]);
      } else {
        slotted.push({ gearId: MIGRATION_ENGINE_ID });
      }
      if (tankIdx >= 0) {
        slotted.push(toSlot(candidates[tankIdx]));
        folded.add(candidates[tankIdx]);
      } else {
        slotted.push({ gearId: MIGRATION_TANK_ID });
      }

      for (let i = 0; i < candidates.length; i++) {
        if (i === engineIdx || i === tankIdx) continue;
        if (slotted.length >= slots) break;
        slotted.push(toSlot(candidates[i]));
        folded.add(candidates[i]);
      }
      if (slotted.length > slots) slotted.length = slots;

      s.loadout = { hullId, slotted };
      dropFoldedFromBag();
    },
    23: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        id?: string;
        npcShips?: Array<{
          id: string;
          worldX?: number | null;
          worldY?: number | null;
        }>;
      };
      if (galaxy && Array.isArray(galaxy.npcShips)) {
        const seed = galaxy.id ?? "galaxy";
        for (const npc of galaxy.npcShips) {
          if (
            npc.worldX === undefined ||
            npc.worldX === null ||
            npc.worldY === undefined ||
            npc.worldY === null
          ) {
            const pos = deterministicNpcOffset(seed, npc.id);
            npc.worldX = pos.x;
            npc.worldY = pos.y;
          }
        }
      }
    },
    24: (state: SaveState) => {
      const inventory = (
        state.player as unknown as {
          inventory?: {
            modules?: Array<{ id: string; category?: string } | null>;
            ownedGearIds?: string[];
          };
        }
      )?.inventory;
      if (!inventory || !Array.isArray(inventory.modules)) return;
      if (!Array.isArray(inventory.ownedGearIds)) inventory.ownedGearIds = [];
      const remaining: Array<{ id: string; category?: string } | null> = [];
      for (const mod of inventory.modules) {
        const gearId = mod ? legacyModuleToGearId(mod) : undefined;
        if (gearId) {
          inventory.ownedGearIds.push(gearId);
        } else {
          remaining.push(mod);
        }
      }
      inventory.modules = remaining;
    },
    25: (state: SaveState) => {
      const loadout = (
        state as unknown as {
          loadout?: {
            hullMicromoduleId?: string;
            hullMicromoduleIds?: string[];
          };
        }
      ).loadout;
      if (!loadout) return;
      if (!Array.isArray(loadout.hullMicromoduleIds)) {
        loadout.hullMicromoduleIds = loadout.hullMicromoduleId
          ? [loadout.hullMicromoduleId]
          : [];
      }
      delete loadout.hullMicromoduleId;
    },
    26: (state: SaveState) => {
      const player = state.player as unknown as { gameMode?: string };
      if (player && player.gameMode === undefined) {
        player.gameMode = "NORMAL";
      }
    },
    27: (state: SaveState) => {
      const galaxy = state.galaxy as unknown as {
        overmindArc?: unknown;
      };
      if (galaxy && !galaxy.overmindArc) {
        galaxy.overmindArc = initialOvermindSpreadState();
      }
    },
  };
}
