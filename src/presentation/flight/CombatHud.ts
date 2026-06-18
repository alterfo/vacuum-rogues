import { Container, Graphics, Text } from "pixi.js";
import { GearKind, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "../NpcShipSprite";

/**
 * Live state the combat HUD reads from the host scene without depending on the
 * concrete {@link SpaceFlightScene} or {@link CombatModule} (Low Coupling / DIP).
 */
export interface CombatHudDeps {
  /** Player ship world position — centre of the weapon-range overlay. */
  getShipPos(): { x: number; y: number } | null;
  /** Current viewport size, used to anchor the overlay in the top-right. */
  getScreenSize(): { width: number; height: number };
  /** Player's canonical loadout — source of the auto-selected weapon + range. */
  getPlayerLoadout(): ShipLoadout | null;
}

const RANGE_COLOR = 0x00ffee;

// Compact overlay geometry (top-right): target name + two HP bars.
const PANEL_W = 240;
const PANEL_H = 60;
const PANEL_MARGIN = 20;
const BAR_X = 8;
const BAR_W = PANEL_W - BAR_X * 2;
const BAR_H = 10;
const TARGET_BAR_Y = 24;
const PLAYER_BAR_Y = 42;

const PANEL_BG = 0x0a1018;
const BAR_BG = 0x222a33;
const TARGET_HP_COLOR = 0xff4444; // red — enemy
const PLAYER_HP_COLOR = 0x44ff88; // green — player

// Engaged-enemy reticle drawn (world space) around every combatant so the
// player can read who is in the fight at a glance: a four-corner bracket, red
// for a generic combatant, brighter yellow + larger for the auto-fire target.
const MARKER_COLOR = 0xff5555;
const SELECTED_MARKER_COLOR = 0xffe066;
const MARKER_R = 26; // bracket half-extent around the hull (world px)

// Per-turn fire flash: a brief beam from shooter to target that fades over its
// lifetime so each exchanged shot reads as a discrete "ход". Cyan-green when the
// player fires, red when an enemy fires.
const FLASH_TTL_MS = 220;
const PLAYER_FLASH_COLOR = 0x66ffcc;
const NPC_FLASH_COLOR = 0xff5544;

/**
 * In-flight combat HUD (real-time model): a compact top-right overlay showing
 * the selected target's name + hull bar (red) and the player's hull bar (green),
 * plus the dashed weapon-range circle drawn in world space around the player
 * ship. There is no longer a weapon-selection panel or "Атаковать"/"Отступить"
 * buttons — the player's weapon auto-fires and target selection happens by
 * clicking enemy sprites; this HUD is purely a status readout.
 *
 * It owns its display objects on the layers handed in: the overlay lives on the
 * UI layer, the range circle on the game (world) layer so it pans/zooms with the
 * route and orbit overlays. {@link CombatModule} drives it — opening it on combat
 * start, pushing HP each frame via {@link updateTargetHP} / {@link updatePlayerHP},
 * following the ship with {@link syncRangeCircle}, and closing it on end.
 */
export class CombatHud {
  private readonly uiLayer: Container;
  private readonly gameLayer: Container;
  private readonly deps: CombatHudDeps;

  private panel: Container | null = null;
  private targetLabel: Text | null = null;
  private targetBarFill: Graphics | null = null;
  private playerBarFill: Graphics | null = null;
  private rangeCircle: Graphics | null = null;

  /** World-space layer holding the per-combatant engaged-enemy reticles. */
  private markerLayer: Container | null = null;
  private readonly markers = new Map<NpcShipSprite, Graphics>();

  /** World-space layer holding the live (fading) fire-flash beams. */
  private flashLayer: Container | null = null;
  private readonly flashes: { g: Graphics; age: number }[] = [];

  private _rangeRadius = 0;
  private targetHpFraction = 0;
  private playerHpFraction = 1;

  constructor(uiLayer: Container, gameLayer: Container, deps: CombatHudDeps) {
    this.uiLayer = uiLayer;
    this.gameLayer = gameLayer;
    this.deps = deps;
  }

  /**
   * The player's active weapon — always the first equipped weapon in the
   * loadout (auto-selected; there is no manual weapon switching any more).
   */
  get selectedWeapon(): WeaponSpec | null {
    const loadout = this.deps.getPlayerLoadout();
    if (!loadout) return null;
    return (
      loadout
        .slottedWithGear()
        .map((s) => s.gear)
        .find((g): g is WeaponSpec => !!g && g.kind === GearKind.WEAPON) ?? null
    );
  }

  /** Radius (world-px) of the current weapon-range circle; 0 when none drawn. */
  get rangeRadius(): number {
    return this._rangeRadius;
  }

  /** Whether the overlay is currently mounted. */
  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** Current target hull fill ratio (0..1) shown in the red bar. */
  get targetHpRatio(): number {
    return this.targetHpFraction;
  }

  /** Current player hull fill ratio (0..1) shown in the green bar. */
  get playerHpRatio(): number {
    return this.playerHpFraction;
  }

  /** Number of engaged-enemy reticles currently drawn (one per combatant). */
  get engagedMarkerCount(): number {
    return this.markers.size;
  }

  /** Number of fire-flash beams still fading on screen. */
  get activeFlashCount(): number {
    return this.flashes.length;
  }

  /**
   * Open the HUD for a fight: build the compact overlay, anchor it top-right,
   * set the target name + HP, and draw the dashed range circle (auto-selected
   * weapon's range) around the player ship.
   */
  open(target: NpcShipSprite | null): void {
    this.close();
    this.buildPanel();
    this.positionPanel();
    this.setTarget(target);
    this.updatePlayerHP(1, 1);
    const weapon = this.selectedWeapon;
    this.drawRangeCircle(weapon ? weapon.range : 0);
    // World-space overlays: engaged-enemy reticles + fire flashes. Added after
    // the range circle so they read on top of it; both pan/zoom with the world.
    this.markerLayer = new Container();
    this.markerLayer.eventMode = "none";
    this.gameLayer.addChild(this.markerLayer);
    this.flashLayer = new Container();
    this.flashLayer.eventMode = "none";
    this.gameLayer.addChild(this.flashLayer);
  }

  /**
   * Point the overlay at a (possibly null) target: update the name label and the
   * red hull bar. Called on open and whenever {@link CombatModule} switches the
   * selected target.
   */
  setTarget(target: NpcShipSprite | null): void {
    if (this.targetLabel) {
      this.targetLabel.text = target ? target.npc.name : "Цель не выбрана";
    }
    if (target) this.updateTargetHP(target.npc.hullHP, target.npc.maxHull);
    else this.updateTargetHP(0, 1);
  }

  /** Push the selected target's hull into the red bar (0..1 of `max`). */
  updateTargetHP(current: number, max: number): void {
    this.targetHpFraction = max > 0 ? clamp01(current / max) : 0;
    this.redrawBar(this.targetBarFill, this.targetHpFraction, TARGET_HP_COLOR);
  }

  /** Push the player's hull into the green bar (0..1 of `max`). */
  updatePlayerHP(current: number, max: number): void {
    this.playerHpFraction = max > 0 ? clamp01(current / max) : 0;
    this.redrawBar(this.playerBarFill, this.playerHpFraction, PLAYER_HP_COLOR);
  }

  /**
   * Redraw the dashed range circle at the player ship's current position so it
   * follows the moving ship. Cheap; safe to call every frame while combat is on.
   */
  syncRangeCircle(): void {
    if (this.rangeCircle) this.drawRangeCircle(this._rangeRadius);
  }

  /**
   * Reconcile the engaged-enemy reticles with the live combatant set: every
   * combatant gets a four-corner bracket at its world position (the auto-fire
   * `selected` target is drawn brighter + larger), and reticles for ships no
   * longer engaged are removed. Cheap; called each frame while combat is on.
   */
  syncMarkers(
    combatants: readonly NpcShipSprite[],
    selected: NpcShipSprite | null,
  ): void {
    if (!this.markerLayer) return;
    // Drop reticles for sprites that left the fight (killed / fled / despawned).
    for (const [sprite, g] of this.markers) {
      if (!combatants.includes(sprite)) {
        if (!g.destroyed) g.destroy();
        this.markers.delete(sprite);
      }
    }
    for (const sprite of combatants) {
      let g = this.markers.get(sprite);
      if (!g) {
        g = new Graphics();
        g.eventMode = "none";
        this.markerLayer.addChild(g);
        this.markers.set(sprite, g);
      }
      this.drawMarker(g, sprite === selected);
      g.x = sprite.x;
      g.y = sprite.y;
    }
  }

  /**
   * Spawn a per-turn fire flash: a fading beam from the shooter to its target so
   * each exchanged shot reads as a discrete "ход". `fromPlayer` colours it
   * cyan-green (player fire) or red (enemy fire). No-op without a render context.
   */
  flashShot(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fromPlayer: boolean,
  ): void {
    if (!this.flashLayer) return;
    const color = fromPlayer ? PLAYER_FLASH_COLOR : NPC_FLASH_COLOR;
    const g = new Graphics();
    g.eventMode = "none";
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color, width: 2.5, alpha: 0.9 });
    g.circle(x0, y0, 4).fill({ color, alpha: 0.95 }); // muzzle glow at the shooter
    this.flashLayer.addChild(g);
    this.flashes.push({ g, age: 0 });
  }

  /**
   * Advance the fire-flash beams: fade each toward transparent over
   * {@link FLASH_TTL_MS} and remove it once spent. Driven by
   * {@link CombatModule.update} every frame (independent of the fire cadence).
   */
  update(deltaTime: number): void {
    if (this.flashes.length === 0) return;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += deltaTime;
      const t = f.age / FLASH_TTL_MS;
      if (t >= 1) {
        if (!f.g.destroyed) f.g.destroy();
        this.flashes.splice(i, 1);
      } else {
        f.g.alpha = 1 - t;
      }
    }
  }

  /** Tear down every display object the HUD owns and reset its state. */
  close(): void {
    this._rangeRadius = 0;
    this.targetHpFraction = 0;
    this.playerHpFraction = 1;
    this.targetLabel = null;
    this.targetBarFill = null;
    this.playerBarFill = null;
    if (this.rangeCircle && !this.rangeCircle.destroyed) {
      this.rangeCircle.destroy();
    }
    this.rangeCircle = null;
    // Engaged-enemy reticles + fire flashes live under their own world layers;
    // destroying each layer with its children disposes every marker/beam at once.
    this.markers.clear();
    if (this.markerLayer && !this.markerLayer.destroyed) {
      this.markerLayer.destroy({ children: true });
    }
    this.markerLayer = null;
    this.flashes.length = 0;
    if (this.flashLayer && !this.flashLayer.destroyed) {
      this.flashLayer.destroy({ children: true });
    }
    this.flashLayer = null;
    if (this.panel && !this.panel.destroyed) {
      this.panel.destroy({ children: true });
    }
    this.panel = null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Build the static overlay chrome (panel bg, name label, two bar tracks). */
  private buildPanel(): void {
    const panel = new Container();
    panel.eventMode = "none"; // pure readout — never intercepts clicks
    this.uiLayer.addChild(panel);

    const bg = new Graphics();
    bg.roundRect(0, 0, PANEL_W, PANEL_H, 6).fill({
      color: PANEL_BG,
      alpha: 0.82,
    });
    bg.stroke({ color: RANGE_COLOR, width: 1, alpha: 0.5 });
    bg.eventMode = "none";
    panel.addChild(bg);

    const label = new Text({
      text: "",
      style: { fill: 0xffffff, fontSize: 13, fontWeight: "bold" },
    });
    label.x = BAR_X;
    label.y = 5;
    label.eventMode = "none";
    panel.addChild(label);

    panel.addChild(this.buildBarTrack(TARGET_BAR_Y));
    panel.addChild(this.buildBarTrack(PLAYER_BAR_Y));

    const targetFill = new Graphics();
    targetFill.x = BAR_X;
    targetFill.y = TARGET_BAR_Y;
    targetFill.eventMode = "none";
    panel.addChild(targetFill);

    const playerFill = new Graphics();
    playerFill.x = BAR_X;
    playerFill.y = PLAYER_BAR_Y;
    playerFill.eventMode = "none";
    panel.addChild(playerFill);

    this.panel = panel;
    this.targetLabel = label;
    this.targetBarFill = targetFill;
    this.playerBarFill = playerFill;
  }

  /** A static dark bar-track rectangle at the given local Y. */
  private buildBarTrack(y: number): Graphics {
    const track = new Graphics();
    track.roundRect(BAR_X, y, BAR_W, BAR_H, 2).fill(BAR_BG);
    track.eventMode = "none";
    return track;
  }

  /** Redraw an HP-bar fill from 0 to `fraction` of the bar width. */
  private redrawBar(
    fill: Graphics | null,
    fraction: number,
    color: number,
  ): void {
    if (!fill) return;
    fill.clear();
    const w = BAR_W * fraction;
    if (w > 0) fill.roundRect(0, 0, w, BAR_H, 2).fill(color);
  }

  /** Anchor the overlay in the top-right corner. */
  private positionPanel(): void {
    if (!this.panel) return;
    const { width } = this.deps.getScreenSize();
    this.panel.x = Math.max(20, width - PANEL_W - PANEL_MARGIN);
    this.panel.y = PANEL_MARGIN;
  }

  /**
   * Redraw a combatant reticle into `g`: four corner brackets framing the hull.
   * The auto-fire `selected` target gets a brighter colour, a wider stroke and a
   * larger frame so it stands out from the other engaged enemies.
   */
  private drawMarker(g: Graphics, selected: boolean): void {
    const color = selected ? SELECTED_MARKER_COLOR : MARKER_COLOR;
    const r = selected ? MARKER_R + 4 : MARKER_R;
    const len = r * 0.5; // bracket arm length
    g.clear();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = sx * r;
        const cy = sy * r;
        g.moveTo(cx - sx * len, cy).lineTo(cx, cy); // horizontal arm
        g.moveTo(cx, cy - sy * len).lineTo(cx, cy); // vertical arm
      }
    }
    g.stroke({ color, width: selected ? 2.5 : 2, alpha: 0.9 });
  }

  /** Draw (or redraw) the dashed range circle at the ship in world space. */
  private drawRangeCircle(radius: number): void {
    this._rangeRadius = radius;
    if (!this.rangeCircle) {
      this.rangeCircle = new Graphics();
      this.rangeCircle.eventMode = "none";
      this.gameLayer.addChild(this.rangeCircle);
    }
    const pos = this.deps.getShipPos() ?? { x: 0, y: 0 };
    const g = this.rangeCircle;
    g.clear();
    if (radius <= 0) return;
    const dashes = 60;
    const step = (Math.PI * 2) / dashes;
    for (let i = 0; i < dashes; i += 2) {
      const a0 = i * step;
      g.moveTo(pos.x + Math.cos(a0) * radius, pos.y + Math.sin(a0) * radius);
      g.arc(pos.x, pos.y, radius, a0, a0 + step);
    }
    g.stroke({ color: RANGE_COLOR, width: 2, alpha: 0.6 });
  }
}

/** Clamp a ratio into [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
