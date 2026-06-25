import { Container, Graphics, Sprite, Circle } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { pickVariant } from "./textures";
import { GAME_BALANCE } from "@/config/balance";
import { hashStr } from "@/utils/hashStr";
import { decideManeuver, ManeuverMode } from "@/systems/combat/combatManeuver";

/** Maps an NPC role to its ship-art asset prefix (src/assets/ships/<prefix>). */
const ROLE_SHIP_PREFIX: Record<NpcRole, string> = {
  [NpcRole.RANGER]: "ranger",
  [NpcRole.TRADER]: "trader",
  [NpcRole.PIRATE]: "pirate",
  [NpcRole.PATROL]: "patrol",
};

/** Hull art faces nose-up (bow at the top of the image); the container points +X
 *  along heading, so the sprite is pre-rotated +90° (clockwise) to align the
 *  nose with the direction of travel. */
const SHIP_SPRITE_ROTATION = Math.PI / 2;

/** Click hit-area geometry. The radius is `HIT_RADIUS_PX / cameraZoom` so the
 *  clickable area stays a fixed ~screen size, but never shrinks below
 *  `MIN_HIT_RADIUS_PX` (world px). The floor — plus the finite-zoom guard in
 *  {@link NpcShipSprite.assertClickable} — is what keeps a ship from going
 *  mouse-dead at high zoom or when the camera zoom briefly reads NaN/0. */
const HIT_RADIUS_PX = 40;
const MIN_HIT_RADIUS_PX = 28;

/** Hull colour by faction. */
const FACTION_COLORS: Record<Faction, number> = {
  [Faction.OUTLANDERS]: 0xff6600,
  [Faction.BASTIONS]: 0xcc0000,
  [Faction.SYNDICATE]: 0x00ff00,
  [Faction.PARADOXES]: 0x9900ff,
  [Faction.PROGRESSORS]: 0x0066ff,
  [Faction.INDEPENDENT]: 0x999999,
  [Faction.OVERMIND]: 0xff33dd,
};

/** Intent indicator colour by role (hostile / trade / neutral). */
const INTENT_COLORS: Record<NpcRole, number> = {
  [NpcRole.PIRATE]: 0xff3030,
  [NpcRole.TRADER]: 0xffcc44,
  [NpcRole.RANGER]: 0x44ddff,
  [NpcRole.PATROL]: 0x44ff88,
};

/**
 * System geometry the NPC moves within.
 * - `rInner`..`rOuter` — band where ships wander.
 * - `boundary` — the system edge (рубеж гиперпрыжка): ships enter and leave
 *   the system here, never popping in/out mid-system.
 */
export interface SystemBounds {
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  boundary: number;
}

/**
 * Visual representation of an autonomous NPC ship inside the player's current
 * system (Feature 8, slice 2). Position is presentation-managed and ephemeral;
 * identity/state come from the (persisted) NpcShip. Movement advances only when
 * the world is running (turn-based pause).
 *
 * Hyperjumps happen only at the system boundary: arriving ships spawn on the
 * boundary and fly inward; departing ships fly out to the boundary and then
 * "jump" (the sprite is removed once it reaches the edge).
 */
export class NpcShipSprite {
  public readonly container: Container;
  public readonly npc: NpcShip;
  /** Faction colour, exposed for the minimap radar dot. */
  public readonly mapColor: number;
  public x: number;
  public y: number;

