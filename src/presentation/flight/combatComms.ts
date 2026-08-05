import { shakedownTribute } from "@/systems/npc/NpcBrain";

export type CommsAction = "bribe" | "demand-surrender" | "call-for-help";

export interface CombatCommsConfig {
  readonly surrenderHullThreshold: Readonly<Record<string, number>>;
  readonly defaultSurrenderThreshold: number;
  readonly allyProximityRadius: number;
  readonly allyRoles: readonly string[];
}

export const DEFAULT_COMBAT_COMMS: CombatCommsConfig = {
  surrenderHullThreshold: {
    TRADER: 0.6,
    PATROL: 0.35,
    RANGER: 0.3,
    PIRATE: 0.2,
    OVERMIND: 0,
  },
  defaultSurrenderThreshold: 0.25,
  allyProximityRadius: 700,
  allyRoles: ["TRADER", "PATROL", "RANGER"],
};

export const COMBAT_COMMS_CATEGORY_KEY = "combat.comms.category";

export interface CommsActionDef {
  readonly id: CommsAction;
  readonly nameKey: string;
  readonly descKey: string;
}

export const COMBAT_COMMS_ACTIONS: readonly CommsActionDef[] = [
  {
    id: "bribe",
    nameKey: "combat.comms.bribe.name",
    descKey: "combat.comms.bribe.desc",
  },
  {
    id: "demand-surrender",
    nameKey: "combat.comms.surrender.name",
    descKey: "combat.comms.surrender.desc",
  },
  {
    id: "call-for-help",
    nameKey: "combat.comms.callHelp.name",
    descKey: "combat.comms.callHelp.desc",
  },
] as const;

export function commsActionById(
  id: string | null | undefined,
): CommsActionDef | null {
  if (!id) return null;
  return COMBAT_COMMS_ACTIONS.find((a) => a.id === id) ?? null;
}

export interface BribeResult {
  readonly tribute: number;
  readonly disengages: boolean;
}

export function resolveBribe(playerCredits: number): BribeResult {
  return { tribute: shakedownTribute(playerCredits), disengages: true };
}

export function surrenderThreshold(
  role: string,
  config: CombatCommsConfig = DEFAULT_COMBAT_COMMS,
): number {
  const t = config.surrenderHullThreshold[role];
  return t !== undefined ? t : config.defaultSurrenderThreshold;
}

export interface SurrenderResult {
  readonly surrenders: boolean;
}

export function resolveSurrenderDemand(
  role: string,
  hullFraction: number,
  config: CombatCommsConfig = DEFAULT_COMBAT_COMMS,
): SurrenderResult {
  const threshold = surrenderThreshold(role, config);
  if (threshold <= 0) return { surrenders: false };
  const frac = Number.isFinite(hullFraction)
    ? Math.min(1, Math.max(0, hullFraction))
    : 1;
  return { surrenders: frac <= threshold };
}

export function findCallForHelpAlly<T>(
  playerPos: { x: number; y: number },
  candidates: readonly T[],
  posOf: (c: T) => { x: number; y: number },
  roleOf: (c: T) => string,
  isAvailable: (c: T) => boolean = () => true,
  config: CombatCommsConfig = DEFAULT_COMBAT_COMMS,
): T | null {
  const radius = Math.max(0, config.allyProximityRadius);
  const r2 = radius * radius;
  let best: T | null = null;
  let bestD2 = Infinity;
  for (const c of candidates) {
    if (!config.allyRoles.includes(roleOf(c))) continue;
    if (!isAvailable(c)) continue;
    const p = posOf(c);
    const dx = p.x - playerPos.x;
    const dy = p.y - playerPos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
  }
  return best;
}
