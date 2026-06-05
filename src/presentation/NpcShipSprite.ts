import { Container, Graphics, Sprite, Circle } from "pixi.js";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import { pickVariant } from "./textures";

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
  // px per ms drift speed: a calm cruise (~40% of the player's) so traffic reads
  // clearly without buzzing around like flies. (Was 0.05 — far too slow — then
  // briefly 0.5, which looked frantic when loitering near a planet.)
  private readonly speed = 0.2;
  private departing = false;
  private gone = false;
  // When set, the ship loiters near this point (a planet it's "visiting").
  private anchorX: number | null = null;
  private anchorY: number | null = null;
  private clickCallback: ((npc: NpcShip) => void) | null = null;

  constructor(npc: NpcShip, x: number, y: number, bounds: SystemBounds) {
    this.npc = npc;
    this.mapColor = FACTION_COLORS[npc.faction] ?? 0x999999;
    this.x = x;
    this.y = y;
    this.bounds = bounds;
    this.targetX = x;
    this.targetY = y;

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
    this.pickNewTarget();
  }

  /** Wire a click handler; stops propagation so the stage doesn't also fire. */
  setClickHandler(cb: (npc: NpcShip) => void): void {
    this.clickCallback = cb;
    // Make the whole container a generous circular hit target (not just the small
    // halo graphic) so every ship stays reliably clickable, even when zoomed out
    // or overlapping a planet (US-070: "not all ships are clickable").
    this.container.eventMode = "static";
    this.container.hitArea = new Circle(0, 0, 26);
    this.container.cursor =
      this.npc.role === NpcRole.PIRATE ? "target" : "pointer";
    this.container.on("pointerdown", (event) => {
      event.stopPropagation();
      this.clickCallback?.(this.npc);
    });
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

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 6) {
      if (this.departing) {
        this.gone = true; // reached the boundary → hyperjump out
      } else {
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
    // If anchored to a planet (a "visit"), loiter in a small area around it so
    // the ship reads as actually calling at the planet rather than aimlessly
    // crossing the system. Otherwise wander the whole band (pirates, patrols).
    if (this.anchorX !== null && this.anchorY !== null) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 40 + Math.random() * 130;
      this.targetX = this.anchorX + Math.cos(angle) * radius;
      this.targetY = this.anchorY + Math.sin(angle) * radius;
      return;
    }
    const angle = Math.random() * Math.PI * 2;
    const radius =
      this.bounds.rInner +
      Math.random() * (this.bounds.rOuter - this.bounds.rInner);
    this.targetX = this.bounds.cx + Math.cos(angle) * radius;
    this.targetY = this.bounds.cy + Math.sin(angle) * radius;
  }

  /** Loiter near a fixed point (a planet) instead of wandering the whole band. */
  setAnchor(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
    this.pickNewTarget();
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
  }

  destroy(): void {
    this.graphics.removeAllListeners();
    this.container.destroy({ children: true });
  }
}
