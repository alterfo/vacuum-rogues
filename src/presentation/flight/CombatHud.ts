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
