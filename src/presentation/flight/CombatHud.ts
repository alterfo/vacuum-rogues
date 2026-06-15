import { Container, Graphics } from "pixi.js";
import { UiButton } from "../ui/UiButton";
import { GearKind, type WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";

/**
 * Live state the combat HUD reads from the host scene without depending on the
 * concrete {@link SpaceFlightScene} or {@link CombatModule} (Low Coupling / DIP).
 */
export interface CombatHudDeps {
  /** Player ship world position — centre of the weapon-range overlay. */
  getShipPos(): { x: number; y: number } | null;
  /** Current viewport size, used to anchor the weapon panel along the bottom. */
  getScreenSize(): { width: number; height: number };
}

/** One weapon card in the panel: its gear id, spec and the clickable button. */
export interface WeaponCard {
  readonly weaponId: string;
  readonly spec: WeaponSpec;
  readonly button: UiButton;
}

const SELECTED_COLOR = 0x00ffee;
const UNSELECTED_COLOR = 0x667788;

/**
 * In-flight combat HUD (Task 12): the weapon-selection panel plus the
 * "Атаковать" / "Отступить" action buttons, and the dashed weapon-range circle
 * drawn in world space at the player ship.
 *
 * It owns its own display objects on the layers handed in: the panel lives on
 * the UI layer, the range circle on the game (world) layer so it pans/zooms with
 * the route and orbit overlays. {@link CombatModule} drives it — opening it on
 * combat start (default-selecting the first weapon), toggling the "Атаковать"
 * enabled state as the target moves in/out of range, and closing it on end. The
 * HUD fans button presses back out through {@link onWeaponSelected},
 * {@link onAttack} and {@link onRetreat}; it never reaches into the module.
 */
export class CombatHud {
  private readonly uiLayer: Container;
  private readonly gameLayer: Container;
  private readonly deps: CombatHudDeps;

  private panel: Container | null = null;
  private cards: WeaponCard[] = [];
  private _attackButton: UiButton | null = null;
  private _retreatButton: UiButton | null = null;
  private rangeCircle: Graphics | null = null;

  private _rangeRadius = 0;
  private attackEnabled = false;
  // Content widths tracked as the rows are built so {@link positionPanel} never
  // measures Text bounds (canvas font metrics are unavailable under jsdom).
  private weaponRowWidth = 0;
  private actionRowWidth = 0;

  /** The currently selected weapon's gear id (null when none/closed). */
  selectedWeaponId: string | null = null;

  // --- Callbacks the module wires (DIP): the HUD fans presses out. ---
  /** A weapon card was selected (also fired on the default-select at open). */
  onWeaponSelected: ((weaponId: string) => void) | null = null;
  /** "Атаковать" pressed while enabled — resolve one combat round (Task 13). */
  onAttack: (() => void) | null = null;
  /** "Отступить" pressed — end the fight immediately. */
  onRetreat: (() => void) | null = null;

  constructor(uiLayer: Container, gameLayer: Container, deps: CombatHudDeps) {
    this.uiLayer = uiLayer;
    this.gameLayer = gameLayer;
    this.deps = deps;
  }

  /** Radius (world-px) of the current weapon-range circle; 0 when none drawn. */
  get rangeRadius(): number {
    return this._rangeRadius;
  }

  /** Whether the "Атаковать" button is currently armed. */
  get isAttackEnabled(): boolean {
    return this.attackEnabled;
  }

  /** The "Атаковать" confirm button (null before {@link open}). */
  get attackButton(): UiButton | null {
    return this._attackButton;
  }

  /** The "Отступить" retreat button (null before {@link open}). */
  get retreatButton(): UiButton | null {
    return this._retreatButton;
  }

  /**
   * Open the HUD for a fight: build the weapon panel + action buttons, anchor it
   * along the bottom, and default-select the first weapon (drawing its range).
   */
  open(loadout: ShipLoadout | null): void {
    this.close();
    this.buildWeaponPanel(loadout);
    this.buildActionButtons();
    this.positionPanel();
    if (this.cards.length > 0) this.selectWeapon(this.cards[0].weaponId);
  }

  /**
   * Build one clickable card per equipped weapon (name, damage, range). Returns
   * the cards; clicking one selects it and emits {@link onWeaponSelected}.
   */
  buildWeaponPanel(loadout: ShipLoadout | null): WeaponCard[] {
    this.ensurePanel();
    for (const c of this.cards) {
      if (!c.button.container.destroyed) c.button.container.destroy();
    }
    this.cards = [];

    const CARD_W = 168;
    const CARD_H = 52;
    const GAP = 8;
    const weapons = this.extractWeapons(loadout);
    weapons.forEach((spec, i) => {
      const card = new UiButton(
        "",
        `${spec.name}\nУрон ${spec.damage} · Дальн. ${spec.range}`,
        "neutral",
        (event) => {
          event.stopPropagation();
          this.selectWeapon(spec.id);
        },
        CARD_W,
        CARD_H,
      );
      card.x = i * (CARD_W + GAP);
      card.y = 0;
      this.panel!.addChild(card.container);
      this.cards.push({ weaponId: spec.id, spec, button: card });
    });
    this.weaponRowWidth =
      weapons.length > 0 ? weapons.length * (CARD_W + GAP) - GAP : 0;
    return this.cards;
  }

  /**
   * Select a weapon: highlight its card, (re)draw the dashed range circle at the
   * player ship, and notify the module. Reuses the single range Graphics so the
   * previous circle is replaced, never leaked.
   */
  selectWeapon(weaponId: string): void {
    const card = this.cards.find((c) => c.weaponId === weaponId);
    if (!card) return;
    this.selectedWeaponId = weaponId;
    for (const c of this.cards) {
      c.button.setAccentColor(
        c.weaponId === weaponId ? SELECTED_COLOR : UNSELECTED_COLOR,
      );
    }
    this.drawRangeCircle(card.spec.range);
    this.onWeaponSelected?.(weaponId);
  }

  /**
   * Arm/disarm the "Атаковать" button. The module computes the gate (a target is
   * selected AND within the selected weapon's range) and pushes the result here.
   */
  setAttackEnabled(enabled: boolean): void {
    this.attackEnabled = enabled;
    this.applyAttackEnabledVisual();
  }

  /** Tear down every display object the HUD owns and reset its state. */
  close(): void {
    this.selectedWeaponId = null;
    this._rangeRadius = 0;
    this.attackEnabled = false;
    this.cards = [];
    this._attackButton = null;
    this._retreatButton = null;
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

  private ensurePanel(): void {
    if (this.panel) return;
    this.panel = new Container();
    this.uiLayer.addChild(this.panel);
  }

  private extractWeapons(loadout: ShipLoadout | null): WeaponSpec[] {
    if (!loadout) return [];
    return loadout
      .slottedWithGear()
      .map((s) => s.gear)
      .filter((g): g is WeaponSpec => !!g && g.kind === GearKind.WEAPON);
  }

  private buildActionButtons(): void {
    this.ensurePanel();
    const BTN_W = 132;
    const BTN_H = 36;
    const ROW_Y = 52 + 10; // below the weapon cards
    const attack = new UiButton(
      "⚔",
      "Атаковать",
      "danger",
      (event) => {
        event.stopPropagation();
        if (this.attackEnabled) this.onAttack?.();
      },
      BTN_W,
      BTN_H,
    );
    attack.x = 0;
    attack.y = ROW_Y;
    const retreat = new UiButton(
      "✕",
      "Отступить",
      "neutral",
      (event) => {
        event.stopPropagation();
        this.onRetreat?.();
      },
      BTN_W,
      BTN_H,
    );
    retreat.x = BTN_W + 8;
    retreat.y = ROW_Y;
    this.panel!.addChild(attack.container);
    this.panel!.addChild(retreat.container);
    this._attackButton = attack;
    this._retreatButton = retreat;
    this.actionRowWidth = BTN_W * 2 + 8;
    this.applyAttackEnabledVisual();
  }

  private positionPanel(): void {
    if (!this.panel) return;
    const { width, height } = this.deps.getScreenSize();
    const contentWidth = Math.max(this.weaponRowWidth, this.actionRowWidth);
    this.panel.x = Math.max(20, width / 2 - contentWidth / 2);
    this.panel.y = height - 170;
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
    const dashes = 60;
    const step = (Math.PI * 2) / dashes;
    for (let i = 0; i < dashes; i += 2) {
      const a0 = i * step;
      g.moveTo(pos.x + Math.cos(a0) * radius, pos.y + Math.sin(a0) * radius);
      g.arc(pos.x, pos.y, radius, a0, a0 + step);
    }
    g.stroke({ color: SELECTED_COLOR, width: 2, alpha: 0.6 });
  }

  private applyAttackEnabledVisual(): void {
    if (!this._attackButton) return;
    this._attackButton.container.alpha = this.attackEnabled ? 1 : 0.4;
    this._attackButton.container.cursor = this.attackEnabled
      ? "pointer"
      : "default";
  }
}