  private targetX: number;
  private targetY: number;
  private readonly graphics: Graphics;
  // Hull art (if loaded); when present the procedural triangle is skipped and
  // only the faction halo + intent dot are drawn (US-070 #8).
  private shipSprite: Sprite | null = null;
  private readonly bounds: SystemBounds;
  private readonly speed = GAME_BALANCE.npcSpeed;
  private departing = false;
  private gone = false;
  // When set, the ship orbits this point (a planet it's "visiting").
  private anchorX: number | null = null;
  private anchorY: number | null = null;
  private orbitAngle = 0;
  private orbitRadius = 70;
  private orbitDir = 1; // +1 / -1
  private readonly orbitSpeed = 0.0006; // rad/ms (~10s per lap)
  private clickCallback: ((npc: NpcShip) => void) | null = null;
  /** Last finite camera zoom applied to the hit-area, so interactivity can be
   *  re-asserted (turn-end / combat) without a fresh camera transform. Seeded to
   *  1 and only overwritten by a finite, positive zoom (a NaN/0 zoom is ignored
   *  rather than collapsing the hit circle). */
  private lastHitZoom = 1;
  /**
   * When set, `pickNewTarget` calls this instead of random ring/anchor logic.
   * Injected by `NpcShipManager` so movement is role-driven without the sprite
   * importing other modules (dependency inversion).
   * The `seq` parameter is incremented each call so successive waypoints differ
   * while remaining deterministic.
   */
  private targetProvider: ((seq: number) => { x: number; y: number }) | null =
    null;
  private targetSeq = 0;
  /**
   * Called by `NpcShipManager` when a non-departing ship arrives at its target.
   * Allows the manager to re-anchor the sprite to the destination planet without
   * the sprite importing manager types (dependency inversion).
   */
  private arrivalCallback: (() => void) | null = null;
  /** How long (ms game time) the ship dwells in orbit before moving on. */
  public readonly dwellDurationMs: number;
  /** Accumulated orbit time (ms) toward dwellDurationMs. */
  private dwellElapsed = 0;
  /**
   * When true this is a captured-system garrison aggressor: it breaks off any
   * planet orbit and pursues the player ship (target refreshed each frame by
   * {@link NpcShipManager} via {@link setPursuitTarget}) instead of wandering.
   * The actual exchange of fire is resolved in-flight by the combat module
   * (later tasks); the sprite only handles the chase.
   */
  public aggressive = false;
  private pursuitX: number | null = null;
  private pursuitY: number | null = null;
  /** Player cruise speed last reported with the pursuit target — feeds the
   *  break-off/over-matched decision in {@link decideManeuver}. */
  private pursuitTargetSpeed = 0;
  /** +1 / -1: which way this aggressor circles the player (seeded per ship id
   *  so foes don't all orbit the same direction). Set in the constructor. */
  private aggressorOrbitDir: 1 | -1 = 1;

  constructor(npc: NpcShip, x: number, y: number, bounds: SystemBounds) {
    this.npc = npc;
    this.mapColor = FACTION_COLORS[npc.faction] ?? 0x999999;
    this.x = x;
    this.y = y;
    this.bounds = bounds;
    this.targetX = x;
    this.targetY = y;
    // Deterministic dwell duration (8–20 s of game time) based on ship id so
    // ships desynchronise naturally and don't all leave their planets at once.
    const h = hashStr(npc.id);
    this.dwellDurationMs = 8000 + (h % 12001);
    // Seed the orbit direction from a different bit than the planet orbit dir so
    // aggressors circle the player either way, deterministically per ship id.
    this.aggressorOrbitDir = (h >>> 17) & 1 ? 1 : -1;

    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    this.container.x = x;
    this.container.y = y;

    // Prefer ship art for the hull; a deterministic variant per ship id keeps
    // the same ship looking consistent across frames/visits.
    const prefix = ROLE_SHIP_PREFIX[npc.role] ?? "ranger";
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
    // Initial targetX/targetY = spawn position. pickNewTarget() is called by
    // setTargetProvider() once the manager wires the role-driven provider, so the
    // very first waypoint is purposeful (not a random ring point).
  }

  /** Wire hover callbacks for the tooltip system (must be called after setClickHandler). */
  setHoverHandler(
    onOver: (npc: NpcShip, screenX: number, screenY: number) => void,
    onOut: () => void,
  ): void {
    this.container.on("pointerover", (e: FederatedPointerEvent) =>
      onOver(this.npc, e.global.x, e.global.y),
    );
    this.container.on("pointerout", onOut);
  }

  /** Wire a click handler; stops propagation so the stage doesn't also fire. */
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

  /**
   * The clickability invariant for a live (non-departing/gone) ship: the
   * container is statically interactive with a finite circular hit-area never
   * smaller than {@link MIN_HIT_RADIUS_PX}. Re-asserting both `eventMode` and the
   * hit geometry on every camera transform / turn-end heals any clobber that
   * combat or a cursor switch may have left, and the finite-zoom floor means a
   * transient NaN/0 zoom can never collapse the hit circle to "never hits"
   * (`Math.max(28, 40/NaN) === NaN`, which `Circle.contains` always rejects).
   */
  private assertClickable(): void {
    this.container.eventMode = "static";
    const worldR = Math.max(
      MIN_HIT_RADIUS_PX,
      HIT_RADIUS_PX / this.lastHitZoom,
    );
    this.container.hitArea = new Circle(0, 0, worldR);
  }

  /** Whether the sprite currently has an orbit anchor set. */
  isAnchored(): boolean {
    return this.anchorX !== null;
  }

  /** Whether the ship is in the process of leaving the system. */
  isLeaving(): boolean {
    return this.departing;
  }

