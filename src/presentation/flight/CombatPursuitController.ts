import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { SHIP_STOP_THRESHOLD } from "@/systems/ShipPhysics";
import type { NpcShipManagerDeps } from "./NpcShipManager";
import { OVERMIND_CORE_ID } from "./NpcShipManager";
import {
  factionKindOf,
  mutuallyHostile,
  overmindCombatTargets,
  type RangedNpc,
} from "@/systems/npc/factionHostility";
import { FlightCombatResolver } from "@/systems/FlightCombatResolver";
import {
  shouldReaim,
  smoothLeadPoint,
  shouldReplotRoute,
  avoidStarPath,
  type Point,
} from "@/utils/flightGeometry";
import { GAME_BALANCE, SYSTEM_GEOMETRY } from "@/config/balance";
import { NpcRole } from "@/types";

export interface CombatPursuitDeps {
  flight: NpcShipManagerDeps;
  getGameEngine(): GameEngine | null;
  getNpcSprites(): NpcShipSprite[];
  npcLeadPoint(sprite: NpcShipSprite): { x: number; y: number };
  aimRoute(x: number, y: number): void;
  scannerRange: number;
  weaponRange: number;
  handleInFlightDeath(
    sprite: NpcShipSprite,
    rng: () => number,
    killedByPlayer: boolean,
  ): void;
  playerIsGoodWithPirates?(): boolean;
  rollShakedown?(npc: NpcShip): boolean;
  openShakedownHail?(npc: NpcShip): void;
  clearNpcAnchor?(sprite: NpcShipSprite): void;
}

export class CombatPursuitController {
  followNpcId: string | null = null;

  approachNpcId: string | null = null;

  npcCrossfireTimer = 0;

  lastAimX = 0;
  lastAimY = 0;
  private readonly REAIM_DRIFT_PX = 30;

  smoothedLead: Point | null = null;
  steerTargetId: string | null = null;
  steerStarAvoiding = false;
  chaseClockMs = 0;
  lastReplotMs = -Infinity;
  private readonly LEAD_SMOOTHER = { alpha: 0.25, maxStepPx: 6 } as const;
  private readonly REPLOT_MIN_INTERVAL_MS = 500;

  pursuitSuspended = false;

  private readonly shakedownEvaluated = new Set<string>();

  private readonly WEAPON_RANGE: number;
  private readonly SCANNER_RANGE: number;
  private readonly COMBAT_ORBIT_RANGE: number;
  private readonly COMBAT_ORBIT_MIN_RANGE: number;
  private readonly COMBAT_ORBIT_CARROT = 2000;
  private static readonly ORBIT_PARK_EPS = SHIP_STOP_THRESHOLD;
  private readonly combatResolver = new FlightCombatResolver();

  constructor(private readonly deps: CombatPursuitDeps) {
    this.WEAPON_RANGE = deps.weaponRange;
    this.SCANNER_RANGE = deps.scannerRange;
    this.COMBAT_ORBIT_RANGE = this.WEAPON_RANGE * 0.6;
    this.COMBAT_ORBIT_MIN_RANGE = this.WEAPON_RANGE * 0.6 * 0.5;
  }

  reset(): void {
    this.followNpcId = null;
    this.approachNpcId = null;
    this.pursuitSuspended = false;
    this.shakedownEvaluated.clear();
  }

  tickAggressor(sprite: NpcShipSprite, physics: ShipPhysics): boolean {
    if (
      sprite.npc.role === NpcRole.PIRATE &&
      (this.deps.playerIsGoodWithPirates?.() ?? false) &&
      !(this.deps.flight.isCombatant?.(sprite) ?? false)
    ) {
      sprite.setAggressive(false);
      this.deps.clearNpcAnchor?.(sprite);
      return false;
    }

    const dx = sprite.x - physics.shipX;
    const dy = sprite.y - physics.shipY;
    const distSq = dx * dx + dy * dy;

    if (
      sprite.npc.role === NpcRole.PIRATE &&
      !this.shakedownEvaluated.has(sprite.npc.id) &&
      distSq <= this.SCANNER_RANGE * this.SCANNER_RANGE
    ) {
      this.shakedownEvaluated.add(sprite.npc.id);
      if (this.deps.rollShakedown?.(sprite.npc) ?? false) {
        this.deps.openShakedownHail?.(sprite.npc);
        return true;
      }
    }

    if (
      distSq >
        GAME_BALANCE.combatEscapeRange * GAME_BALANCE.combatEscapeRange &&
      physics.canOutrun(sprite.cruiseSpeed)
    ) {
      sprite.setAggressive(false);
      this.deps.clearNpcAnchor?.(sprite);
    } else {
      sprite.setPursuitTarget(
        physics.shipX,
        physics.shipY,
        physics.currentSpeed,
      );
      if (distSq <= this.WEAPON_RANGE * this.WEAPON_RANGE) {
        if (
          !(this.deps.flight.isInCombat?.() ?? false) &&
          physics.isMoving &&
          physics.isFollowingRoute()
        ) {
          this.pursuitSuspended = true;
        }
        this.deps.flight.startInFlightCombat?.(sprite);
      }
    }
    return false;
  }

