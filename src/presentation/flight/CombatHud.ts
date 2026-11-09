import { Container, Graphics, Text } from "pixi.js";
import { GearKind, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { NpcShipSprite } from "../NpcShipSprite";
import { scaledText } from "../ui/scaledText";
import { lineStepFor } from "../ui/questCardLayout";
import { scaledFont } from "@/utils/fontScale";

export interface CombatHudDeps {
  getShipPos(): { x: number; y: number } | null;
  getScreenSize(): { width: number; height: number };
  getPlayerLoadout(): ShipLoadout | null;
}

const RANGE_COLOR = 0x00ffee;

const PANEL_W = 240;
const PANEL_MARGIN = 20;
const BAR_X = 8;
const BAR_W = PANEL_W - BAR_X * 2;
const BAR_H = 10;
const LABEL_BASE_PX = 13;
const LABEL_Y = 5;
const LABEL_BAR_GAP = 3;
const BAR_GAP = 8;
const PANEL_BOTTOM_PAD = 8;

export interface CombatHudPanelLayout {
  readonly labelY: number;
  readonly targetBarY: number;
  readonly playerBarY: number;
  readonly panelHeight: number;
}

export function combatHudPanelLayout(
  labelFontPx: number,
): CombatHudPanelLayout {
  const labelStep = lineStepFor(labelFontPx);
  const targetBarY = LABEL_Y + labelStep + LABEL_BAR_GAP;
  const playerBarY = targetBarY + BAR_H + BAR_GAP;
  return {
    labelY: LABEL_Y,
    targetBarY,
    playerBarY,
    panelHeight: playerBarY + BAR_H + PANEL_BOTTOM_PAD,
  };
}

const PANEL_BG = 0x0a1018;
const BAR_BG = 0x222a33;
const TARGET_HP_COLOR = 0xff4444; // red — enemy
const PLAYER_HP_COLOR = 0x44ff88; // green — player

const MARKER_COLOR = 0xff5555;
const SELECTED_MARKER_COLOR = 0xffe066;
const MARKER_R = 26; // bracket half-extent around the hull (world px)

const FLASH_TTL_MS = 220;
export const TRACER_TRAVEL_MS = 130;
const TRACER_STREAK_LEN = 26;
export const PLAYER_FLASH_COLOR = 0x66ffcc;
export const NPC_FLASH_COLOR = 0xff5544;
const TRACER_CORE_COLOR = 0xffffff;
const TRACER_HALO_WIDTH = 6;
const TRACER_BODY_WIDTH = 3;
const TRACER_CORE_WIDTH = 1.4;

interface FlashState {
  g: Graphics;
  age: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromPlayer: boolean;
}

export interface TracerSnapshot {
  from: { x: number; y: number };
  to: { x: number; y: number };
  age: number;
  fromPlayer: boolean;
  color: number;
  pos: { x: number; y: number };
  phase: "travel" | "impact";
}

export function tracerBoltPos(
  from: { x: number; y: number },
  to: { x: number; y: number },
  age: number,
): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, age / TRACER_TRAVEL_MS));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export class CombatHud {
  private readonly uiLayer: Container;
  private readonly gameLayer: Container;
  private readonly deps: CombatHudDeps;

  private panel: Container | null = null;
  private targetLabel: Text | null = null;
  private targetBarFill: Graphics | null = null;
  private playerBarFill: Graphics | null = null;
  private rangeCircle: Graphics | null = null;

  private markerLayer: Container | null = null;
  private readonly markers = new Map<NpcShipSprite, Graphics>();

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

  get rangeRadius(): number {
    return this._rangeRadius;
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  get targetHpRatio(): number {
    return this.targetHpFraction;
  }

  get playerHpRatio(): number {
    return this.playerHpFraction;
  }

  get engagedMarkerCount(): number {
    return this.markers.size;
  }

  get activeFlashCount(): number {
    return this.flashes.length;
  }

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

  open(target: NpcShipSprite | null): void {
    this.close();
    this.buildPanel();
    this.positionPanel();
    this.setTarget(target);
    this.updatePlayerHP(1, 1);
    const weapon = this.selectedWeapon;
    this.drawRangeCircle(weapon ? weapon.range : 0);
    this.markerLayer = new Container();
    this.markerLayer.eventMode = "none";
    this.gameLayer.addChild(this.markerLayer);
    this.flashLayer = new Container();
    this.flashLayer.eventMode = "none";
    this.gameLayer.addChild(this.flashLayer);
  }

  setTarget(target: NpcShipSprite | null): void {
    if (this.targetLabel) {
      this.targetLabel.text = target ? target.npc.name : "Цель не выбрана";
    }
    if (target) this.updateTargetHP(target.npc.hullHP, target.npc.maxHull);
    else this.updateTargetHP(0, 1);
  }

  updateTargetHP(current: number, max: number): void {
    this.targetHpFraction = max > 0 ? clamp01(current / max) : 0;
    this.redrawBar(this.targetBarFill, this.targetHpFraction, TARGET_HP_COLOR);
  }

  updatePlayerHP(current: number, max: number): void {
    this.playerHpFraction = max > 0 ? clamp01(current / max) : 0;
    this.redrawBar(this.playerBarFill, this.playerHpFraction, PLAYER_HP_COLOR);
  }

  syncRangeCircle(): void {
    if (this.rangeCircle) this.drawRangeCircle(this._rangeRadius);
  }

  syncMarkers(
    combatants: readonly NpcShipSprite[],
    selected: NpcShipSprite | null,
  ): void {
    if (!this.markerLayer) return;
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
      g.moveTo(tailX, tailY)
        .lineTo(head.x, head.y)
        .stroke({ color, width: TRACER_HALO_WIDTH, alpha: 0.4 });
      g.moveTo(tailX, tailY)
        .lineTo(head.x, head.y)
        .stroke({ color, width: TRACER_BODY_WIDTH, alpha: 0.95 });
      g.moveTo(tailX, tailY).lineTo(head.x, head.y).stroke({
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

  private buildPanel(): void {
    const panel = new Container();
    panel.eventMode = "none"; // pure readout — never intercepts clicks
    this.uiLayer.addChild(panel);

    const layout = combatHudPanelLayout(scaledFont(LABEL_BASE_PX));

    const bg = new Graphics();
    bg.roundRect(0, 0, PANEL_W, layout.panelHeight, 6).fill({
      color: PANEL_BG,
      alpha: 0.82,
    });
    bg.stroke({ color: RANGE_COLOR, width: 1, alpha: 0.5 });
    bg.eventMode = "none";
    panel.addChild(bg);

    const label = scaledText("", LABEL_BASE_PX, 0xffffff, {
      fontWeight: "bold",
    });
    label.x = BAR_X;
    label.y = layout.labelY;
    label.eventMode = "none";
    panel.addChild(label);

    panel.addChild(this.buildBarTrack(layout.targetBarY));
    panel.addChild(this.buildBarTrack(layout.playerBarY));

    const targetFill = new Graphics();
    targetFill.x = BAR_X;
    targetFill.y = layout.targetBarY;
    targetFill.eventMode = "none";
    panel.addChild(targetFill);

    const playerFill = new Graphics();
    playerFill.x = BAR_X;
    playerFill.y = layout.playerBarY;
    playerFill.eventMode = "none";
    panel.addChild(playerFill);

    this.panel = panel;
    this.targetLabel = label;
    this.targetBarFill = targetFill;
    this.playerBarFill = playerFill;
  }

  private buildBarTrack(y: number): Graphics {
    const track = new Graphics();
    track.roundRect(BAR_X, y, BAR_W, BAR_H, 2).fill(BAR_BG);
    track.eventMode = "none";
    return track;
  }

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

  private positionPanel(): void {
    if (!this.panel) return;
    const { width } = this.deps.getScreenSize();
    this.panel.x = Math.max(20, width - PANEL_W - PANEL_MARGIN);
    this.panel.y = PANEL_MARGIN;
  }

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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
