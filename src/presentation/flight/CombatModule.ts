import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { GearKind, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { GAME_BALANCE } from "@/config/balance";
import type { GameMode } from "@/types";
import { applyDamageWithMode, isHullDowned } from "@/systems/combat/godMode";
import { npcWeaponRange } from "@/systems/combat/npcWeapon";
import {
  roundIsComplete,
  type CombatRoundConfig,
} from "@/systems/combat/combatRounds";
import {
  combatScaling,
  scaleHostileDamage,
  NEUTRAL_HOSTILE_SCALING,
  type HostileScaling,
} from "@/systems/campaign/hostileScaling";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { FlightModule } from "./FlightModule";
import { resolveShieldedDamage } from "./combatShield";
import { CombatHud } from "./CombatHud";
import { DamageNumbers } from "./DamageNumbers";
import { logger } from "@/utils/logger";

const LOW_HULL_FRACTION = 0.3;

export function weaponFireIntervalMs(weapon: {
  readonly cooldownTurns: number;
}): number {
  return Math.max(1, weapon.cooldownTurns) * GAME_BALANCE.combatFireIntervalMs;
}

export interface CombatModuleDeps {
  getShipPhysics(): ShipPhysics | null;
  isPaused?(): boolean;
  isTurnRunning?(): boolean;
  getPlayerLoadout?(): ShipLoadout | null;
  isPlannedTargetingActive?(): boolean;
  getPlannedWeaponTarget?(weapon: WeaponSpec): NpcShipSprite | null;
  interceptPlannedShot?(target: NpcShipSprite, weapon: WeaponSpec): boolean;
  onPlayerShotVfx?(
    fromX: number,
    fromY: number,
    target: NpcShipSprite,
    weapon: WeaponSpec,
  ): boolean;
  isNpcFireSuppressed?(npc: NpcShipSprite): boolean;
  onNpcShieldHit?(target: NpcShipSprite): void;
  getUiLayer?(): Container;
  getGameLayer?(): Container;
  getScreenSize?(): { width: number; height: number };
  getPlayerShip?(): { hullHP: number; maxHull: number } | null;
  getGameMode?(): GameMode;
  isHostileSystem?(): boolean;
  getCampaignPeakPower?(): number;
  onNpcDestroyed?(sprite: NpcShipSprite): void;
  onPlayerDestroyed?(): void;
  onPlayerUnderAttack?(): void;
  onCombatEnded?(): void;
  onTargetLost?(sprite: NpcShipSprite): void;
  showMessage?(text: string, color?: number): void;
  onRoundComplete?(): void;
}

export interface PlayerDeathCause {
  killerNpcId: string;
  killerRole: string;
  engagementStartHullFraction: number | null;
  simultaneousCombatants: number;
  roundsSurvived: number;
}

export class CombatModule implements FlightModule {
  private readonly deps: CombatModuleDeps;

  private hud: CombatHud | null = null;

  private damageNumbers: DamageNumbers | null = null;

  readonly combatants = new Set<NpcShipSprite>();

  private readonly npcFireTimers = new Map<NpcShipSprite, number>();

  private readonly weaponFireTimers = new Map<number, number>();

  private lowHullWarned = false;

  private downedWarned = false;

  private playerDeathReported = false;

  private engagementStartHullFraction: number | null = null;

  private roundsThisEngagement = 0;

  private _lastDeathCause: PlayerDeathCause | null = null;

  get lastDeathCause(): PlayerDeathCause | null {
    return this._lastDeathCause;
  }

  selectedTarget: NpcShipSprite | null = null;

  isActive = false;

  private roundDamageTaken = 0;

  roundComplete = false;

  private weaponlessHintAtMs = 0;
  private static readonly WEAPONLESS_HINT_COOLDOWN_MS = 3000;

  constructor(deps: CombatModuleDeps) {
    this.deps = deps;
  }

  initialize(): void {
    const { getUiLayer, getGameLayer, getScreenSize } = this.deps;
    if (!getUiLayer || !getGameLayer || !getScreenSize) return;
    this.damageNumbers = new DamageNumbers(getGameLayer());
    this.hud = new CombatHud(getUiLayer(), getGameLayer(), {
      getShipPos: () => {
        const p = this.deps.getShipPhysics();
        return p ? { x: p.shipX, y: p.shipY } : null;
      },
      getScreenSize,
      getPlayerLoadout: () => this.deps.getPlayerLoadout?.() ?? null,
    });
  }

  update(deltaTime: number, _bgElapsed?: number): void {
    this.damageNumbers?.update(deltaTime);
    if (!this.isFrozen()) this.hud?.update(deltaTime);
    if (!this.isActive) return;
    if (this.playerDeathReported) return;
    if (this.isFrozen()) {
      this.pruneDestroyed();
      if (this.combatants.size === 0) this.endCombat();
      return;
    }
    const playerShip = this.deps.getPlayerShip?.() ?? null;
    if (
      playerShip &&
      isHullDowned(
        this.deps.getGameMode?.() ?? "NORMAL",
        playerShip.hullHP,
        playerShip.maxHull,
      )
    ) {
      this.endCombat();
      return;
    }
    this.pruneDisengaged();
    if (this.isFrozen()) return;
    if (!this.roundComplete) {
      this.advancePlayerWeapons(deltaTime);
      if (this.isFrozen()) return;
      this.advanceNpcTimers(deltaTime);
    }
    if (this.combatants.size === 0) {
      this.endCombat();
      return;
    }
    this.syncHud();
  }

  addCombatant(npc: NpcShipSprite): void {
    if (this.combatants.has(npc)) return; // idempotent — cheapest check first
    const shipNow = this.deps.getPlayerShip?.() ?? null;
    if (
      shipNow &&
      isHullDowned(
        this.deps.getGameMode?.() ?? "NORMAL",
        shipNow.hullHP,
        shipNow.maxHull,
      )
    ) {
      return;
    }
    const loadout = this.deps.getPlayerLoadout?.() ?? null;
    if (loadout && !this.hasWeapon(loadout)) {
      this.warnWeaponless();
      return;
    }
    if (this.combatants.size >= GAME_BALANCE.combatMaxSimultaneousCombatants) {
      return;
    }

    const joinStagger =
      this.combatants.size * GAME_BALANCE.combatJoinFireStaggerMs;
    this.combatants.add(npc);
    this.npcFireTimers.set(npc, -joinStagger);
    if (!this.selectedTarget) this.selectedTarget = npc;

    if (!this.isActive) {
      this.isActive = true;
      this.primeWeaponFireTimers();
      this.lowHullWarned = false;
      this.beginCombatRound(); // fresh engagement ⇒ fresh round budget
      this.engagementStartHullFraction =
        shipNow && shipNow.maxHull > 0
          ? shipNow.hullHP / shipNow.maxHull
          : null;
      this.hud?.open(this.selectedTarget);
    }
    logger.info(`In-flight combat: engaged ${npc.npc.id}`);
  }

  private primeWeaponFireTimers(): void {
    this.weaponFireTimers.clear();
    const weapons = this.fittedWeapons();
    for (let i = 0; i < weapons.length; i++) {
      const weapon = weapons[i];
      if (weapon.cooldownTurns <= 1) continue;
      this.weaponFireTimers.set(
        i,
        weaponFireIntervalMs(weapon) *
          GAME_BALANCE.combatEngagePrechargeFraction,
      );
    }
  }

  fittedWeapons(): WeaponSpec[] {
    const loadout = this.deps.getPlayerLoadout?.() ?? null;
    if (!loadout) return [];
    return loadout
      .slottedWithGear()
      .map((s) => s.gear)
      .filter((g): g is WeaponSpec => !!g && g.kind === GearKind.WEAPON);
  }

  confirmAttack(target: NpcShipSprite, weapon: WeaponSpec): void {
    if (!this.isActive || !this.combatants.has(target)) return;
    if (this.isPlayerDowned()) return;
    this.selectTarget(target);
    this.firePlayerShot(target, weapon);
    this.weaponFireTimers.clear();
  }

  selectTarget(sprite: NpcShipSprite | null): void {
    if (!this.isActive) return;
    if (sprite && !this.combatants.has(sprite)) return;
    this.selectedTarget = sprite;
    this.hud?.setTarget(sprite);
  }

  beginCombatRound(): void {
    this.roundDamageTaken = 0;
    this.roundComplete = false;
    if (this.isActive) this.roundsThisEngagement++;
  }

  endCombat(): void {
    this.isActive = false;
    this.combatants.clear();
    this.npcFireTimers.clear();
    this.selectedTarget = null;
    this.weaponFireTimers.clear();
    this.lowHullWarned = false;
    this.downedWarned = false;
    this.playerDeathReported = false;
    this.roundDamageTaken = 0;
    this.roundComplete = false;
    this.roundsThisEngagement = 0;
    this.hud?.close();
    this.deps.onCombatEnded?.();
  }

  destroy(): void {
    this.endCombat();
    this.damageNumbers?.clear();
    this.damageNumbers = null;
    this.hud = null;
  }

  private pruneDisengaged(): void {
    const toDrop = [...this.combatants].filter((npc) => this.shouldDrop(npc));
    for (const npc of toDrop)
      if (npc !== this.selectedTarget) this.removeCombatant(npc);
    if (this.selectedTarget && toDrop.includes(this.selectedTarget))
      this.removeCombatant(this.selectedTarget);
  }

  private pruneDestroyed(): void {
    for (const npc of [...this.combatants])
      if (npc.container?.destroyed) this.removeCombatant(npc);
  }

  private shouldDrop(npc: NpcShipSprite): boolean {
    if (npc.container?.destroyed) return true;
    const d = this.distanceToShip(npc);
    return d === null || d > GAME_BALANCE.combatEscapeRange;
  }

  private advanceNpcTimers(deltaTime: number): void {
    for (const npc of this.combatants) {
      if (this.isFrozen() || this.playerDeathReported) break;
      if (this.roundBudgetSpent()) {
        this.completeRound();
        break;
      }
      const t = (this.npcFireTimers.get(npc) ?? 0) + deltaTime;
      const d = this.distanceToShip(npc);
      if (
        t >= GAME_BALANCE.combatFireIntervalMs &&
        d !== null &&
        d <= npcWeaponRange(npc.npc)
      ) {
        if (this.deps.isNpcFireSuppressed?.(npc)) {
          this.npcFireTimers.set(npc, t);
          continue;
        }
        this.npcFireTimers.set(npc, 0);
        this.fireNpcShot(npc);
      } else {
        this.npcFireTimers.set(npc, t);
      }
    }
  }

  private advancePlayerWeapons(deltaTime: number): void {
    if (this.isPlayerDowned()) return;
    const weapons = this.fittedWeapons();
    const planned = this.deps.isPlannedTargetingActive?.() ?? false;
    for (let i = 0; i < weapons.length; i++) {
      if (this.isFrozen()) break;
      const weapon = weapons[i];
      const interval = weaponFireIntervalMs(weapon);
      const t = (this.weaponFireTimers.get(i) ?? 0) + deltaTime;
      if (t < interval) {
        this.weaponFireTimers.set(i, t);
        continue;
      }
      const target = planned
        ? this.resolvePlannedTarget(weapon)
        : this.pickTargetInRange(weapon);
      if (!target) {
        this.weaponFireTimers.set(i, interval);
        continue;
      }
      this.weaponFireTimers.set(i, 0);
      if (planned && this.deps.interceptPlannedShot?.(target, weapon)) continue;
      this.firePlayerShot(target, weapon);
    }
  }

  private resolvePlannedTarget(weapon: WeaponSpec): NpcShipSprite | null {
    const assigned = this.deps.getPlannedWeaponTarget?.(weapon) ?? null;
    if (!assigned || !this.combatants.has(assigned)) return null;
    const d = this.distanceToShip(assigned);
    if (d === null || d > weapon.range) return null;
    return assigned;
  }

  private pickTargetInRange(weapon: WeaponSpec): NpcShipSprite | null {
    const sel = this.selectedTarget;
    if (sel && this.combatants.has(sel)) {
      const d = this.distanceToShip(sel);
      if (d !== null && d <= weapon.range) return sel;
    }
    let best: NpcShipSprite | null = null;
    let bestDist = Infinity;
    for (const npc of this.combatants) {
      const d = this.distanceToShip(npc);
      if (d === null || d > weapon.range) continue;
      if (d < bestDist) {
        bestDist = d;
        best = npc;
      }
    }
    return best;
  }

  private fireNpcShot(npc: NpcShipSprite): void {
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (!ship) return;
    this.deps.onPlayerUnderAttack?.();
    const damage = scaleHostileDamage(
      npc.npc.damage,
      this.hostileMults().damageMult,
    );
    const mode = this.deps.getGameMode?.() ?? "NORMAL";
    const result = applyDamageWithMode(mode, ship.hullHP, damage, ship.maxHull);
    this.roundDamageTaken += Math.max(0, ship.hullHP - result.hull);
    ship.hullHP = result.hull;
    const physics = this.deps.getShipPhysics();
    if (physics) {
      this.damageNumbers?.spawn(damage, physics.shipX, physics.shipY, false);
      this.hud?.flashShot(npc.x, npc.y, physics.shipX, physics.shipY, false);
    }
    if (result.downed) {
      if (!this.downedWarned) {
        this.downedWarned = true;
        this.deps.showMessage?.(
          "Корабль выведен из строя — нужен ремонт",
          0xff8800,
        );
      }
      return;
    }
    if (ship.hullHP <= 0) {
      if (!this.playerDeathReported) {
        this.playerDeathReported = true;
        this._lastDeathCause = {
          killerNpcId: npc.npc.id,
          killerRole: npc.npc.role,
          engagementStartHullFraction: this.engagementStartHullFraction,
          simultaneousCombatants: this.combatants.size,
          roundsSurvived: this.roundsThisEngagement,
        };
        this.deps.onPlayerDestroyed?.();
      }
      return;
    }
    if (
      ship.hullHP > 0 &&
      ship.hullHP < ship.maxHull * LOW_HULL_FRACTION &&
      !this.lowHullWarned
    ) {
      this.lowHullWarned = true;
      this.deps.showMessage?.("Корпус критический — отступайте!", 0xff4444);
    }
  }

  private firePlayerShot(target: NpcShipSprite, weapon: WeaponSpec): void {
    const physics = this.deps.getShipPhysics();
    const styled =
      physics !== null &&
      (this.deps.onPlayerShotVfx?.(
        physics.shipX,
        physics.shipY,
        target,
        weapon,
      ) ??
        false);
    if (physics && !styled) {
      this.hud?.flashShot(
        physics.shipX,
        physics.shipY,
        target.x,
        target.y,
        true,
      );
    }
    this.applyPlayerDamage(target, weapon.damage);
  }

  landExternalShot(
    target: NpcShipSprite,
    rawDamage: number,
    from: { x: number; y: number } | null,
  ): void {
    if (!this.isActive || target.container?.destroyed) return;
    if (from) this.hud?.flashShot(from.x, from.y, target.x, target.y, true);
    this.applyPlayerDamage(target, rawDamage);
  }

  private applyPlayerDamage(target: NpcShipSprite, rawDamage: number): void {
    const npc = target.npc;
    const damage = scaleHostileDamage(
      rawDamage,
      1 / this.hostileMults().hpMult,
    );
    const split = resolveShieldedDamage(npc.shields ?? 0, damage);
    if (split.shieldHit) {
      npc.shields = split.shields;
      this.deps.onNpcShieldHit?.(target);
    }
    npc.hullHP = Math.max(0, npc.hullHP - split.hullDamage);
    this.damageNumbers?.spawn(damage, target.x, target.y, true);
    if (npc.hullHP <= 0) {
      this.deps.showMessage?.(`Цель уничтожена: ${npc.name}`, 0xffdd33);
      this.deps.onNpcDestroyed?.(target);
      this.removeCombatant(target);
    }
  }

  disengage(npc: NpcShipSprite): void {
    if (this.combatants.has(npc)) this.removeCombatant(npc);
  }

  private removeCombatant(npc: NpcShipSprite): void {
    this.combatants.delete(npc);
    this.npcFireTimers.delete(npc);
    if (this.selectedTarget === npc) {
      this.selectedTarget = this.combatants.values().next().value ?? null;
      this.hud?.setTarget(this.selectedTarget);
      if (this.selectedTarget) this.deps.onTargetLost?.(npc);
    }
  }

  private syncHud(): void {
    if (!this.hud) return;
    const target = this.selectedTarget;
    if (target) this.hud.updateTargetHP(target.npc.hullHP, target.npc.maxHull);
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (ship) this.hud.updatePlayerHP(ship.hullHP, ship.maxHull);
    this.hud.syncRangeCircle();
    this.hud.syncMarkers([...this.combatants], this.selectedTarget);
  }

  private distanceToShip(target: NpcShipSprite): number | null {
    const physics = this.deps.getShipPhysics();
    if (!physics) return null;
    return Math.hypot(target.x - physics.shipX, target.y - physics.shipY);
  }

  private hostileMults(): HostileScaling {
    if (this.deps.getCampaignPeakPower === undefined)
      return NEUTRAL_HOSTILE_SCALING;
    const mode = this.deps.getGameMode?.() ?? "NORMAL";
    const power = this.deps.getCampaignPeakPower() ?? 0;
    const isHostile = this.deps.isHostileSystem?.() ?? false;
    return combatScaling(power, mode, isHostile);
  }

  private roundsEnabled(): boolean {
    return (
      this.deps.getCampaignPeakPower !== undefined &&
      (this.deps.getGameMode?.() ?? "NORMAL") !== "GOD"
    );
  }

  private readonly roundConfig: CombatRoundConfig = {
    hullFraction: GAME_BALANCE.combatRoundHullFraction,
  };

  private roundBudgetSpent(): boolean {
    if (!this.roundsEnabled()) return false;
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (!ship) return false;
    return roundIsComplete(
      this.roundDamageTaken,
      ship.hullHP,
      ship.maxHull,
      this.roundConfig,
    );
  }

  private completeRound(): void {
    if (this.roundComplete) return;
    this.roundComplete = true;
    this.deps.onRoundComplete?.();
  }

  private isPlayerDowned(): boolean {
    const ship = this.deps.getPlayerShip?.() ?? null;
    if (!ship) return false;
    const mode = this.deps.getGameMode?.() ?? "NORMAL";
    return isHullDowned(mode, ship.hullHP, ship.maxHull);
  }

  private isFrozen(): boolean {
    if (this.deps.isPaused) return this.deps.isPaused();
    return this.deps.isTurnRunning?.() === false;
  }

  private hasWeapon(loadout: ShipLoadout): boolean {
    return loadout
      .slottedWithGear()
      .some((s) => s.gear?.kind === GearKind.WEAPON);
  }

  private warnWeaponless(): void {
    const now = Date.now();
    if (
      now - this.weaponlessHintAtMs <
      CombatModule.WEAPONLESS_HINT_COOLDOWN_MS
    )
      return;
    this.weaponlessHintAtMs = now;
    this.deps.showMessage?.("Нет оружия — установите его в ангаре", 0xff4444);
  }
}