  launchCombatWithNpc(npc: NpcShip): void {
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    if (!sprite) return;
    this.followNpcId = null;
    this.approachNpcId = null;
    this.steerTargetId = null; // fresh chase leg — reset the lead smoother
    this.pursuitSuspended = false; // fresh engagement re-arms the auto-pursuit
    sprite.setAggressive(true);
    this.deps.flight.startInFlightCombat?.(sprite);
    this.deps.flight.selectCombatTarget?.(sprite);
    this.deps.flight.onPlayerEngagesCombat?.(sprite); // pause immediately — no orbit before dialog
  }

  updateCombat(deltaTime: number): void {
    const physics = this.deps.flight.getShipPhysics();
    if (!physics) return;
    this.chaseClockMs += deltaTime;

    if (this.deps.flight.isInCombat?.()) {
      this.updateCombatPursuit(physics);
      return;
    }

    if (this.approachNpcId) {
      this.updateApproach(physics);
      return;
    }

    const ship = this.deps.getGameEngine()?.player?.ship;
    if (!ship) return;

    const decision = this.combatResolver.decide({
      isTurnRunning: this.deps.flight.isTurnRunning(),
      followNpcId: this.followNpcId,
      shipPhysics: physics,
      npcSprites: this.deps.getNpcSprites(),
      weaponRange: this.WEAPON_RANGE,
    });

    switch (decision.action) {
      case "idle":
        return;
      case "lost":
        this.deps.flight.showMessage("Цель потеряна", 0xffaa00);
        this.followNpcId = null;
        this.deps.flight.endTurn();
        return;
      case "chase": {
        const chased = this.deps
          .getNpcSprites()
          .find((s) => s.npc.id === this.followNpcId);
        const lead = chased
          ? this.deps.npcLeadPoint(chased)
          : { x: decision.targetX, y: decision.targetY };
        if (
          !physics.isMoving ||
          shouldReaim(
            { x: this.lastAimX, y: this.lastAimY },
            lead,
            this.REAIM_DRIFT_PX,
          )
        ) {
          this.deps.aimRoute(lead.x, lead.y);
          this.lastAimX = lead.x;
          this.lastAimY = lead.y;
        }
        return;
      }
      case "launch":
        this.launchCombatWithNpc(decision.npc);
        return;
    }
  }

  breakOffCombatPursuit(): void {
    this.pursuitSuspended = true;
  }

