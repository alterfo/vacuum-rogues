import { Container, Graphics, Sprite, Circle } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { factionColor } from "./ui/palette";
import { pickVariant } from "./textures";
import { GAME_BALANCE, SUN_EXCLUSION_RADIUS } from "@/config/balance";
import { npcCruiseSpeed } from "./flight/npcCruiseSpeed";
import { hashStr } from "@/utils/hashStr";
import { decideManeuver, ManeuverMode } from "@/systems/combat/combatManeuver";
import { avoidStarPath, type Point } from "@/utils/flightGeometry";

const ROLE_SHIP_PREFIX: Record<NpcRole, string> = {
  [NpcRole.RANGER]: "ranger",
  [NpcRole.TRADER]: "trader",
  [NpcRole.PIRATE]: "pirate",
  [NpcRole.PATROL]: "patrol",
  [NpcRole.OVERMIND]: "patrol",
};

export function shipArtPrefix(
  npc: Pick<NpcShip, "role" | "faction" | "sizeTier">,
): string {
  if (npc.faction === Faction.OVERMIND) {
    return `overmind_${npc.sizeTier ?? "medium"}`;
  }
  return ROLE_SHIP_PREFIX[npc.role] ?? "ranger";
}

const SHIP_SPRITE_ROTATION = Math.PI / 2;

const HIT_RADIUS_PX = 40;
const MIN_HIT_RADIUS_PX = 28;

const INTENT_COLORS: Record<NpcRole, number> = {
  [NpcRole.PIRATE]: 0xff3030,
  [NpcRole.TRADER]: 0xffcc44,
  [NpcRole.RANGER]: 0x44ddff,
  [NpcRole.PATROL]: 0x44ff88,
  [NpcRole.OVERMIND]: 0xdd44ff,
};

export interface SystemBounds {
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  boundary: number;
}

export class NpcShipSprite {
  public readonly container: Container;
  public readonly npc: NpcShip;
  public mapColor: number;
  public x: number;
  public y: number;

  private targetX: number;
  private targetY: number;
  private waypoints: Point[] = [];
  private readonly graphics: Graphics;
  private shipSprite: Sprite | null = null;
  private readonly bounds: SystemBounds;
  private readonly speed: number;
  private departing = false;
  private gone = false;
  private anchorX: number | null = null;
  private anchorY: number | null = null;
  private orbitAngle = 0;
  private orbitRadius = 70;
  private orbitDir = 1; // +1 / -1
  private readonly orbitSpeed = 0.0006; // rad/ms (~10s per lap)
  private clickCallback: ((npc: NpcShip) => void) | null = null;
  private lastHitZoom = 1;
  private targetProvider: ((seq: number) => { x: number; y: number }) | null =
    null;
  private targetSeq = 0;
  private arrivalCallback: (() => void) | null = null;
  public readonly dwellDurationMs: number;
  private dwellElapsed = 0;
  public aggressive = false;
  private pursuitX: number | null = null;
  private pursuitY: number | null = null;
  private pursuitTargetSpeed = 0;
  private aggressorOrbitDir: 1 | -1 = 1;
  private npcCombatX: number | null = null;
  private npcCombatY: number | null = null;
  private grappled = false;

  constructor(npc: NpcShip, x: number, y: number, bounds: SystemBounds) {
    this.npc = npc;
    this.speed = npcCruiseSpeed(npc);
    this.mapColor = factionColor(npc.faction);
    this.x = x;
    this.y = y;
    this.bounds = bounds;
    this.targetX = x;
    this.targetY = y;
    const h = hashStr(npc.id);
    this.dwellDurationMs = 8000 + (h % 12001);
    this.aggressorOrbitDir = (h >>> 17) & 1 ? 1 : -1;

    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    this.container.x = x;
    this.container.y = y;

    const prefix = shipArtPrefix(npc);
    const tex = pickVariant("ships", prefix, npc.id);
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.width = 40;
      sp.height = 40;
      sp.rotation = SHIP_SPRITE_ROTATION;
      sp.eventMode = "none"; // clicks pass through to the halo hit-area below
      this.shipSprite = sp;
      this.container.addChild(sp);
    }