  /**
   * Scale the hit circle inversely with camera zoom so the clickable area stays
   * ~40 screen-px regardless of how far the player has zoomed out, and re-assert
   * interactivity so combat / cursor switches never leave a live ship mouse-dead.
   * A non-finite or non-positive `cameraZoom` is ignored (the last good zoom is
   * kept) so a transient bad transform can't collapse the hit-area.
   */
  updateHitArea(cameraZoom: number): void {
    if (this.departing || this.gone) return; // jumping out — non-interactive
    if (Number.isFinite(cameraZoom) && cameraZoom > 0) {
      this.lastHitZoom = cameraZoom;
    }
    this.assertClickable();
  }

  /**
   * Re-enable click/hover interactivity unless the ship is leaving the system.
   * Called when a turn ends so any ship that lost its hit-area mid-turn becomes
   * clickable again (Task 6: NPC ships must stay clickable between turns).
   * Departing/gone ships stay non-interactive — they are about to hyperjump out.
   */
  restoreInteractivity(): void {
    if (this.departing || this.gone) return;
    this.assertClickable();
  }

  /**
   * Begin leaving the system: head straight out to the boundary, where the ship
   * will hyperjump (be removed). Used when the simulation moves this NPC to a
   * different system.
   */
  beginDeparture(): void {
    if (this.departing) return;
    this.departing = true;
    this.container.eventMode = "none"; // no longer interactive while jumping out
    const dx = this.x - this.bounds.cx;
    const dy = this.y - this.bounds.cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    this.targetX = this.bounds.cx + (dx / len) * this.bounds.boundary;
    this.targetY = this.bounds.cy + (dy / len) * this.bounds.boundary;
  }

  /** True once a departing ship has reached the boundary and should be removed. */
  isGone(): boolean {
    return this.gone;
  }

