import type { Galaxy } from "@/domain/Galaxy";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, NpcGoalKind, FactionType } from "@/types";
import type { GameMode, NewsEvent, NpcSizeTier } from "@/types";
import { Faction } from "@/types/faction";
import {
  scaledGarrisonRange,
  OVERMIND_BOSS_TIER,
  OVERMIND_SIZE_TIERS,
  OVERMIND_GARRISON_DISCOUNT_FLOOR,
} from "@/config/balance";
import {
  overmindGarrisonPowerBonus,
  overmindGarrisonPowerDiscount,
} from "@/systems/campaign/hostileScaling";
import {
  factionKindOf,
  isHostile,
  mutuallyHostile,
  pirateCoordination,
} from "./factionHostility";
import { selectPirateTarget } from "./NpcBrain";
import {
  ROLE_STATS,
  ROLE_LOADOUT,
  ROLE_NAME,
  FACTION_NAME,
  overmindSizeTierForId,
} from "./npcRoleCatalog";
import { travelDays } from "./npcTravel";
import { SeededRNG } from "@/utils/seededRNG";
import { logger } from "@/utils/logger";
import {
  creditNpc,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import {
  systemsWithActiveBattle,
  type BattleShip,
} from "@/utils/battleSystems";

const PIRATE_DAMAGE_FRACTION = 0.5;
const VICTIM_RETALIATION_FRACTION = 0.3;
const PIRATE_LOOT = 200;

const PIRATE_CARGO_RAID_CHANCE = 0.05;

const CONVOY_MAX_SHIPS = 3;

const GARRISON_MIN = 5;
const GARRISON_MAX = 10;
const GARRISON_DISCOUNT_FLOOR = OVERMIND_GARRISON_DISCOUNT_FLOOR;

const GARRISON_GROWTH_BUD_THRESHOLD = 1.5;
const GARRISON_BUD_OFF_FRACTION = 0.5;

const CAPTURE_FLEET_MIN = 3;
const CAPTURE_FLEET_MAX = 5;

const LIBERATION_RALLY_DELAY = 30;
const LIBERATION_RALLY_MAX_SHIPS = 8;
const RECENTLY_CAPTURED_MAX = 5;

const LIBERATION_CLEAR_DAYS = 3;

interface LiberationCampaign {
  targetSystemId: string;
  stagingSystemId: string;
  liberationDate: number;
  dispatched: boolean;
}

export interface DwellTracker {
  mark(id: string): void;
  clear(id: string): void;
}

export class NpcGarrisonCombat {
  private readonly garrisonIds = new Set<string>();
  private readonly captureFleetIds = new Set<string>();
  private readonly liberationAssaultIds = new Set<string>();
  private readonly liberationCampaigns: LiberationCampaign[] = [];
  private readonly establishedGarrisons = new Set<string>();
  private readonly garrisonBaseline = new Map<string, number>();
  private readonly recentlyCaptured: string[] = [];
  private readonly liberationCountdown = new Map<string, number>();

  private bank: BankAccess | null = null;

  private gameMode: GameMode = "NORMAL";

  private campaignPeakPowerSource: (() => number) | null = null;

  constructor(private readonly dwell: DwellTracker) {}

  attachBank(access: BankAccess | null): void {
    this.bank = access;
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
  }

  attachCampaignPeakPower(source: (() => number) | null): void {
    this.campaignPeakPowerSource = source;
  }

  isHeld(id: string): boolean {
    return (
      this.garrisonIds.has(id) ||
      this.captureFleetIds.has(id) ||
      this.liberationAssaultIds.has(id)
    );
  }

  isGarrisonOrCaptureFleet(id: string): boolean {
    return this.garrisonIds.has(id) || this.captureFleetIds.has(id);
  }

  releaseHeldId(id: string): void {
    this.garrisonIds.delete(id);
    this.captureFleetIds.delete(id);
    this.liberationAssaultIds.delete(id);
  }

  enrollLiberationAssault(id: string): void {
    this.liberationAssaultIds.add(id);
  }

  spawnPirateInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip {
    const stats = ROLE_STATS[NpcRole.PIRATE];
    const faction = FactionType.OUTLANDERS;
    this.dwell.mark(id);
    return new NpcShip({
      id,
      name: `${ROLE_NAME[NpcRole.PIRATE]} ${FACTION_NAME[faction]} ${id}`,
      race: faction,
      faction: faction as unknown as import("@/types/faction").Faction,
      role: NpcRole.PIRATE,
      hullHP: stats.hull,
      maxHull: stats.hull,
      shields: stats.shields,
      speed: stats.speed,
      damage: stats.damage,
      currentSystemId: systemId,
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: rng.nextInt(50, 300),
      reputation: 0,
      shieldPower: stats.shieldPower,
      loadoutSummary: ROLE_LOADOUT[NpcRole.PIRATE],
      cargo: [],
      hostile: true,
    });
  }

  spawnOvermindInSystem(
    rng: SeededRNG,
    id: string,
    systemId: string,
    sizeTier?: NpcSizeTier,
  ): NpcShip {
    const stats = ROLE_STATS[NpcRole.OVERMIND];
    const tier = sizeTier ?? "medium";
    const hull =
      tier === "boss"
        ? OVERMIND_BOSS_TIER.hull
        : Math.round(stats.hull * OVERMIND_SIZE_TIERS[tier].statMult);
    const damage = tier === "boss" ? OVERMIND_BOSS_TIER.damage : stats.damage;
    this.dwell.mark(id);
    return new NpcShip({
      id,
      name: `Жнец ${id}`,
      race: FactionType.PARADOXES,
      faction: Faction.OVERMIND,
      role: NpcRole.OVERMIND,
      hullHP: hull,
      maxHull: hull,
      shields: stats.shields,
      speed: stats.speed,
      damage,
      sizeTier: tier,
      currentSystemId: systemId,
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: rng.nextInt(50, 300),
      reputation: 0,
      shieldPower: stats.shieldPower,
      loadoutSummary: ROLE_LOADOUT[NpcRole.OVERMIND],
      cargo: [],
      hostile: true,
    });
  }

  private countGarrisonPresent(galaxy: Galaxy, systemId: string): number {
    let count = 0;
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId !== systemId) continue;
      if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
      if (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE) count++;
    }
    return count;
  }

  private countGarrisonMembers(galaxy: Galaxy, systemId: string): number {
    let count = 0;
    for (const n of galaxy.npcShips) {
      if (n.currentSystemId !== systemId) continue;
      if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
      if (this.garrisonIds.has(n.id)) count++;
    }
    return count;
  }

  battleSystemIds(galaxy: Galaxy): Set<string> {
    const present: BattleShip[] = [];
    for (const n of galaxy.npcShips) {
      if (n.state === NpcState.DEAD || n.state === NpcState.TRAVELING) continue;
      present.push({
        systemId: n.currentSystemId,
        hostile: n.hostile,
        faction: n.faction,
        role: n.role,
      });
    }
    return systemsWithActiveBattle(present);
  }

  reconcileTransientState(galaxy: Galaxy): void {
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD) continue;
      if (npc.id.startsWith("garrison_")) {
        this.garrisonIds.add(npc.id);
      } else if (npc.id.startsWith("capture_")) {
        const parkedInHostile =
          npc.state !== NpcState.TRAVELING &&
          galaxy.isHostileSystem(npc.currentSystemId);
        if (parkedInHostile) this.garrisonIds.add(npc.id);
        else this.captureFleetIds.add(npc.id);
      } else if (
        npc.convoyId?.startsWith("liberation_") &&
        npc.state !== NpcState.TRAVELING
      ) {
        if (galaxy.isHostileSystem(npc.currentSystemId)) {
          this.liberationAssaultIds.add(npc.id);
        } else {
          npc.convoyId = undefined;
        }
      }
    }
  }

  ensureGarrison(galaxy: Galaxy, rng: SeededRNG): void {
    this.reconcileTransientState(galaxy);
    for (const systemId of galaxy.overmindSystems) {
      this.fillGarrison(galaxy, rng, systemId, true);
    }
    for (const systemId of galaxy.pirateSystems) {
      this.fillGarrison(galaxy, rng, systemId, false);
    }
  }

  private fillGarrison(
    galaxy: Galaxy,
    rng: SeededRNG,
    systemId: string,
    overmind: boolean,
  ): void {
    const peakPower = this.campaignPeakPowerSource?.() ?? 0;
    const powerBonus = overmind ? overmindGarrisonPowerBonus(peakPower) : 0;
    const powerDiscount =
      this.gameMode !== "GOD" ? overmindGarrisonPowerDiscount(peakPower) : 0;
    const netDelta = powerBonus - powerDiscount;
    const scaledMin = Math.max(
      GARRISON_DISCOUNT_FLOOR,
      GARRISON_MIN + netDelta,
    );
    const scaledMax = Math.max(scaledMin, GARRISON_MAX + netDelta);
    const { min: garrisonMin, max: garrisonMax } = scaledGarrisonRange(
      this.gameMode,
      scaledMin,
      scaledMax,
    );
    let present = this.countGarrisonPresent(galaxy, systemId);
    if (present >= garrisonMin) {
      this.establishedGarrisons.add(systemId);
      this.anchorGarrisonBaseline(
        systemId,
        this.countGarrisonMembers(galaxy, systemId),
        garrisonMin,
        garrisonMax,
      );
      return;
    }
    if (present === 0 && this.establishedGarrisons.has(systemId)) return;
    if (this.underLiberationAssault(galaxy, systemId)) return;
    const target = rng.nextInt(garrisonMin, garrisonMax);
    let spawned = 0;
    while (present < target) {
      const id = `garrison_${overmind ? "ov" : "pi"}_${systemId}_${galaxy.gameDays}_${spawned}`;
      const ship = overmind
        ? this.spawnOvermindInSystem(
            rng,
            id,
            systemId,
            overmindSizeTierForId(id),
          )
        : this.spawnPirateInSystem(rng, id, systemId);
      galaxy.npcShips.push(ship);
      this.garrisonIds.add(id);
      present++;
      spawned++;
    }
    this.establishedGarrisons.add(systemId);
    this.anchorGarrisonBaseline(
      systemId,
      this.countGarrisonMembers(galaxy, systemId),
      garrisonMin,
      garrisonMax,
    );
    logger.info(
      `Garrison: spawned ${spawned} hostile ships in ${systemId} (now ${present})`,
    );
  }

  private anchorGarrisonBaseline(
    systemId: string,
    present: number,
    garrisonMin: number,
    garrisonMax: number,
  ): void {
    const prior = this.garrisonBaseline.get(systemId);
    if (prior === undefined) {
      this.garrisonBaseline.set(systemId, Math.min(present, garrisonMax));
    } else if (prior < garrisonMin) {
      this.garrisonBaseline.set(systemId, garrisonMin);
    }
  }

  growGarrisons(galaxy: Galaxy, rng: SeededRNG, playerSystemId?: string): void {
    const powerBonus = overmindGarrisonPowerBonus(
      this.campaignPeakPowerSource?.() ?? 0,
    );
    if (powerBonus < 1) return;
    for (const systemId of galaxy.overmindSystems) {
      if (playerSystemId !== undefined && systemId === playerSystemId) {
        continue;
      }
      const baseline = this.garrisonBaseline.get(systemId);
      if (baseline === undefined) continue;
      const present = this.countGarrisonMembers(galaxy, systemId);
      if (present === 0) continue;
      if (this.underLiberationAssault(galaxy, systemId)) continue;
      const cap = Math.round(baseline * GARRISON_GROWTH_BUD_THRESHOLD);
      if (present >= cap) {
        this.budOffGarrison(galaxy, rng, systemId, baseline, present);
        continue;
      }
      const id = `garrison_ovg_${systemId}_${galaxy.gameDays}`;
      galaxy.npcShips.push(
        this.spawnOvermindInSystem(
          rng,
          id,
          systemId,
          overmindSizeTierForId(id),
        ),
      );
      this.garrisonIds.add(id);
      logger.info(
        `Garrison growth: +1 ship in ${systemId} (now ${present + 1}/${cap})`,
      );
    }
  }

  private budOffGarrison(
    galaxy: Galaxy,
    rng: SeededRNG,
    systemId: string,
    baseline: number,
    present: number,
  ): void {
    const targetId = this.pickBudOffTarget(galaxy, rng, systemId);
    if (!targetId) return;
    const donors = galaxy.npcShips.filter(
      (n) =>
        n.currentSystemId === systemId &&
        n.state !== NpcState.DEAD &&
        n.state !== NpcState.TRAVELING &&
        this.garrisonIds.has(n.id),
    );
    const count = Math.min(
      donors.length,
      Math.max(1, Math.round(baseline * GARRISON_BUD_OFF_FRACTION)),
    );
    if (count === 0) return;
    for (const donor of donors.slice(0, count)) {
      this.garrisonIds.delete(donor.id);
      this.dwell.clear(donor.id);
      const idx = galaxy.npcShips.indexOf(donor);
      if (idx >= 0) galaxy.npcShips.splice(idx, 1);
    }
    this.launchCaptureFleet(
      galaxy,
      rng,
      systemId,
      targetId,
      count,
      `capture_bud_${systemId}_${galaxy.gameDays}`,
    );
    this.garrisonBaseline.set(systemId, present - count);
    logger.info(
      `Garrison bud-off: ${count} ships leave ${systemId} to seize ${targetId}`,
    );
  }

  private pickBudOffTarget(
    galaxy: Galaxy,
    rng: SeededRNG,
    sourceId: string,
  ): string | null {
    const adjacent = this.undirectedNeighbors(galaxy, sourceId).filter(
      (id) => !galaxy.isHostileSystem(id),
    );
    if (adjacent.length > 0) {
      return adjacent[rng.nextInt(0, adjacent.length - 1)];
    }
    const distant = galaxy.systems.filter(
      (s) => s.id !== sourceId && !galaxy.isHostileSystem(s.id),
    );
    if (distant.length === 0) return null;
    const weights = distant.map((s) => 1 / travelDays(galaxy, sourceId, s.id));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    for (let i = 0; i < distant.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return distant[i].id;
    }
    return distant[distant.length - 1].id;
  }

  undirectedNeighbors(galaxy: Galaxy, systemId: string): string[] {
    const ids = new Set<string>();
    for (const sys of galaxy.systems) {
      if (sys.id === systemId) {
        for (const conn of sys.connections) ids.add(conn.toSystemId);
      } else if (sys.connections.some((c) => c.toSystemId === systemId)) {
        ids.add(sys.id);
      }
    }
    ids.delete(systemId);
    return [...ids];
  }

  resolveLiberationDetection(galaxy: Galaxy): void {
    const hostile = [...galaxy.overmindSystems, ...galaxy.pirateSystems];
    const hostileSet = new Set(hostile);

    for (const id of [...this.liberationCountdown.keys()]) {
      if (!hostileSet.has(id)) this.liberationCountdown.delete(id);
    }
    for (const id of [...this.establishedGarrisons]) {
      if (!hostileSet.has(id)) this.establishedGarrisons.delete(id);
    }
    for (const id of [...this.garrisonBaseline.keys()]) {
      if (!hostileSet.has(id)) this.garrisonBaseline.delete(id);
    }

    for (let i = galaxy.npcShips.length - 1; i >= 0; i--) {
      const ship = galaxy.npcShips[i];
      if (!this.garrisonIds.has(ship.id)) continue;
      if (hostileSet.has(ship.currentSystemId)) continue;
      this.garrisonIds.delete(ship.id);
      galaxy.npcShips.splice(i, 1);
    }

    for (const systemId of hostile) {
      if (this.countGarrisonPresent(galaxy, systemId) > 0) {
        this.liberationCountdown.delete(systemId);
        continue;
      }
      const remaining =
        (this.liberationCountdown.get(systemId) ?? LIBERATION_CLEAR_DAYS) - 1;
      if (remaining <= 0) {
        this.liberationCountdown.delete(systemId);
        this.establishedGarrisons.delete(systemId);
        this.garrisonBaseline.delete(systemId);
        if (galaxy.tryLiberate(systemId)) {
          logger.info(
            `System ${systemId} liberated: garrison cleared and held`,
          );
        }
      } else {
        this.liberationCountdown.set(systemId, remaining);
      }
    }
  }

  resolveOffscreenPirateRaids(
    galaxy: Galaxy,
    rng: SeededRNG,
    playerSystemId?: string,
  ): NewsEvent[] {
    const events: NewsEvent[] = [];
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING)
        continue;
      if (npc.currentSystemId === playerSystemId) continue;
      if (this.garrisonIds.has(npc.id)) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, ships] of bySystem) {
      const pirates = ships.filter((s) => s.role === NpcRole.PIRATE);
      const traders = ships.filter(
        (s) => s.role === NpcRole.TRADER && s.cargo.length > 0,
      );
      if (pirates.length === 0 || traders.length === 0) continue;

      for (const pirate of pirates) {
        if (rng.next() >= PIRATE_CARGO_RAID_CHANCE) continue;
        const alive = traders.filter((t) => t.state !== NpcState.DEAD);
        if (alive.length === 0) continue;
        const target = alive[rng.nextInt(0, alive.length - 1)];
        target.cargo = [];
        events.push({
          type: "PIRATE_ATTACK",
          systemId,
          day: galaxy.gameDays,
          description: `Пираты атаковали торговца в системе ${systemId}`,
        });
        logger.info(
          `NPC pirate ${pirate.name} raided ${target.name}'s cargo in ${systemId}`,
        );
      }
    }
    return events;
  }

  resolveOffscreenCombat(
    galaxy: Galaxy,
    rng: SeededRNG,
    playerSystemId?: string,
  ): void {
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === playerSystemId) continue;
      if (this.garrisonIds.has(npc.id)) continue;
      if (this.captureFleetIds.has(npc.id)) continue;
      if (this.liberationAssaultIds.has(npc.id)) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, ships] of bySystem) {
      const pirates = ships.filter((s) => s.role === NpcRole.PIRATE);
      const victims = ships.filter(
        (s) => s.role !== NpcRole.PIRATE && s.faction !== Faction.OVERMIND,
      );
      if (pirates.length === 0 || victims.length === 0) continue;

      const pack =
        pirateCoordination(
          galaxy.isPirateSystem(systemId) ? "pirate" : null,
        ) === "pack";

      for (const pirate of pirates) {
        if (pirate.state === NpcState.DEAD) continue;
        const alive = victims.filter((v) => v.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const victim = pack
          ? this.packFocusVictim(alive)
          : alive[rng.nextInt(0, alive.length - 1)];
        pirate.state = NpcState.FIGHTING;
        victim.state = NpcState.FIGHTING;

        victim.hullHP -= Math.max(
          1,
          Math.round(pirate.damage * PIRATE_DAMAGE_FRACTION),
        );
        pirate.hullHP -= Math.max(
          1,
          Math.round(victim.damage * VICTIM_RETALIATION_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          creditNpc(
            this.bank,
            pirate,
            PIRATE_LOOT,
            GL_COUNTERPARTY.PLUNDER,
            "Пиратский трофей",
          );
          logger.info(
            `NPC ${pirate.name} destroyed ${victim.name} in ${pirate.currentSystemId}`,
          );
        }
        if (pirate.hullHP <= 0) {
          pirate.hullHP = 0;
          pirate.state = NpcState.DEAD;
        }
      }
    }

    this.resolveGarrisonOffscreenCombat(galaxy, playerSystemId);

    this.resolveCrossFactionCombat(galaxy, playerSystemId);

    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.FIGHTING) {
        npc.state = NpcState.PATROLLING;
      }
    }
  }

  private packFocusVictim(alive: NpcShip[]): NpcShip {
    const candidates = alive.map((v) => ({
      id: v.id,
      kind: factionKindOf(v),
      stats: { hullHP: v.hullHP, shields: v.shields, damage: v.damage },
    }));
    const pick = selectPirateTarget(candidates, { pirateRep: 0 });
    return alive.find((v) => v.id === pick?.id) ?? alive[0];
  }

  private resolveGarrisonOffscreenCombat(
    galaxy: Galaxy,
    playerSystemId?: string,
  ): void {
    const rng = new SeededRNG(`garrison_combat_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === playerSystemId) continue;
      if (!galaxy.isHostileSystem(npc.currentSystemId)) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const ships of bySystem.values()) {
      const garrison = ships.filter(
        (s) => this.garrisonIds.has(s.id) && s.faction === Faction.OVERMIND,
      );
      const victims = ships.filter(
        (s) =>
          !this.garrisonIds.has(s.id) &&
          !this.liberationAssaultIds.has(s.id) &&
          isHostile("overmind", factionKindOf(s), { pirateRep: 0 }),
      );
      if (garrison.length === 0 || victims.length === 0) continue;

      for (const attacker of garrison) {
        if (attacker.state === NpcState.DEAD) continue;
        const alive = victims.filter((v) => v.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const victim = alive[rng.nextInt(0, alive.length - 1)];
        attacker.state = NpcState.FIGHTING;
        victim.state = NpcState.FIGHTING;

        victim.hullHP -= Math.max(
          1,
          Math.round(attacker.damage * PIRATE_DAMAGE_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          logger.info(
            `Garrison ${attacker.name} destroyed ${victim.name} in ${attacker.currentSystemId}`,
          );
        }
      }
    }
  }

  private resolveCrossFactionCombat(
    galaxy: Galaxy,
    playerSystemId?: string,
  ): void {
    const rng = new SeededRNG(`crossfaction_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === playerSystemId) continue;
      if (this.garrisonIds.has(npc.id)) continue;
      if (this.captureFleetIds.has(npc.id)) continue;
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    if (!mutuallyHostile("overmind", "pirate", { pirateRep: 0 })) return;

    for (const ships of bySystem.values()) {
      const overminds = ships.filter((s) => factionKindOf(s) === "overmind");
      const pirates = ships.filter((s) => factionKindOf(s) === "pirate");
      if (overminds.length === 0 || pirates.length === 0) continue;

      for (const ov of overminds) {
        if (ov.state === NpcState.DEAD) continue;
        const alive = pirates.filter((p) => p.state !== NpcState.DEAD);
        if (alive.length === 0) break;

        const pirate = alive[rng.nextInt(0, alive.length - 1)];
        ov.state = NpcState.FIGHTING;
        pirate.state = NpcState.FIGHTING;

        pirate.hullHP -= Math.max(
          1,
          Math.round(ov.damage * PIRATE_DAMAGE_FRACTION),
        );
        ov.hullHP -= Math.max(
          1,
          Math.round(pirate.damage * PIRATE_DAMAGE_FRACTION),
        );

        if (pirate.hullHP <= 0) {
          pirate.hullHP = 0;
          pirate.state = NpcState.DEAD;
          logger.info(
            `Overmind ${ov.name} destroyed pirate ${pirate.name} in ${ov.currentSystemId}`,
          );
        }
        if (ov.hullHP <= 0) {
          ov.hullHP = 0;
          ov.state = NpcState.DEAD;
          logger.info(
            `Pirate destroyed Overmind ${ov.name} in ${ov.currentSystemId}`,
          );
        }
      }
    }
  }

  assembleConvoys(galaxy: Galaxy, rng: SeededRNG): void {
    const contestedBorders: Array<{
      hostileId: string;
      friendlyNeighbourId: string;
    }> = [];
    for (const sys of galaxy.systems) {
      if (!galaxy.isHostileSystem(sys.id)) continue;
      for (const conn of sys.connections) {
        if (!galaxy.isHostileSystem(conn.toSystemId)) {
          contestedBorders.push({
            hostileId: sys.id,
            friendlyNeighbourId: conn.toSystemId,
          });
          break;
        }
      }
    }
    if (contestedBorders.length === 0) return;

    const border =
      contestedBorders[rng.nextInt(0, contestedBorders.length - 1)];
    const { hostileId, friendlyNeighbourId } = border;

    const candidatePatrols = galaxy.npcShips.filter(
      (n) =>
        n.role === NpcRole.PATROL &&
        n.state !== NpcState.TRAVELING &&
        n.state !== NpcState.DEAD &&
        !n.convoyId &&
        n.currentSystemId === friendlyNeighbourId,
    );

    if (candidatePatrols.length === 0) return;

    const count = Math.min(
      CONVOY_MAX_SHIPS,
      candidatePatrols.length,
      rng.nextInt(2, CONVOY_MAX_SHIPS),
    );
    const convoyId = `convoy_${galaxy.gameDays}_${hostileId}`;
    const daysToArrival = travelDays(galaxy, friendlyNeighbourId, hostileId);

    for (let i = 0; i < count; i++) {
      const npc = candidatePatrols[i];
      npc.convoyId = convoyId;
      npc.destinationSystemId = hostileId;
      npc.daysToArrival = daysToArrival;
      npc.state = NpcState.TRAVELING;
      npc.goal = { kind: NpcGoalKind.PATROL, targetSystemId: hostileId };
      logger.info(`Convoy ${convoyId}: assigned ${npc.name} → ${hostileId}`);
    }
  }

  assembleCaptureFleet(galaxy: Galaxy, rng: SeededRNG): void {
    const fronts: Array<{ hostileId: string; targetId: string }> = [];
    for (const sys of galaxy.systems) {
      if (!galaxy.isHostileSystem(sys.id)) continue;
      for (const conn of sys.connections) {
        if (!galaxy.isHostileSystem(conn.toSystemId)) {
          fronts.push({ hostileId: sys.id, targetId: conn.toSystemId });
        }
      }
    }
    if (fronts.length === 0) return;

    const front = fronts[rng.nextInt(0, fronts.length - 1)];
    const { hostileId, targetId } = front;
    const count = rng.nextInt(CAPTURE_FLEET_MIN, CAPTURE_FLEET_MAX);
    this.launchCaptureFleet(
      galaxy,
      rng,
      hostileId,
      targetId,
      count,
      `capture_${galaxy.gameDays}_${targetId}`,
    );
  }

  private launchCaptureFleet(
    galaxy: Galaxy,
    rng: SeededRNG,
    hostileId: string,
    targetId: string,
    count: number,
    fleetId: string,
  ): void {
    const daysToArrival = travelDays(galaxy, hostileId, targetId);

    for (let i = 0; i < count; i++) {
      const id = `${fleetId}_${i}`;
      const ship = this.spawnOvermindInSystem(
        rng,
        id,
        hostileId,
        overmindSizeTierForId(id),
      );
      ship.destinationSystemId = targetId;
      ship.daysToArrival = daysToArrival;
      ship.state = NpcState.TRAVELING;
      ship.goal = { kind: NpcGoalKind.HUNT, targetSystemId: targetId };
      galaxy.npcShips.push(ship);
      this.captureFleetIds.add(id);
    }
    logger.info(
      `Capture fleet ${fleetId}: ${count} Overmind ships ${hostileId} → ${targetId}`,
    );
  }

  resolveCaptureFleets(galaxy: Galaxy): NewsEvent[] {
    const events: NewsEvent[] = [];
    if (this.captureFleetIds.size === 0) return events;

    const rng = new SeededRNG(`capture_resolve_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (!this.captureFleetIds.has(npc.id)) continue;
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, attackers] of bySystem) {
      if (galaxy.isHostileSystem(systemId)) {
        for (const a of attackers) this.promoteToGarrison(a.id);
        continue;
      }

      const defenders = galaxy.npcShips.filter(
        (n) =>
          n.currentSystemId === systemId &&
          n.state !== NpcState.DEAD &&
          n.state !== NpcState.TRAVELING &&
          !this.captureFleetIds.has(n.id) &&
          n.faction !== Faction.OVERMIND &&
          n.role !== NpcRole.PIRATE,
      );

      if (defenders.length === 0) {
        if (attackers.length < CAPTURE_FLEET_MIN) {
          for (const a of attackers) {
            this.captureFleetIds.delete(a.id);
            const idx = galaxy.npcShips.indexOf(a);
            if (idx >= 0) galaxy.npcShips.splice(idx, 1);
          }
          continue;
        }
        galaxy.addOvermindSystem(systemId);
        this.recordRecentCapture(systemId);
        const sys = galaxy.systems.find((s) => s.id === systemId);
        const event: NewsEvent = {
          type: "SYSTEM_CAPTURED",
          systemId,
          day: galaxy.gameDays,
          description: `Система ${sys?.name ?? systemId} захвачена Жнецами!`,
        };
        events.push(event);
        logger.info(`Capture fleet seized ${systemId}`);
        for (const a of attackers) this.promoteToGarrison(a.id);
        continue;
      }

      for (const attacker of attackers) {
        if (attacker.state === NpcState.DEAD) continue;
        const alive = defenders.filter((d) => d.state !== NpcState.DEAD);
        if (alive.length === 0) break;
        const victim = alive[rng.nextInt(0, alive.length - 1)];

        victim.hullHP -= Math.max(
          1,
          Math.round(attacker.damage * PIRATE_DAMAGE_FRACTION),
        );
        attacker.hullHP -= Math.max(
          1,
          Math.round(victim.damage * VICTIM_RETALIATION_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          logger.info(
            `Capture fleet ${attacker.name} destroyed defender ${victim.name} in ${systemId}`,
          );
        }
        if (attacker.hullHP <= 0) {
          attacker.hullHP = 0;
          attacker.state = NpcState.DEAD;
        }
      }
    }
    return events;
  }

  private promoteToGarrison(npcId: string): void {
    this.captureFleetIds.delete(npcId);
    this.garrisonIds.add(npcId);
  }

  resolveLiberationAssaults(galaxy: Galaxy, playerSystemId?: string): void {
    if (this.liberationAssaultIds.size === 0) return;

    const rng = new SeededRNG(`liberation_assault_resolve_${galaxy.gameDays}`);
    const bySystem = new Map<string, NpcShip[]>();
    for (const npc of galaxy.npcShips) {
      if (!this.liberationAssaultIds.has(npc.id)) continue;
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      const list = bySystem.get(npc.currentSystemId) ?? [];
      list.push(npc);
      bySystem.set(npc.currentSystemId, list);
    }

    for (const [systemId, attackers] of bySystem) {
      if (!galaxy.isHostileSystem(systemId)) {
        logger.info(
          `Liberation assault at ${systemId} stands down — already freed`,
        );
        for (const a of attackers) this.releaseAssaultShip(a);
        continue;
      }
      if (playerSystemId !== undefined && systemId === playerSystemId) {
        continue;
      }

      const defenders = galaxy.npcShips.filter(
        (n) =>
          n.currentSystemId === systemId &&
          n.state !== NpcState.DEAD &&
          n.state !== NpcState.TRAVELING &&
          !this.liberationAssaultIds.has(n.id) &&
          (n.faction === Faction.OVERMIND || n.role === NpcRole.PIRATE),
      );

      if (defenders.length === 0) {
        galaxy.tryLiberate(systemId);
        logger.info(`Liberation assault freed ${systemId}`);
        for (const a of attackers) this.releaseAssaultShip(a);
        continue;
      }

      for (const attacker of attackers) {
        if (attacker.state === NpcState.DEAD) continue;
        const alive = defenders.filter((d) => d.state !== NpcState.DEAD);
        if (alive.length === 0) break;
        const victim = alive[rng.nextInt(0, alive.length - 1)];

        victim.hullHP -= Math.max(
          1,
          Math.round(attacker.damage * PIRATE_DAMAGE_FRACTION),
        );
        attacker.hullHP -= Math.max(
          1,
          Math.round(victim.damage * VICTIM_RETALIATION_FRACTION),
        );

        if (victim.hullHP <= 0) {
          victim.hullHP = 0;
          victim.state = NpcState.DEAD;
          logger.info(
            `Liberation assault ${attacker.name} destroyed ${victim.name} in ${systemId}`,
          );
        }
        if (attacker.hullHP <= 0) {
          attacker.hullHP = 0;
          attacker.state = NpcState.DEAD;
        }
      }
    }
  }

  private releaseAssaultShip(npc: NpcShip): void {
    this.liberationAssaultIds.delete(npc.id);
    npc.convoyId = undefined;
  }

  private underLiberationAssault(galaxy: Galaxy, systemId: string): boolean {
    for (const npc of galaxy.npcShips) {
      if (!this.liberationAssaultIds.has(npc.id)) continue;
      if (npc.state === NpcState.DEAD || npc.state === NpcState.TRAVELING) {
        continue;
      }
      if (npc.currentSystemId === systemId) return true;
    }
    return false;
  }

  assembleLiberationCampaign(galaxy: Galaxy, rng: SeededRNG): NewsEvent | null {
    let front = this.dequeueRecentCaptureFront(galaxy);
    if (!front) {
      const fronts: Array<{ targetId: string; stagingId: string }> = [];
      for (const sys of galaxy.systems) {
        if (!galaxy.isHostileSystem(sys.id)) continue;
        for (const conn of sys.connections) {
          if (!galaxy.isHostileSystem(conn.toSystemId)) {
            fronts.push({ targetId: sys.id, stagingId: conn.toSystemId });
            break;
          }
        }
      }
      if (fronts.length === 0) return null;
      front = fronts[rng.nextInt(0, fronts.length - 1)];
    }
    const { targetId, stagingId } = front;

    if (
      this.liberationCampaigns.some(
        (c) => c.targetSystemId === targetId && !c.dispatched,
      )
    ) {
      return null;
    }

    const liberationDate = galaxy.gameDays + LIBERATION_RALLY_DELAY;
    this.liberationCampaigns.push({
      targetSystemId: targetId,
      stagingSystemId: stagingId,
      liberationDate,
      dispatched: false,
    });

    const target = galaxy.systems.find((s) => s.id === targetId);
    const staging = galaxy.systems.find((s) => s.id === stagingId);
    logger.info(
      `Liberation campaign announced: ${targetId} (rally in ${stagingId}, day ${liberationDate})`,
    );
    return {
      type: "LIBERATION_CAMPAIGN",
      systemId: targetId,
      day: galaxy.gameDays,
      targetSystemId: targetId,
      stagingSystemId: stagingId,
      liberationDate,
      description: `Рейнджеры освободят ${target?.name ?? targetId} через ${LIBERATION_RALLY_DELAY} дней. Сбор в ${staging?.name ?? stagingId}`,
    };
  }

  private recordRecentCapture(systemId: string): void {
    const existing = this.recentlyCaptured.indexOf(systemId);
    if (existing >= 0) this.recentlyCaptured.splice(existing, 1);
    this.recentlyCaptured.push(systemId);
    while (this.recentlyCaptured.length > RECENTLY_CAPTURED_MAX) {
      this.recentlyCaptured.shift();
    }
  }

  private dequeueRecentCaptureFront(
    galaxy: Galaxy,
  ): { targetId: string; stagingId: string } | null {
    for (let i = 0; i < this.recentlyCaptured.length; i++) {
      const targetId = this.recentlyCaptured[i];
      if (!galaxy.isHostileSystem(targetId)) {
        this.recentlyCaptured.splice(i--, 1);
        continue;
      }
      if (
        this.liberationCampaigns.some(
          (c) => c.targetSystemId === targetId && !c.dispatched,
        )
      ) {
        this.recentlyCaptured.splice(i--, 1);
        continue;
      }
      const stagingId = this.undirectedNeighbors(galaxy, targetId).find(
        (id) => !galaxy.isHostileSystem(id),
      );
      if (!stagingId) continue;
      this.recentlyCaptured.splice(i, 1);
      return { targetId, stagingId };
    }
    return null;
  }

  resolveLiberationCampaigns(galaxy: Galaxy): void {
    for (const campaign of this.liberationCampaigns) {
      if (campaign.dispatched) continue;
      if (galaxy.gameDays < campaign.liberationDate) continue;
      if (!galaxy.isHostileSystem(campaign.targetSystemId)) {
        campaign.dispatched = true;
        continue;
      }
      if (this.dispatchLiberationRally(galaxy, campaign)) {
        campaign.dispatched = true;
      }
    }
  }

  private dispatchLiberationRally(
    galaxy: Galaxy,
    campaign: LiberationCampaign,
  ): boolean {
    const idleRangers = galaxy.npcShips.filter(
      (n) =>
        n.role === NpcRole.RANGER &&
        n.state !== NpcState.TRAVELING &&
        n.state !== NpcState.DEAD &&
        !n.convoyId &&
        !this.garrisonIds.has(n.id) &&
        !this.captureFleetIds.has(n.id) &&
        !this.liberationAssaultIds.has(n.id) &&
        n.currentSystemId !== campaign.targetSystemId,
    );
    const staged = idleRangers.filter(
      (n) => n.currentSystemId === campaign.stagingSystemId,
    );
    const remote = idleRangers
      .filter((n) => n.currentSystemId !== campaign.stagingSystemId)
      .sort(
        (a, b) =>
          travelDays(galaxy, a.currentSystemId, campaign.targetSystemId) -
          travelDays(galaxy, b.currentSystemId, campaign.targetSystemId),
      );
    const rangers = [...staged, ...remote].slice(0, LIBERATION_RALLY_MAX_SHIPS);
    if (rangers.length === 0) return false;

    const convoyId = `liberation_${campaign.liberationDate}_${campaign.targetSystemId}`;
    for (const npc of rangers) {
      npc.hullHP = npc.maxHull;
      npc.convoyId = convoyId;
      npc.destinationSystemId = campaign.targetSystemId;
      npc.daysToArrival = travelDays(
        galaxy,
        npc.currentSystemId,
        campaign.targetSystemId,
      );
      npc.state = NpcState.TRAVELING;
      npc.goal = {
        kind: NpcGoalKind.PATROL,
        targetSystemId: campaign.targetSystemId,
      };
      logger.info(
        `Liberation rally ${convoyId}: ${npc.name} → ${campaign.targetSystemId}`,
      );
    }
    return true;
  }
}