  private updateCombatPursuit(physics: ShipPhysics): void {
    if (this.deps.flight.isPaused?.()) return; // active-pause: maneuvering frozen
    if (!this.deps.flight.isTurnRunning()) return; // orbit is turn-gated: Space ends the turn → orbit stops
    if (this.pursuitSuspended) {
      if (physics.isMoving) return;
      this.pursuitSuspended = false;
    }
    const targetId = this.deps.flight.getCombatTargetId?.() ?? null;
    if (!targetId) return;
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === targetId);
    if (!sprite) return;
    const dx = sprite.x - physics.shipX;
    const dy = sprite.y - physics.shipY;
    if (dx * dx + dy * dy > this.WEAPON_RANGE * this.WEAPON_RANGE) {
      this.steerTowardLead(physics, sprite, targetId);
      return;
    }
    this.steerCombatOrbit(physics, sprite);
  }

  private steerCombatOrbit(physics: ShipPhysics, sprite: NpcShipSprite): void {
    const toShipX = physics.shipX - sprite.x;
    const toShipY = physics.shipY - sprite.y;
    const dist = Math.hypot(toShipX, toShipY);
    let ux: number;
    let uy: number;
    if (dist < 1e-3) {
      ux = Math.cos(physics.shipAngle);
      uy = Math.sin(physics.shipAngle);
    } else {
      ux = toShipX / dist;
      uy = toShipY / dist;
    }
    const headDot =
      Math.cos(physics.shipAngle) * -uy + Math.sin(physics.shipAngle) * ux;
    const s = headDot >= 0 ? 1 : -1;
    const tx = -uy * s;
    const ty = ux * s;
    const radial = (this.COMBAT_ORBIT_RANGE - dist) / this.COMBAT_ORBIT_RANGE;
    const tanWeight = Math.min(1, dist / this.COMBAT_ORBIT_MIN_RANGE);
    let dirX = tx * tanWeight + ux * radial;
    let dirY = ty * tanWeight + uy * radial;
    const dlen = Math.hypot(dirX, dirY) || 1;
    dirX /= dlen;
    dirY /= dlen;
    const carrot = this.clampOrbitPoint(
      physics,
      dirX,
      dirY,
      this.COMBAT_ORBIT_CARROT,
    );
    const far = this.clampOrbitPoint(
      physics,
      dirX,
      dirY,
      this.COMBAT_ORBIT_CARROT * 2,
    );
    this.lastAimX = carrot.x;
    this.lastAimY = carrot.y;
    physics.setPath([carrot, far]);
  }

  private clampOrbitPoint(
    physics: ShipPhysics,
    dirX: number,
    dirY: number,
    desiredDist: number,
  ): Point {
    const raw = {
      x: physics.shipX + dirX * desiredDist,
      y: physics.shipY + dirY * desiredDist,
    };
    const center = this.deps.flight.getStarCenter();
    const ocx = physics.shipX - center.x;
    const ocy = physics.shipY - center.y;
    const shipDistToCenter = Math.hypot(ocx, ocy);
    if (shipDistToCenter > SYSTEM_GEOMETRY.boundaryRadius) return raw;
    const rawDistToCenter = Math.hypot(raw.x - center.x, raw.y - center.y);
    if (rawDistToCenter <= SYSTEM_GEOMETRY.boundaryRadius) return raw;
    const b = 2 * (ocx * dirX + ocy * dirY);
    const c =
      ocx * ocx +
      ocy * ocy -
      SYSTEM_GEOMETRY.boundaryRadius * SYSTEM_GEOMETRY.boundaryRadius;
    const disc = Math.max(0, b * b - 4 * c);
    const tExit = Math.max(0, (-b + Math.sqrt(disc)) / 2);
    if (tExit >= desiredDist) return raw;
    if (tExit > CombatPursuitController.ORBIT_PARK_EPS) {
      return {
        x: physics.shipX + dirX * tExit,
        y: physics.shipY + dirY * tExit,
      };
    }
    const exitX = ocx + dirX * tExit;
    const exitY = ocy + dirY * tExit;
    const sense = exitX * dirY - exitY * dirX >= 0 ? 1 : -1;
    const arc =
      ((desiredDist - tExit) / SYSTEM_GEOMETRY.boundaryRadius) * sense;
    const cos = Math.cos(arc);
    const sin = Math.sin(arc);
    return {
      x: center.x + exitX * cos - exitY * sin,
      y: center.y + exitX * sin + exitY * cos,
    };
  }

  private updateApproach(physics: ShipPhysics): void {
    const approachId = this.approachNpcId;
    const sprite = this.deps
      .getNpcSprites()
      .find((s) => s.npc.id === approachId);
    if (!approachId || !sprite || !physics.isMoving) {
      this.approachNpcId = null;
      return;
    }
    this.steerTowardLead(physics, sprite, approachId);
  }

  private steerTowardLead(
    physics: ShipPhysics,
    sprite: NpcShipSprite,
    targetId: string,
  ): void {
    if (targetId !== this.steerTargetId) {
      this.steerTargetId = targetId;
      this.smoothedLead = null;
      this.steerStarAvoiding = false;
    }
    const raw = this.deps.npcLeadPoint(sprite);
    this.smoothedLead = smoothLeadPoint(
      this.smoothedLead,
      raw,
      this.LEAD_SMOOTHER,
    );
    const lead = this.smoothedLead;

    if (!physics.isMoving) {
      this.replotChase(lead);
      return;
    }

    if (this.leadLineCrossesStar(physics, lead)) {
      const justBlocked = !this.steerStarAvoiding;
      if (
        justBlocked ||
        shouldReplotRoute(
          {
            endpoint: { x: this.lastAimX, y: this.lastAimY },
            lastReplotMs: this.lastReplotMs,
          },
          lead,
          this.REAIM_DRIFT_PX,
          this.chaseClockMs,
          this.REPLOT_MIN_INTERVAL_MS,
        )
      ) {
        this.replotChase(lead);
      }
      this.steerStarAvoiding = true;
      return;
    }
    this.steerStarAvoiding = false;

    this.lastAimX = lead.x;
    this.lastAimY = lead.y;
    physics.setTarget(lead.x, lead.y);
  }

  private replotChase(lead: Point): void {
    this.lastReplotMs = this.chaseClockMs;
    this.deps.aimRoute(lead.x, lead.y);
  }

  private leadLineCrossesStar(physics: ShipPhysics, lead: Point): boolean {
    const radius = this.deps.flight.getStarAvoidRadius?.();
    if (radius == null) return false;
    const center = this.deps.flight.getStarCenter();
    return (
      avoidStarPath(
        physics.shipX,
        physics.shipY,
        lead.x,
        lead.y,
        center.x,
        center.y,
        radius,
      ).length > 1
    );
  }

  rememberFlightPos(): void {
    const physics = this.deps.flight.getShipPhysics();
    const engine = this.deps.getGameEngine();
    if (physics && engine) {
      engine.lastFlightShipPos = { x: physics.shipX, y: physics.shipY };
    }
  }

  nearestNpcEnemy(sprite: NpcShipSprite): NpcShipSprite | null {
    if (sprite.npc.id === OVERMIND_CORE_ID) return null;
    const selfKind = factionKindOf(sprite.npc);
    let best: NpcShipSprite | null = null;
    let bestD2 = this.SCANNER_RANGE * this.SCANNER_RANGE;
    for (const other of this.deps.getNpcSprites()) {
      if (other === sprite || other.isGone()) continue;
      if (other.npc.id === OVERMIND_CORE_ID) continue;
      const otherKind = factionKindOf(other.npc);
      if (selfKind !== "overmind" && otherKind !== "overmind") continue;
      if (!mutuallyHostile(selfKind, otherKind, { pirateRep: 0 })) continue;
      const dx = other.x - sprite.x;
      const dy = other.y - sprite.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = other;
      }
    }
    return best;
  }

  resolveNpcVsNpcCombat(deltaTime: number): void {
    if (this.deps.flight.isPaused?.()) return;
    this.npcCrossfireTimer += deltaTime;
    if (this.npcCrossfireTimer < GAME_BALANCE.combatFireIntervalMs) return;
    this.npcCrossfireTimer = 0;
    const npcSprites = this.deps.getNpcSprites();
    if (npcSprites.length < 2) return;

    const combatants: RangedNpc[] = npcSprites
      .filter((s) => s.npc.id !== OVERMIND_CORE_ID)
      .map((s) => ({
        id: s.npc.id,
        kind: factionKindOf(s.npc),
        x: s.x,
        y: s.y,
      }));
    const engagements = overmindCombatTargets(combatants, this.WEAPON_RANGE, {
      pirateRep: 0,
    });
    if (engagements.size === 0) return;

    const byId = new Map(npcSprites.map((s) => [s.npc.id, s]));
    const killed = new Set<NpcShipSprite>();
    for (const [attackerId, targetId] of engagements) {
      const attacker = byId.get(attackerId);
      const target = byId.get(targetId);
      if (!attacker || !target) continue;
      if (killed.has(attacker) || killed.has(target)) continue;
      target.npc.hullHP = Math.max(0, target.npc.hullHP - attacker.npc.damage);
      attacker.npc.hullHP = Math.max(
        0,
        attacker.npc.hullHP - target.npc.damage,
      );
      if (target.npc.hullHP <= 0) killed.add(target);
      if (attacker.npc.hullHP <= 0) killed.add(attacker);
    }
    for (const sprite of killed) {
      this.deps.handleInFlightDeath(sprite, Math.random, false);
    }
  }
}
