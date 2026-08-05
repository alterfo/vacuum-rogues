import { Container, Graphics } from "pixi.js";
import type { NpcShip } from "@/domain/NpcShip";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { type SpaceLootItem, ResourceType } from "@/types";
import { Faction } from "@/types/faction";
import {
  GAME_BALANCE,
  ARTIFACT_DROP_CHANCE,
  OVERMIND_ARTIFACT_DROP,
} from "@/config/balance";
import {
  cargoCapacityOf,
  acquireUninstalledGear,
} from "@/systems/equipment/GearBridge";
import { gearById, gearIdForToken } from "@/systems/equipment/GearCatalog";
import { t } from "@/i18n/i18n";
import { logger } from "@/utils/logger";

const DEFAULT_LOOT_MODULES = [
  "salvaged_plating",
  "spare_capacitor",
  "scrap_thruster",
];

export interface LootPickupDeps {
  getPlayer(): Player | null;
  getLoadout(): ShipLoadout | null;
  getShipPosition(): { x: number; y: number } | null;
  showMessage(text: string, color?: number): void;
}

export class LootDropHandler {
  readonly spaceLoot: SpaceLootItem[] = [];
  readonly lootGraphics = new Map<string, Graphics>();
  private lootClockMs = 0;
  private readonly LOOT_TTL_MS = 60_000;

  constructor(private readonly gameLayer: Container) {}

  spawn(
    npc: NpcShip,
    worldX: number,
    worldY: number,
    rng: () => number = Math.random,
    day: number = Infinity,
    forcedCount?: number,
  ): void {
    const isOvermind = npc.faction === Faction.OVERMIND;
    const drop = isOvermind
      ? OVERMIND_ARTIFACT_DROP[npc.sizeTier ?? "small"]
      : undefined;
    const count = forcedCount ?? this.rollDropCount(npc, rng);
    const artifactChance = Math.min(
      1,
      ARTIFACT_DROP_CHANCE * (drop?.artifactChanceMult ?? 1),
    );
    for (let i = 0; i < count; i++) {
      let moduleId: string | undefined;
      let artifactId: string | undefined;
      if (isOvermind && rng() < artifactChance) {
        artifactId = "ARTIFACTS";
      } else {
        moduleId = this.pickModuleId(npc, rng, day);
      }
      const item: SpaceLootItem = {
        id: `loot_${npc.id}_${Math.floor(this.lootClockMs)}_${i}`,
        moduleId,
        artifactId,
        x: worldX,
        y: worldY,
        spawnedAt: this.lootClockMs,
      };
      this.spaceLoot.push(item);
      this.mountSprite(item);
    }
  }

  update(deltaTime: number): void {
    this.lootClockMs += deltaTime;
    if (this.spaceLoot.length === 0) return;
    const pulse =
      0.6 +
      0.4 * (0.5 + 0.5 * Math.sin((this.lootClockMs / 1000) * Math.PI * 2));
    for (let i = this.spaceLoot.length - 1; i >= 0; i--) {
      const item = this.spaceLoot[i];
      if (this.lootClockMs - item.spawnedAt > this.LOOT_TTL_MS) {
        this.removeAt(i);
        continue;
      }
      const g = this.lootGraphics.get(item.id);
      if (g) g.alpha = pulse;
    }
  }

  collectIfInRange(deps: LootPickupDeps): void {
    if (this.spaceLoot.length === 0) return;
    const loadout = deps.getLoadout();
    const player = deps.getPlayer();
    const pos = deps.getShipPosition();
    if (!loadout || !player || !pos) return;
    const stats = loadout.derivedStats();
    const baseRadius = GAME_BALANCE.lootPickupRadius;
    const range = Math.max(baseRadius, stats.gravTractorRange);
    if (range <= 0) return;
    const rangeSq = range * range;
    const baseSq = baseRadius * baseRadius;
    const capacity = cargoCapacityOf(loadout);
    for (let i = this.spaceLoot.length - 1; i >= 0; i--) {
      const item = this.spaceLoot[i];
      const dx = item.x - pos.x;
      const dy = item.y - pos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) continue;
      const handsOn = distSq <= baseSq;

      const gearId = item.moduleId ? gearIdForToken(item.moduleId) : undefined;
      if (gearId) {
        acquireUninstalledGear(player, gearId);
        this.removeAt(i);
        const label = gearById(gearId)?.name ?? gearId;
        deps.showMessage(
          handsOn
            ? t("flight.lootPickup", { item: label })
            : t("flight.lootTractor", { item: label }),
          0xffdd33,
        );
        logger.info(`Picked up gear loot ${item.id} (${gearId})`);
        continue;
      }

      const used = player.inventory.resources.reduce(
        (sum, r) => sum + r.amount,
        0,
      );
      if (used >= capacity) {
        logger.warn("Loot pickup: hold full, drop left in space");
        continue;
      }
      const type = item.artifactId
        ? ResourceType.ARTIFACTS
        : ResourceType.METALS;
      player.inventory.addResource(type, 1);
      this.removeAt(i);
      const label = item.artifactId
        ? t("flight.lootArtifact")
        : t("flight.lootModule");
      deps.showMessage(
        handsOn
          ? t("flight.lootPickup", { item: label })
          : t("flight.lootTractor", { item: label }),
        0xffdd33,
      );
      logger.info(`Picked up loot ${item.id} (${type})`);
    }
  }

  destroy(): void {
    for (const g of this.lootGraphics.values()) {
      if (g.parent) g.parent.removeChild(g);
      if (!g.destroyed) g.destroy();
    }
    this.lootGraphics.clear();
    this.spaceLoot.length = 0;
  }

  rollDropCount(npc: NpcShip, rng: () => number = Math.random): number {
    const drop =
      npc.faction === Faction.OVERMIND
        ? OVERMIND_ARTIFACT_DROP[npc.sizeTier ?? "small"]
        : undefined;
    return this.rollLootCount(rng) + (drop?.bonusLootRolls ?? 0);
  }

  private rollLootCount(rng: () => number): number {
    const r = rng();
    if (r < 1 / 3) return 0;
    if (r < 2 / 3) return 1;
    return 2;
  }

  private pickModuleId(npc: NpcShip, rng: () => number, day: number): string {
    const pool =
      npc.loadoutSummary.length > 0 ? npc.loadoutSummary : DEFAULT_LOOT_MODULES;
    const eligible = pool.filter((token) => {
      const gearId = gearIdForToken(token);
      const minDay = gearId ? gearById(gearId)?.minDay : undefined;
      return minDay === undefined || day >= minDay;
    });
    const usable = eligible.length > 0 ? eligible : pool;
    return usable[Math.floor(rng() * usable.length) % usable.length];
  }

  private mountSprite(item: SpaceLootItem): void {
    const color = item.artifactId ? 0x33ffff : 0xffdd33;
    const g = new Graphics();
    g.circle(0, 0, 10).fill({ color, alpha: 0.22 });
    g.circle(0, 0, 5).fill({ color, alpha: 0.95 });
    g.x = item.x;
    g.y = item.y;
    g.zIndex = 90; // above planet discs (50), below NPC hulls (100)
    g.eventMode = "none";
    this.gameLayer.addChild(g);
    this.lootGraphics.set(item.id, g);
  }

  private removeAt(index: number): void {
    const item = this.spaceLoot[index];
    if (!item) return;
    const g = this.lootGraphics.get(item.id);
    if (g) {
      if (g.parent) g.parent.removeChild(g);
      if (!g.destroyed) g.destroy();
      this.lootGraphics.delete(item.id);
    }
    this.spaceLoot.splice(index, 1);
  }
}