  /** Advance movement. Call only while the world is running. */
  update(deltaTime: number): void {
    if (this.gone) return;

    // Garrison aggressor: maneuver against the player ship's live position —
    // CLOSE to weapon range, then ORBIT (circle/strafe) instead of tail-chasing;
    // BREAK_OFF when over-matched or badly hurt. The manager refreshes the
    // pursuit target each frame; in-flight combat (later modules) handles firing.
    if (
      this.aggressive &&
      !this.departing &&
      this.pursuitX !== null &&
      this.pursuitY !== null
    ) {
      const range = Math.hypot(this.pursuitX - this.x, this.pursuitY - this.y);
      const decision = decideManeuver({
        range,
        weaponRange: GAME_BALANCE.weaponRange,
        selfSpeed: this.speed,
        targetSpeed: this.pursuitTargetSpeed,
        selfX: this.x,
        selfY: this.y,
        targetX: this.pursuitX,
        targetY: this.pursuitY,
        hullRatio:
          this.npc.maxHull > 0 ? this.npc.hullHP / this.npc.maxHull : 1,
        orbitDir: this.aggressorOrbitDir,
      });
      // While closing, don't jitter when essentially on top of the target;
      // orbiting/breaking off always move (they steer sideways/away, not onto it).
      if (decision.mode !== ManeuverMode.CLOSE || range > 6) {
        const step = this.speed * deltaTime;
        this.x += Math.cos(decision.heading) * step;
        this.y += Math.sin(decision.heading) * step;
        this.container.rotation = decision.heading;
        this.container.x = this.x;
        this.container.y = this.y;
      }
      return;
    }

    // Visiting a planet: smoothly orbit it (eases onto the ring, then circles).
    // This reads as a deliberate "calling at the planet" rather than the chaotic
    // random hops it did before (US-070: NPCs need a clear purpose).
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

      // Bounded dwell: after dwellDurationMs the ship finishes its visit and
      // picks a new destination (another planet or a lane waypoint).  The
      // manager's update loop watches isAnchored() to clean up its anchor-planet
      // map and optionally re-anchor the ship when it approaches the next planet.
      this.dwellElapsed += deltaTime;
      if (this.dwellElapsed >= this.dwellDurationMs) {
        this.dwellElapsed = 0;
        this.anchorX = null;
        this.anchorY = null;
        this.pickNewTarget();
      }
      return;
    }

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 6) {
      if (this.departing) {
        this.gone = true; // reached the boundary → hyperjump out
      } else {
        // Notify the manager before picking the next target so it can re-anchor
        // this sprite to the planet it just arrived at (restoring orbit behavior
        // on every visit, not just the first).
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
    // Role-driven destination: use the injected provider when available so the
    // ship flies purposefully (planet visit, pirate hunt, patrol circuit) rather
    // than a random ring point.
    if (this.targetProvider) {
      const pos = this.targetProvider(this.targetSeq++);
      this.targetX = pos.x;
      this.targetY = pos.y;
      return;
    }
    // Fallback for anchored ships (orbit loiter near the planet).
    if (this.anchorX !== null && this.anchorY !== null) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 40 + Math.random() * 130;
      this.targetX = this.anchorX + Math.cos(angle) * radius;
      this.targetY = this.anchorY + Math.sin(angle) * radius;
      return;
    }
    // Last resort: random ring point (reached only when no provider is set and
    // no anchor exists — should not happen in normal play after wiring).
    const angle = Math.random() * Math.PI * 2;
    const radius =
      this.bounds.rInner +
      Math.random() * (this.bounds.rOuter - this.bounds.rInner);
    this.targetX = this.bounds.cx + Math.cos(angle) * radius;
    this.targetY = this.bounds.cy + Math.sin(angle) * radius;
  }

  /**
   * Inject a role-driven destination provider so `pickNewTarget` uses
   * purposeful targets instead of random ring points.  Called by
   * `NpcShipManager` after construction.  Immediately picks the first
   * purposeful waypoint so pirates never use the random-ring fallback.
   */
  setTargetProvider(fn: (seq: number) => { x: number; y: number }): void {
    this.targetProvider = fn;
    this.pickNewTarget();
  }

  /** Register a callback fired when this (non-departing) ship arrives at its
   *  target. `NpcShipManager` uses this to re-anchor the sprite to a planet on
   *  every visit — not just the first one. */
  setArrivalCallback(fn: () => void): void {
    this.arrivalCallback = fn;
  }

  /**
   * Flag (or clear) garrison-aggressor pursuit. Turning it on breaks any planet
   * orbit so the ship leaves its station to chase the player; turning it off
   * clears the live pursuit target.
   */
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

  /**
   * Live pursuit target (the player ship's world position + current speed),
   * refreshed each frame by {@link NpcShipManager}. The speed feeds the
   * over-matched break-off check in {@link decideManeuver} — a stationary player
   * (speed 0) is never treated as out-running the aggressor.
   */
  setPursuitTarget(x: number, y: number, targetSpeed = 0): void {
    this.pursuitX = x;
    this.pursuitY = y;
    this.pursuitTargetSpeed = targetSpeed;
  }

  /** Orbit a fixed point (a planet) instead of wandering the whole band. */
  setAnchor(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
    // Deterministic per ship id so orbit radius and direction are stable across
    // multiple visits to the same planet.
    const h = hashStr(this.npc.id);
    this.orbitRadius = 50 + (h % 46);
    this.orbitDir = (h >>> 16) & 1 ? 1 : -1;
    // Start the orbit angle at the ship's current bearing from the planet so it
    // eases on without a jump.
    this.orbitAngle = Math.atan2(this.y - y, this.x - x);
  }

  /** Update only the orbit center each frame as the planet moves. Does not
   *  reset orbit radius or direction. */
  updateAnchorPosition(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
  }

  private render(): void {
    const hull = FACTION_COLORS[this.npc.faction] ?? 0x999999;
    const intent = INTENT_COLORS[this.npc.role] ?? 0xffffff;
    const g = this.graphics;
    g.clear();

    // Soft faction-coloured halo so the ship reads even when the camera is
    // zoomed out over the (large) system. Also serves as the click hit-area
    // (the hull sprite is non-interactive).
    g.circle(0, 0, 22).fill({ color: hull, alpha: 0.12 });
    g.circle(0, 0, 16).fill({ color: hull, alpha: 0.14 });
    g.circle(0, 0, 11).fill({ color: hull, alpha: 0.22 });

    // Hull: when art is loaded the sprite is the hull — skip the procedural
    // triangle (US-070 #8). Otherwise draw the arrow pointing along +X.
    if (!this.shipSprite) {
      g.poly([14, 0, -10, -8, -10, 8]);
      g.fill({ color: hull });
      g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.85 });
    }

    // Intent indicator: a dot above the hull (hostile / trade / neutral).
    g.circle(0, -22, 4);
    g.fill({ color: intent });
    g.stroke({ width: 1, color: 0x000000, alpha: 0.5 });

    // Threat ring: an NPC that has turned openly hostile (a standing garrison,
    // or a neutral the player attacked) gets a red outline so friend and foe
    // read apart at a glance.
    if (this.npc.hostile) {
      g.circle(0, 0, 24).stroke({ width: 2, color: 0xff2020, alpha: 0.9 });
    }
  }

  /**
   * Re-render so the threat ring reflects the current {@link NpcShip.hostile}
   * state. Called by {@link NpcShipManager} when a ship turns hostile mid-flight
   * (the player attacked it or one of its faction-mates).
   */
  refreshThreat(): void {
    this.render();
  }

  destroy(): void {
    this.graphics.removeAllListeners();
    this.container.destroy({ children: true });
  }
}
