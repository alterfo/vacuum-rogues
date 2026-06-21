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

// Per-turn fire flash: a tracer bolt that visibly travels shooter→target so each
// exchanged shot reads as a discrete "ход" with an unmistakable direction. The
// bolt head streaks from source to target over TRACER_TRAVEL_MS (a muzzle glow
// anchors the source); on arrival an impact flash blooms at the target and fades
// over the rest of FLASH_TTL_MS. Cyan-green when the player fires, red when an
// enemy fires. Built from Graphics primitives only — no per-frame BlurFilter
// (see feedback-no-blur-filters-flight).
const FLASH_TTL_MS = 220;
/** Travel duration (ms): the bolt head interpolates source→target over this. */
export const TRACER_TRAVEL_MS = 130;
/** Length (world px) of the bright streak trailing behind the bolt head. */
const TRACER_STREAK_LEN = 26;
// Player fire is a saturated cyan-green, enemy fire a hot red-orange: opposite
// ends of the spectrum so attribution reads instantly even with several bolts
// crossing at once. Kept clearly distinct in hue *and* channel balance
// (player favours green/cyan, enemy red) — see combatTracerReadability.test.ts.
export const PLAYER_FLASH_COLOR = 0x66ffcc;
export const NPC_FLASH_COLOR = 0xff5544;
/**
 * White-hot core drawn over the coloured streak/head/impact. A bright neutral
 * centre lifts every bolt off the star field (the coloured halo alone can wash
 * out against bright nebula/star pixels) without a per-frame BlurFilter
 * (see feedback-no-blur-filters-flight) — the halo carries the side's hue.
 */
const TRACER_CORE_COLOR = 0xffffff;
/** Outer coloured glow width (world px) — the wide, soft side-coloured halo. */
const TRACER_HALO_WIDTH = 6;
/** Coloured bolt body width (world px) — the solid side-coloured streak. */
const TRACER_BODY_WIDTH = 3;
/** White-hot centre-line width (world px) — the legibility core over the halo. */
const TRACER_CORE_WIDTH = 1.4;

/** Live state for one in-flight tracer (a single shot shooter→target). */
interface FlashState {
  g: Graphics;
  age: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromPlayer: boolean;
}

/** Read-only snapshot of a live tracer for tests/inspection (no Graphics ref). */
export interface TracerSnapshot {
  from: { x: number; y: number };
  to: { x: number; y: number };
  age: number;
  fromPlayer: boolean;
  color: number;
  /** Interpolated bolt-head position (clamped to `to` after arrival). */
  pos: { x: number; y: number };
  /** Lifecycle phase: streaking to the target, or blooming at it. */
  phase: "travel" | "impact";
}

/**
 * Interpolated bolt-head position along a shot, clamped to the target once the
 * bolt has arrived (`age >= {@link TRACER_TRAVEL_MS}`). Pure — the deterministic
 * core of the traveling tracer, unit-tested directly.
 */
