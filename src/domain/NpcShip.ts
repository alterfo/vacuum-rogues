import type {
  FactionType,
  NpcRole,
  NpcState,
  NpcGoal,
  NpcShipInit,
} from "@/types";
import type { Faction } from "@/types/faction";

/**
 * Autonomous NPC ship that lives in the galaxy independent of the player
 * (other rangers, traders, pirates, patrols). Pure data class — behaviour is
 * driven by NpcSimulator / NpcBrain. Kept method-free so loaded saves (plain
 * objects) satisfy the shape without prototype rehydration.
 */
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
  }
}
