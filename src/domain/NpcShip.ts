import type {
  FactionType,
  NpcRole,
  NpcState,
  NpcGoal,
  NpcShipInit,
  NpcSizeTier,
} from "@/types";

import type { Faction } from "@/types/faction";

export class NpcShip {
  id: string;
  name: string;
  race: FactionType;
  faction: Faction;
  role: NpcRole;
  hullHP: number;
  maxHull: number;
  shields: number;
  speed: number;
  damage: number;
  currentSystemId: string;
  state: NpcState;
  goal: NpcGoal | null;
  destinationSystemId: string | null;
  daysToArrival: number;
  credits: number;
  reputation: number;
  shieldPower: number;
  loadoutSummary: string[];
  cargo: { goodId: string; qty: number }[];
  activeQuestTarget: string | null;
  convoyId?: string;
  worldX: number | null;
  worldY: number | null;
  hostile: boolean;
  sizeTier?: NpcSizeTier;

  constructor(init: NpcShipInit) {
    this.id = init.id;
    this.name = init.name;
    this.race = init.race;
    this.faction = init.faction;
    this.role = init.role;
    this.hullHP = init.hullHP;
    this.maxHull = init.maxHull;
    this.shields = init.shields;
    this.speed = init.speed;
    this.damage = init.damage;
    this.currentSystemId = init.currentSystemId;
    this.state = init.state;
    this.goal = init.goal;
    this.destinationSystemId = init.destinationSystemId;
    this.daysToArrival = init.daysToArrival;
    this.credits = init.credits;
    this.reputation = init.reputation;
    this.shieldPower = init.shieldPower ?? 0;
    this.loadoutSummary = init.loadoutSummary ?? [];
    this.cargo = init.cargo ?? [];
    this.activeQuestTarget = init.activeQuestTarget ?? null;
    this.convoyId = init.convoyId;
    this.worldX = init.worldX ?? null;
    this.worldY = init.worldY ?? null;
    this.hostile = init.hostile ?? false;
    this.sizeTier = init.sizeTier;
  }

  setWorldPosition(x: number, y: number): void {
    this.worldX = x;
    this.worldY = y;
  }

  hasWorldPosition(): boolean {
    return this.worldX != null && this.worldY != null;
  }

  markHostile(): void {
    this.hostile = true;
  }

  isAggressive(): boolean {
    return this.hostile === true;
  }
}