export function tracerBoltPos(
  from: { x: number; y: number },
  to: { x: number; y: number },
  age: number,
): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, age / TRACER_TRAVEL_MS));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

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

  /** World-space layer holding the live (traveling/fading) tracer bolts. */
  private flashLayer: Container | null = null;
  private readonly flashes: FlashState[] = [];

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

  /** Number of tracer bolts still traveling or fading on screen. */
  get activeFlashCount(): number {
    return this.flashes.length;
  }

  /**
   * Read-only snapshot of every live tracer (test/inspection hook): source,
   * target, age, shooter side + colour, and the current interpolated bolt
   * position / lifecycle phase. Mirrors {@link activeFlashCount} as a
   * deterministic view of the motion logic without exposing the Graphics.
   */
  get tracerStates(): readonly TracerSnapshot[] {
    return this.flashes.map((f) => ({
      from: { ...f.from },
      to: { ...f.to },
      age: f.age,
      fromPlayer: f.fromPlayer,
      color: f.fromPlayer ? PLAYER_FLASH_COLOR : NPC_FLASH_COLOR,
      pos: tracerBoltPos(f.from, f.to, f.age),
      phase: f.age < TRACER_TRAVEL_MS ? "travel" : "impact",
    }));
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
   * Spawn a per-turn fire flash: a tracer bolt that visibly travels from the
   * shooter `(x0,y0)` to its target `(x1,y1)` so each exchanged shot reads as a
   * discrete "ход" with an unmistakable direction. `fromPlayer` colours it
   * cyan-green (player fire) or red (enemy fire). The bolt streaks to the target
   * over {@link TRACER_TRAVEL_MS} (muzzle glow at the source), then blooms into
   * an impact flash there for the rest of {@link FLASH_TTL_MS}. The signature is
   * unchanged, so {@link CombatModule} needs no behavioural change. No-op without
   * a render context.
   */
  flashShot(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fromPlayer: boolean,
  ): void {
    if (!this.flashLayer) return;
    const g = new Graphics();
    g.eventMode = "none";
    this.flashLayer.addChild(g);
    const f: FlashState = {
      g,
      age: 0,
      from: { x: x0, y: y0 },
      to: { x: x1, y: y1 },
      fromPlayer,
    };
    this.flashes.push(f);
    this.drawFlash(f); // first frame: muzzle flash + bolt at the source
  }

  /**
   * Advance the tracer bolts: move each bolt head shooter→target over
   * {@link TRACER_TRAVEL_MS}, switch it to a fading impact flash on arrival, and
   * remove it once it crosses {@link FLASH_TTL_MS}. Driven by
   * {@link CombatModule.update} every frame (independent of the fire cadence).
   */
  update(deltaTime: number): void {
    if (this.flashes.length === 0) return;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += deltaTime;
      if (f.age >= FLASH_TTL_MS) {
        if (!f.g.destroyed) f.g.destroy();
        this.flashes.splice(i, 1);
      } else {
        this.drawFlash(f);
      }
    }
  }

  /**
   * Redraw one tracer for its current age. Travel phase: a layered streak — a
   * wide side-coloured halo, a solid coloured body and a white-hot centre line —
   * whose head sits at the interpolated position with a short tail trailing back
   * toward the shooter (so the eye reads the direction of travel), plus a muzzle
   * glow that fades as the bolt leaves the source. Impact phase: an expanding
   * coloured ring + a white-hot core blooming at the target, fading over the
   * remaining lifetime. The wide halo + bright neutral core make each bolt read
   * over the star field, and the opposed player/enemy hues make attribution
   * unmistakable. Graphics primitives only — no BlurFilter.
   */
  private drawFlash(f: FlashState): void {
    const color = f.fromPlayer ? PLAYER_FLASH_COLOR : NPC_FLASH_COLOR;
    const g = f.g;
    g.clear();
    g.alpha = 1;
    if (f.age < TRACER_TRAVEL_MS) {
      const head = tracerBoltPos(f.from, f.to, f.age);
      const dx = f.to.x - f.from.x;
      const dy = f.to.y - f.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const travelled = len * (f.age / TRACER_TRAVEL_MS);
      const tailLen = Math.min(TRACER_STREAK_LEN, travelled);
      const tailX = head.x - (dx / len) * tailLen;
      const tailY = head.y - (dy / len) * tailLen;
      // Three stacked strokes (wide soft halo → coloured body → white core) so
      // the bolt stands proud of a bright star field without any blur filter.
      g.moveTo(tailX, tailY)
        .lineTo(head.x, head.y)
        .stroke({ color, width: TRACER_HALO_WIDTH, alpha: 0.4 });
      g.moveTo(tailX, tailY)
        .lineTo(head.x, head.y)
        .stroke({ color, width: TRACER_BODY_WIDTH, alpha: 0.95 });
      g.moveTo(tailX, tailY)
        .lineTo(head.x, head.y)
        .stroke({
          color: TRACER_CORE_COLOR,
          width: TRACER_CORE_WIDTH,
          alpha: 0.85,
        });
      g.circle(head.x, head.y, 4).fill({ color, alpha: 1 }); // bolt head halo
      g.circle(head.x, head.y, 1.8).fill({
        color: TRACER_CORE_COLOR,
        alpha: 0.95,
      }); // hot core
      const muzzleAlpha = 0.9 * (1 - f.age / TRACER_TRAVEL_MS);
      g.circle(f.from.x, f.from.y, 6).fill({
        color,
        alpha: muzzleAlpha * 0.45,
      });
      g.circle(f.from.x, f.from.y, 3).fill({ color, alpha: muzzleAlpha });
    } else {
      const k = (f.age - TRACER_TRAVEL_MS) / (FLASH_TTL_MS - TRACER_TRAVEL_MS); // 0→1
      const a = 1 - k;
      const r = 5 + k * 8; // expanding ring
      g.circle(f.to.x, f.to.y, r).fill({ color, alpha: 0.5 * a });
      g.circle(f.to.x, f.to.y, r).stroke({ color, width: 2.5, alpha: a });
      g.circle(f.to.x, f.to.y, 2 + 2 * a).fill({
        color: TRACER_CORE_COLOR,
        alpha: 0.8 * a,
      }); // hot core bloom
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
