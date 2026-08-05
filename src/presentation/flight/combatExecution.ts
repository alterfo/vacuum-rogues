import { Graphics, type Container } from "pixi.js";
import { t } from "@/i18n/i18n";
import {
  GAME_BALANCE,
  GRAVITY_ASSIST,
  AFTERBURNER,
  MISSILE_COMBAT,
  COMBAT_CONSUMABLE,
  COMBAT_COMMS,
  BANKING,
  SHIELD_COMBAT,
  WRECK,
} from "@/config/balance";
import { WeaponAbility } from "@/types";
import { WeaponClass, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import { npcWeaponRange } from "@/systems/combat/npcWeapon";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { PlannedTurn } from "./combatPlanning";
import { gravityAssistTotal } from "./combatGravity";
import {
  pristineEngine,
  engageAfterburner,
  canAfterburn,
  type EngineWearState,
} from "./combatAfterburner";
import {
  launchMissile,
  advanceMissile,
  resolveMissileArrival,
  isMissileDone,
  type MissileState,
} from "./combatMissile";
import {
  consumableById,
  applyShieldRestore,
  aoeDamageTargets,
  jamTarget,
  isJamActive,
  type WeaponJam,
} from "./combatConsumable";
import {
  resolveBribe,
  resolveSurrenderDemand,
  findCallForHelpAlly,
} from "./combatComms";
import { shipTurnRate, bankingAngle, approachRoll } from "./combatBanking";
import { shieldFlashAlpha } from "./combatShield";
import { drawShieldFlashes, type ShieldFlashSpec } from "./combatShieldFlash";
import { drawShipStatusBars, type ShipStatusBarSpec } from "./combatStatusBars";
import {
  selectWeaponVfx,
  missileTrailPoints,
  WeaponVfxKind,
} from "./combatWeaponVfx";
import { drawWeaponVfx, type WeaponVfxSpec } from "./combatWeaponVfxOverlay";
import { drawWrecks } from "./combatWreckRenderer";
import {
  shipVelocity,
  spawnWreck,
  advanceWreck,
  isWreckDone,
  wreckAlpha,
  wreckLootEmissionTimes,
  dueLootEmissions,
  type WreckState,
} from "./combatWreck";

const SHOT_FX_MS = 280;
const SHIP_VISUAL_RADIUS = 16;
export const WRECK_LOOT_SPREAD_FRACTION = 0.6;
const ALLY_SHOT_COLOR = 0x7dff9a;
const EXEC_TINT = 0x66ccff;
const WARN_TINT = 0xffcc00;

export interface ExecutionShipPhysics {
  shipX: number;
  shipY: number;
  shipAngle: number;
  currentSpeed: number;
  timeScale: number;
  isMoving: boolean;
}

interface TrackedMissile {
  state: MissileState;
  readonly target: NpcShipSprite;
  readonly weapon: WeaponSpec;
  readonly trail: { x: number; y: number }[];
}

interface AllyState {
  readonly sprite: NpcShipSprite;
  fireTimerMs: number;
}

interface TrackedWreck {
  state: WreckState;
  readonly npc: NpcShip;
  readonly emissionTimes: number[];
}

interface FlashState {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  ageMs: number;
}

interface ShotFxState {
  readonly spec: Omit<WeaponVfxSpec, "alpha">;
  ageMs: number;
}

export interface CombatExecutionHost {
  getShipPhysics(): ExecutionShipPhysics | null;
  getGameLayer(): Container;
  getPlanets(): readonly { x: number; y: number; radius: number }[];
  getPlayerShip(): {
    hullHP: number;
    maxHull: number;
    shields: number;
    maxShields: number;
  } | null;
  getPlayerVisual(): { scale: { x: number; y: number } } | null;
  getPlayerInventory(): {
    hasConsumable(id: string): boolean;
    removeConsumable(id: string): boolean;
  } | null;
  getPlayerCredits(): number;
  payBribe(amount: number, npc: NpcShip): void;
  combatants(): readonly NpcShipSprite[];
  selectedTarget(): NpcShipSprite | null;
  isCombatActive(): boolean;
  isExecuting(): boolean;
  landShot(
    target: NpcShipSprite,
    rawDamage: number,
    from: { x: number; y: number } | null,
  ): void;
  disengage(sprite: NpcShipSprite): void;
  npcSprites(): readonly NpcShipSprite[];
  spawnLoot(npc: NpcShip, x: number, y: number, count?: number): void;
  rollLootCount(npc: NpcShip): number;
  beginRound?(): void;
  isPursuitSuspended?(): boolean;
  showMessage(text: string, color?: number): void;
}

export class CombatExecutionController {
  private readonly host: CombatExecutionHost;

  private engineWear: EngineWearState = pristineEngine();
  private windowMult = 1;
  private missiles: TrackedMissile[] = [];
  private jams: WeaponJam<NpcShipSprite>[] = [];
  private allies: AllyState[] = [];
  private wrecks: TrackedWreck[] = [];
  private flashes: FlashState[] = [];
  private shotFx: ShotFxState[] = [];
  private readonly deferredLootNpcIds = new Set<string>();
  private readonly npcShieldMax = new Map<string, number>();

  private clockMs = 0;
  private roll = 0;
  private prevShipAngle: number | null = null;
  private missileSeq = 0;
  private lastDrawnBarCount = 0;

  private rng: () => number = Math.random;

  constructor(host: CombatExecutionHost) {
    this.host = host;
  }

  setRng(fn: () => number): void {
    this.rng = fn;
  }

  get windowBoostMultiplier(): number {
    return this.host.isExecuting() ? this.windowMult : 1;
  }

  get engineIntegrity(): number {
    return this.engineWear.integrity;
  }

  canAfterburn(): boolean {
    return canAfterburn(this.engineWear, AFTERBURNER);
  }

  get missileCount(): number {
    return this.missiles.length;
  }

  get wreckCount(): number {
    return this.wrecks.length;
  }

  wreckPositions(): { x: number; y: number }[] {
    return this.wrecks.map((w) => ({ x: w.state.x, y: w.state.y }));
  }

  get allyCount(): number {
    return this.allies.length;
  }

  get shieldFlashCount(): number {
    return this.flashes.length;
  }

  get shotFxCount(): number {
    return this.shotFx.length;
  }

  get bankingRoll(): number {
    return this.roll;
  }

  get statusBarCount(): number {
    return this.lastDrawnBarCount;
  }

  beginWindow(plan: PlannedTurn<NpcShipSprite, WeaponSpec>): void {
    const continuingCourse =
      plan.destination === null &&
      this.host.getShipPhysics()?.isMoving === true &&
      (this.host.isPursuitSuspended?.() ?? false);
    if (!continuingCourse) this.host.beginRound?.();
    this.windowMult = 1;
    if (plan.afterburner) this.engageAfterburnerForWindow();
    if (plan.consumableId) this.activateConsumable(plan.consumableId);
    if (plan.commsAction) this.runCommsAction(plan.commsAction);
  }

  private engageAfterburnerForWindow(): void {
    const result = engageAfterburner(this.engineWear, AFTERBURNER);
    this.engineWear = result.state;
    this.windowMult = result.multiplier;
    if (result.engaged) {
      this.host.showMessage(
        t("combat.execution.afterburnerEngaged", {
          integrity: Math.round(this.engineWear.integrity * 100),
        }),
        EXEC_TINT,
      );
    } else {
      this.host.showMessage(t("combat.execution.afterburnerSpent"), WARN_TINT);
    }
  }

  private activateConsumable(id: string): void {
    const def = consumableById(id);
    const inventory = this.host.getPlayerInventory();
    if (!def || !inventory?.hasConsumable(id)) return;
    switch (def.effect) {
      case "shield-restore": {
        const ship = this.host.getPlayerShip();
        if (!ship) return;
        inventory.removeConsumable(id);
        const before = ship.shields;
        ship.shields = applyShieldRestore(
          ship.shields,
          ship.maxShields,
          COMBAT_CONSUMABLE.shieldRestoreAmount,
        );
        const physics = this.host.getShipPhysics();
        if (physics) {
          this.spawnFlash(
            physics.shipX,
            physics.shipY,
            (SHIP_VISUAL_RADIUS + 4) * SHIELD_COMBAT.shieldFlashRadiusScale,
          );
        }
        this.host.showMessage(
          t("combat.execution.shieldRestored", {
            amount: Math.round(ship.shields - before),
          }),
          EXEC_TINT,
        );
        return;
      }
      case "aoe-damage": {
        const physics = this.host.getShipPhysics();
        if (!physics) return;
        inventory.removeConsumable(id);
        const center = { x: physics.shipX, y: physics.shipY };
        const hits = aoeDamageTargets(
          center,
          this.host.combatants(),
          (s) => ({ x: s.x, y: s.y }),
          COMBAT_CONSUMABLE,
        );
        for (const hit of hits) {
          this.host.landShot(hit.enemy, hit.damage, center);
        }
        this.host.showMessage(
          t("combat.execution.aoe", { count: hits.length }),
          EXEC_TINT,
        );
        return;
      }
      case "weapon-jam": {
        const target = this.host.selectedTarget() ?? this.host.combatants()[0];
        if (!target) return;
        inventory.removeConsumable(id);
        this.jams.push(
          jamTarget(target, this.clockMs, COMBAT_CONSUMABLE.weaponJamMs),
        );
        this.host.showMessage(
          t("combat.execution.jammed", { name: target.npc.name }),
          EXEC_TINT,
        );
        return;
      }
    }
  }

  private runCommsAction(action: string): void {
    switch (action) {
      case "bribe":
        this.resolveBribeAction();
        return;
      case "demand-surrender":
        this.resolveSurrenderAction();
        return;
      case "call-for-help":
        this.resolveCallForHelp();
        return;
    }
  }

  private resolveBribeAction(): void {
    const hostiles = [...this.host.combatants()];
    if (hostiles.length === 0) return;
    const bribe = resolveBribe(this.host.getPlayerCredits());
    const payee = this.host.selectedTarget() ?? hostiles[0];
    this.host.payBribe(bribe.tribute, payee.npc);
    if (bribe.disengages) {
      const selected = this.host.selectedTarget();
      for (const s of hostiles) if (s !== selected) this.departAndDisengage(s);
      if (selected) this.departAndDisengage(selected);
    }
    this.host.showMessage(
      t("combat.execution.bribed", { amount: bribe.tribute }),
      EXEC_TINT,
    );
  }

  private resolveSurrenderAction(): void {
    const target = this.host.selectedTarget() ?? this.host.combatants()[0];
    if (!target) return;
    const npc = target.npc;
    const fraction = npc.maxHull > 0 ? npc.hullHP / npc.maxHull : 1;
    const verdict = resolveSurrenderDemand(npc.role, fraction, COMBAT_COMMS);
    if (!verdict.surrenders) {
      this.host.showMessage(
        t("combat.execution.surrenderRefused", { name: npc.name }),
        WARN_TINT,
      );
      return;
    }
    this.host.spawnLoot(npc, target.x, target.y);
    this.departAndDisengage(target);
    this.host.showMessage(
      t("combat.execution.surrendered", { name: npc.name }),
      EXEC_TINT,
    );
  }

  private resolveCallForHelp(): void {
    const physics = this.host.getShipPhysics();
    if (!physics) return;
    const engaged = new Set(this.host.combatants());
    const recruited = new Set(this.allies.map((a) => a.sprite));
    const ally = findCallForHelpAlly(
      { x: physics.shipX, y: physics.shipY },
      this.host.npcSprites(),
      (s) => ({ x: s.x, y: s.y }),
      (s) => s.npc.role,
      (s) =>
        !engaged.has(s) &&
        !recruited.has(s) &&
        !s.npc.hostile &&
        !s.isLeaving() &&
        !s.isGone(),
      COMBAT_COMMS,
    );
    if (!ally) {
      this.host.showMessage(t("combat.execution.allyNone"), WARN_TINT);
      return;
    }
    this.allies.push({ sprite: ally, fireTimerMs: 0 });
    this.host.showMessage(
      t("combat.execution.allyJoined", { name: ally.npc.name }),
      EXEC_TINT,
    );
  }

  private departAndDisengage(sprite: NpcShipSprite): void {
    sprite.beginDeparture();
    this.host.disengage(sprite);
  }

  isNpcJammed(npc: NpcShipSprite): boolean {
    return this.jams.some(
      (j) => j.target === npc && isJamActive(j, this.clockMs),
    );
  }

  interceptPlannedShot(target: NpcShipSprite, weapon: WeaponSpec): boolean {
    if (weapon.weaponClass !== WeaponClass.MISSILE) return false;
    const physics = this.host.getShipPhysics();
    if (!physics) return false;
    const state = launchMissile({
      id: `msl_${++this.missileSeq}`,
      from: { x: physics.shipX, y: physics.shipY },
      target: { x: target.x, y: target.y },
      speedPerMs: MISSILE_COMBAT.speedPerMs,
      damage: weapon.damage,
      homing: weapon.ability === WeaponAbility.HOMING,
    });
    this.missiles.push({
      state,
      target,
      weapon,
      trail: [{ x: state.pos.x, y: state.pos.y }],
    });
    return true;
  }

  onPlayerShotVfx(
    fromX: number,
    fromY: number,
    target: NpcShipSprite,
    weapon: WeaponSpec,
  ): boolean {
    this.shotFx.push({
      spec: {
        variant: selectWeaponVfx(weapon),
        from: { x: fromX, y: fromY },
        to: { x: target.x, y: target.y },
      },
      ageMs: 0,
    });
    return true;
  }

  spawnNpcShieldFlash(target: NpcShipSprite): void {
    this.spawnFlash(
      target.x,
      target.y,
      SHIP_VISUAL_RADIUS * SHIELD_COMBAT.shieldFlashRadiusScale,
    );
  }

  private spawnFlash(x: number, y: number, radius: number): void {
    this.flashes.push({ x, y, radius, ageMs: 0 });
  }

  onNpcKilled(sprite: NpcShipSprite): void {
    const speed = (sprite as { cruiseSpeed?: number }).cruiseSpeed ?? 0;
    const heading = sprite.container?.rotation ?? 0;
    const { vx, vy } = shipVelocity(heading, speed);
    const state = spawnWreck(sprite.x, sprite.y, vx, vy, heading, WRECK);
    const count = this.host.rollLootCount(sprite.npc);
    const emissionTimes = wreckLootEmissionTimes(
      count,
      WRECK.lifeMs * WRECK_LOOT_SPREAD_FRACTION,
    );
    this.wrecks.push({ state, npc: sprite.npc, emissionTimes });
    this.deferredLootNpcIds.add(sprite.npc.id);
    this.npcShieldMax.delete(sprite.npc.id);
  }

  consumeLootDeferral(npc: NpcShip): boolean {
    return this.deferredLootNpcIds.delete(npc.id);
  }

  update(dtMs: number): void {
    if (!(dtMs > 0)) return;
    this.clockMs += dtMs;
    const physics = this.host.getShipPhysics();
    const executing = this.host.isExecuting();
    if (!executing) this.windowMult = 1;
    this.jams = this.jams.filter((j) => isJamActive(j, this.clockMs));

    if (executing && physics) this.applyMovementFolds(physics, dtMs);
    this.updateBanking(physics, dtMs, executing);
    this.advanceMissiles(dtMs);
    this.advanceAllies(dtMs);
    this.advanceWrecks(dtMs);

    for (const f of this.flashes) f.ageMs += dtMs;
    this.flashes = this.flashes.filter(
      (f) => shieldFlashAlpha(f.ageMs, SHIELD_COMBAT) > 0,
    );
    for (const s of this.shotFx) s.ageMs += dtMs;
    this.shotFx = this.shotFx.filter((s) => s.ageMs < SHOT_FX_MS);

    this.draw();
  }

  private applyMovementFolds(
    physics: ExecutionShipPhysics,
    dtMs: number,
  ): void {
    if (!physics.isMoving) return;
    const dtEff = Math.min(dtMs, 100) * physics.timeScale;
    const speed = physics.currentSpeed;
    if (speed > 0) {
      const delta = gravityAssistTotal(
        {
          pos: { x: physics.shipX, y: physics.shipY },
          vel: {
            x: Math.cos(physics.shipAngle) * speed,
            y: Math.sin(physics.shipAngle) * speed,
          },
        },
        this.host.getPlanets().map((p) => ({
          x: p.x,
          y: p.y,
          radius: p.radius,
        })),
        dtEff,
        GRAVITY_ASSIST,
      );
      const boost = Math.hypot(delta.x, delta.y);
      if (boost > 0) physics.currentSpeed += boost;
    }
    if (this.windowMult > 1) {
      const extra = (this.windowMult - 1) * physics.currentSpeed * dtEff;
      physics.shipX += Math.cos(physics.shipAngle) * extra;
      physics.shipY += Math.sin(physics.shipAngle) * extra;
    }
  }

  private updateBanking(
    physics: ExecutionShipPhysics | null,
    dtMs: number,
    executing: boolean,
  ): void {
    let target = 0;
    if (executing && physics) {
      if (this.prevShipAngle !== null) {
        const rate = shipTurnRate(this.prevShipAngle, physics.shipAngle, dtMs);
        target = bankingAngle(rate, BANKING);
      }
      this.prevShipAngle = physics.shipAngle;
    } else {
      this.prevShipAngle = null;
    }
    this.roll = approachRoll(this.roll, target, dtMs, BANKING);
    const visual = this.host.getPlayerVisual();
    if (visual?.scale) {
      visual.scale.y = Math.cos(this.roll);
    }
  }

  private advanceMissiles(dtMs: number): void {
    if (this.missiles.length === 0) return;
    for (const m of this.missiles) {
      const gone = m.target.container?.destroyed || m.target.isGone();
      const targetPos = gone ? null : { x: m.target.x, y: m.target.y };
      m.state = advanceMissile(m.state, targetPos, dtMs, MISSILE_COMBAT);
      m.trail.push({ x: m.state.pos.x, y: m.state.pos.y });
      if (m.state.status === "arrived") {
        m.state = resolveMissileArrival(m.state, this.rng(), MISSILE_COMBAT);
        if (m.state.status === "hit" && !gone) {
          this.host.landShot(m.target, m.state.damage, m.state.pos);
        }
      }
    }
    this.missiles = this.missiles.filter((m) => !isMissileDone(m.state));
  }

  private advanceAllies(dtMs: number): void {
    if (this.allies.length === 0) return;
    if (!this.host.isCombatActive()) {
      this.allies = [];
      return;
    }
    this.allies = this.allies.filter(
      (a) => !a.sprite.container?.destroyed && !a.sprite.isGone(),
    );
    for (const ally of this.allies) {
      ally.fireTimerMs += dtMs;
      if (ally.fireTimerMs < GAME_BALANCE.combatFireIntervalMs) continue;
      const target = this.nearestCombatant(ally.sprite.x, ally.sprite.y);
      if (!target) {
        ally.fireTimerMs = GAME_BALANCE.combatFireIntervalMs; // primed
        continue;
      }
      const d = Math.hypot(target.x - ally.sprite.x, target.y - ally.sprite.y);
      if (d > npcWeaponRange(ally.sprite.npc)) {
        ally.fireTimerMs = GAME_BALANCE.combatFireIntervalMs; // primed
        continue;
      }
      ally.fireTimerMs = 0;
      const from = { x: ally.sprite.x, y: ally.sprite.y };
      this.host.landShot(target, ally.sprite.npc.damage, from);
      this.shotFx.push({
        spec: {
          variant: { kind: WeaponVfxKind.BEAM, distortion: false },
          from,
          to: { x: target.x, y: target.y },
          color: ALLY_SHOT_COLOR,
        },
        ageMs: 0,
      });
    }
  }

  private nearestCombatant(x: number, y: number): NpcShipSprite | null {
    let best: NpcShipSprite | null = null;
    let bestD = Infinity;
    for (const s of this.host.combatants()) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private advanceWrecks(dtMs: number): void {
    if (this.wrecks.length === 0) return;
    for (const w of this.wrecks) {
      const prevAge = w.state.ageMs;
      w.state = advanceWreck(w.state, dtMs, WRECK);
      const due = dueLootEmissions(prevAge, w.state.ageMs, w.emissionTimes);
      for (let i = 0; i < due.length; i++) {
        this.host.spawnLoot(w.npc, w.state.x, w.state.y, 1);
      }
    }
    this.wrecks = this.wrecks.filter((w) => !isWreckDone(w.state));
  }

  private draw(): void {
    const fx = this.ensureGraphics("fx");
    if (fx) {
      const shots: WeaponVfxSpec[] = this.shotFx.map((s) => ({
        ...s.spec,
        alpha: Math.max(0, 1 - s.ageMs / SHOT_FX_MS),
      }));
      for (const m of this.missiles) {
        shots.push({
          variant: { kind: WeaponVfxKind.MISSILE_TRAIL, distortion: false },
          from: { x: m.state.launchPos.x, y: m.state.launchPos.y },
          to: { x: m.state.pos.x, y: m.state.pos.y },
          trail: missileTrailPoints(m.trail),
          alpha: 1,
        });
      }
      drawWeaponVfx(fx, shots);
    }
    const flashG = this.ensureGraphics("flash");
    if (flashG) {
      const specs: ShieldFlashSpec[] = this.flashes.map((f) => ({
        x: f.x,
        y: f.y,
        radius: f.radius,
        alpha: shieldFlashAlpha(f.ageMs, SHIELD_COMBAT),
      }));
      drawShieldFlashes(flashG, specs);
    }
    const bars = this.ensureGraphics("bars");
    if (bars) {
      const specs = this.statusBarSpecs();
      this.lastDrawnBarCount = specs.length;
      drawShipStatusBars(bars, specs, SHIELD_COMBAT);
    }
    const wrecks = this.ensureGraphics("wrecks");
    if (wrecks) {
      drawWrecks(
        wrecks,
        this.wrecks.map((w) => ({
          x: w.state.x,
          y: w.state.y,
          angle: w.state.angle,
          alpha: wreckAlpha(w.state, WRECK),
          size: SHIP_VISUAL_RADIUS,
        })),
      );
    }
  }

  private statusBarSpecs(): ShipStatusBarSpec[] {
    if (!this.host.isCombatActive()) return [];
    const specs: ShipStatusBarSpec[] = [];
    for (const s of this.host.combatants()) {
      const npc = s.npc;
      const seenMax = Math.max(
        this.npcShieldMax.get(npc.id) ?? 0,
        npc.shields ?? 0,
      );
      if (seenMax > 0) this.npcShieldMax.set(npc.id, seenMax);
      specs.push({
        x: s.x,
        y: s.y,
        hull: npc.hullHP,
        maxHull: npc.maxHull,
        shields: npc.shields,
        maxShields: seenMax,
        hullColor: 0xff5544,
      });
    }
    const player = this.playerStatusBarSpec();
    if (player) specs.push(player);
    return specs;
  }

  playerStatusBarSpec(): ShipStatusBarSpec | null {
    const physics = this.host.getShipPhysics();
    const ship = this.host.getPlayerShip();
    if (!physics || !ship) return null;
    return {
      x: physics.shipX,
      y: physics.shipY,
      hull: ship.hullHP,
      maxHull: ship.maxHull,
      shields: ship.shields,
      maxShields: ship.maxShields,
    };
  }

  drawPlanningStatusBars(): void {
    if (!this.host.isCombatActive()) return;
    const bars = this.ensureGraphics("bars");
    if (!bars) return;
    const player = this.playerStatusBarSpec();
    const specs = player ? [player] : [];
    this.lastDrawnBarCount = specs.length;
    drawShipStatusBars(bars, specs, SHIELD_COMBAT);
  }

  private readonly gfx = new Map<string, Graphics>();

  private ensureGraphics(key: string): Graphics | null {
    let g = this.gfx.get(key) ?? null;
    if (g && !g.destroyed) return g;
    try {
      g = new Graphics();
    } catch {
      return null; // headless callers without a working Graphics stub
    }
    g.eventMode = "none";
    g.zIndex = key === "wrecks" ? 60 : key === "bars" ? 120 : 95;
    this.host.getGameLayer().addChild(g);
    this.gfx.set(key, g);
    return g;
  }

  endFight(): void {
    for (const m of this.missiles) {
      m.state = { ...m.state, status: "miss" };
    }
    this.missiles = [];
    this.jams = [];
    this.allies = [];
    this.shotFx = [];
    this.windowMult = 1;
    this.engineWear = pristineEngine();
    this.roll = 0;
    this.prevShipAngle = null;
    this.npcShieldMax.clear();
    const visual = this.host.getPlayerVisual();
    if (visual?.scale) visual.scale.y = 1;
    const bars = this.gfx.get("bars");
    if (bars && !bars.destroyed) drawShipStatusBars(bars, [], SHIELD_COMBAT);
    this.lastDrawnBarCount = 0;
    const fx = this.gfx.get("fx");
    if (fx && !fx.destroyed) drawWeaponVfx(fx, []);
  }

  destroy(): void {
    this.endFight();
    this.wrecks = [];
    this.flashes = [];
    this.deferredLootNpcIds.clear();
    for (const g of this.gfx.values()) {
      if (!g.destroyed) {
        g.parent?.removeChild(g);
        g.destroy();
      }
    }
    this.gfx.clear();
  }
}

export function createCombatExecution(
  host: CombatExecutionHost,
): CombatExecutionController {
  return new CombatExecutionController(host);
}