    this.render();
  }

  get cruiseSpeed(): number {
    return this.speed;
  }

  setHoverHandler(
    onOver: (npc: NpcShip, screenX: number, screenY: number) => void,
    onOut: () => void,
  ): void {
    this.container.on("pointerover", (e: FederatedPointerEvent) =>
      onOver(this.npc, e.global.x, e.global.y),
    );
    this.container.on("pointerout", onOut);
  }

  setClickHandler(cb: (npc: NpcShip) => void): void {
    this.clickCallback = cb;
    this.assertClickable();
    this.container.cursor =
      this.npc.role === NpcRole.PIRATE ? "target" : "pointer";
    this.container.on("pointerdown", (event) => {
      event.stopPropagation();
      this.clickCallback?.(this.npc);
    });
  }

  private assertClickable(): void {
    this.container.eventMode = "static";
    const worldR = Math.max(
      MIN_HIT_RADIUS_PX,
      HIT_RADIUS_PX / this.lastHitZoom,
    );
    this.container.hitArea = new Circle(0, 0, worldR);
  }

  isAnchored(): boolean {
    return this.anchorX !== null;
  }

  isLeaving(): boolean {
    return this.departing;
  }

  updateHitArea(cameraZoom: number): void {
    if (this.departing || this.gone) return; // jumping out — non-interactive
    if (Number.isFinite(cameraZoom) && cameraZoom > 0) {
      this.lastHitZoom = cameraZoom;
    }
    this.assertClickable();
  }

  restoreInteractivity(): void {
    if (this.departing || this.gone) return;
    this.assertClickable();
  }

  beginDeparture(): void {
    if (this.departing) return;
    this.departing = true;
    this.container.eventMode = "none"; // no longer interactive while jumping out
    const dx = this.x - this.bounds.cx;
    const dy = this.y - this.bounds.cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    this.targetX = this.bounds.cx + (dx / len) * this.bounds.boundary;
    this.targetY = this.bounds.cy + (dy / len) * this.bounds.boundary;
    this.waypoints = [];
  }

  isGone(): boolean {
    return this.gone;
  }

  update(deltaTime: number): void {
    if (this.gone) return;

    if (
      this.aggressive &&
      !this.departing &&
      this.pursuitX !== null &&
      this.pursuitY !== null
    ) {
      this.maneuverToward(
        this.pursuitX,
        this.pursuitY,
        this.pursuitTargetSpeed,
        deltaTime,
      );
      return;
    }

    if (
      !this.aggressive &&
      !this.departing &&
      this.npcCombatX !== null &&
      this.npcCombatY !== null
    ) {
      this.maneuverToward(this.npcCombatX, this.npcCombatY, 0, deltaTime);
      return;
    }

    if (!this.departing && this.anchorX !== null && this.anchorY !== null) {
      this.orbitAngle += this.orbitDir * this.orbitSpeed * deltaTime;
      const tx = this.anchorX + Math.cos(this.orbitAngle) * this.orbitRadius;
      const ty = this.anchorY + Math.sin(this.orbitAngle) * this.orbitRadius;
      const ox = tx - this.x;
      const oy = ty - this.y;
      const od = Math.hypot(ox, oy);
      const step = Math.min(od, this.speed * deltaTime);
      if (od > 0.001) {
        this.x += (ox / od) * step;
        this.y += (oy / od) * step;
        this.container.rotation = Math.atan2(oy, ox); // face direction of travel
      }
      this.container.x = this.x;
      this.container.y = this.y;

      this.dwellElapsed += deltaTime;
      if (this.dwellElapsed >= this.dwellDurationMs) {
        this.dwellElapsed = 0;
        this.anchorX = null;
        this.anchorY = null;
        this.pickNewTarget();
      }
      return;
    }

    const aim = this.waypoints[0] ?? { x: this.targetX, y: this.targetY };
    const dx = aim.x - this.x;
    const dy = aim.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 6) {
      if (this.waypoints.length > 0) {
        this.waypoints.shift(); // reached a bypass waypoint — aim at the next one
      } else if (this.departing) {
        this.gone = true; // reached the boundary → hyperjump out
      } else {
        this.arrivalCallback?.();
        this.pickNewTarget();
      }
      return;
    }

    const step = Math.min(dist, this.speed * deltaTime);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    this.container.x = this.x;
    this.container.y = this.y;
    this.container.rotation = Math.atan2(dy, dx);
  }

  private pickNewTarget(): void {
    if (this.targetProvider) {
      const pos = this.targetProvider(this.targetSeq++);
      this.setDestination(pos.x, pos.y);
      return;
    }
    if (this.anchorX !== null && this.anchorY !== null) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 40 + Math.random() * 130;
      this.setDestination(
        this.anchorX + Math.cos(angle) * radius,
        this.anchorY + Math.sin(angle) * radius,
      );
      return;
    }
    const angle = Math.random() * Math.PI * 2;
    const radius =
      this.bounds.rInner +
      Math.random() * (this.bounds.rOuter - this.bounds.rInner);
    this.setDestination(
      this.bounds.cx + Math.cos(angle) * radius,
      this.bounds.cy + Math.sin(angle) * radius,
    );
  }

  private setDestination(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    const distToStar = Math.hypot(x - this.bounds.cx, y - this.bounds.cy);
    if (distToStar < SUN_EXCLUSION_RADIUS) {
      this.waypoints = [];
      return;
    }
    const path = avoidStarPath(
      this.x,
      this.y,
      x,
      y,
      this.bounds.cx,
      this.bounds.cy,
      SUN_EXCLUSION_RADIUS,
    );
    this.waypoints = path.slice(0, -1);
  }

  setTargetProvider(fn: (seq: number) => { x: number; y: number }): void {
    this.targetProvider = fn;
    this.pickNewTarget();
  }

  setArrivalCallback(fn: () => void): void {
    this.arrivalCallback = fn;
  }

  setAggressive(on: boolean): void {
    this.aggressive = on;
    if (on) {
      this.anchorX = null;
      this.anchorY = null;
    } else {
      this.pursuitX = null;
      this.pursuitY = null;
    }
  }

  setPursuitTarget(x: number, y: number, targetSpeed = 0): void {
    this.pursuitX = x;
    this.pursuitY = y;
    this.pursuitTargetSpeed = targetSpeed;
  }

  setNpcCombatTarget(x: number, y: number): void {
    this.npcCombatX = x;
    this.npcCombatY = y;
  }
  clearNpcCombatTarget(): void {
    this.npcCombatX = null;
    this.npcCombatY = null;
  }

  setGrappled(v: boolean): void {
    this.grappled = v;
  }

  isGrappled(): boolean {
    return this.grappled;
  }

  private maneuverToward(
    targetX: number,
    targetY: number,
    targetSpeed: number,
    deltaTime: number,
  ): void {
    const range = Math.hypot(targetX - this.x, targetY - this.y);
    const decision = decideManeuver({
      range,
      weaponRange: GAME_BALANCE.weaponRange,
      selfSpeed: this.speed,
      targetSpeed,
      selfX: this.x,
      selfY: this.y,
      targetX,
      targetY,
      hullRatio: this.npc.maxHull > 0 ? this.npc.hullHP / this.npc.maxHull : 1,
      orbitDir: this.aggressorOrbitDir,
      grappled: this.grappled,
    });

    if (decision.mode === ManeuverMode.BREAK_OFF) {
      const step = this.speed * deltaTime;
      const nextDist = Math.hypot(
        this.x + Math.cos(decision.heading) * step - this.bounds.cx,
        this.y + Math.sin(decision.heading) * step - this.bounds.cy,
      );
      if (nextDist >= this.bounds.boundary) {
        this.beginDeparture();
        return;
      }
    }

    if (decision.mode !== ManeuverMode.CLOSE || range > 6) {
      const step = this.speed * deltaTime;
      this.x += Math.cos(decision.heading) * step;
      this.y += Math.sin(decision.heading) * step;
      this.container.rotation = decision.heading;
      this.container.x = this.x;
      this.container.y = this.y;
    }
  }

  setAnchor(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
    const h = hashStr(this.npc.id);
    this.orbitRadius = 50 + (h % 46);
    this.orbitDir = (h >>> 16) & 1 ? 1 : -1;
    this.orbitAngle = Math.atan2(this.y - y, this.x - x);
  }

  updateAnchorPosition(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
  }

  private render(): void {
    const hull = factionColor(this.npc.faction);
    const intent = INTENT_COLORS[this.npc.role] ?? 0xffffff;
    const g = this.graphics;
    g.clear();

    g.circle(0, 0, 22).fill({ color: hull, alpha: 0.12 });
    g.circle(0, 0, 16).fill({ color: hull, alpha: 0.14 });
    g.circle(0, 0, 11).fill({ color: hull, alpha: 0.22 });

    if (!this.shipSprite) {
      g.poly([14, 0, -10, -8, -10, 8]);
      g.fill({ color: hull });
      g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.85 });
    }

    g.circle(0, -22, 4);
    g.fill({ color: intent });
    g.stroke({ width: 1, color: 0x000000, alpha: 0.5 });

    if (this.npc.hostile) {
      g.circle(0, 0, 24).stroke({ width: 2, color: 0xff2020, alpha: 0.9 });
    }
  }

  refreshThreat(): void {
    this.render();
  }

  destroy(): void {
    this.graphics.removeAllListeners();
    this.container.destroy({ children: true });
  }
}
