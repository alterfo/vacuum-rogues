import { Container, Graphics } from "pixi.js";
import { t } from "@/i18n/i18n";
import { currentFontScale, scaledFont } from "@/utils/fontScale";
import { MONO_CHAR_WIDTH_RATIO } from "@/presentation/ui/questCardLayout";
import { COMBAT_ROUND_MS } from "@/config/balance";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import { consumableById } from "./combatConsumable";
import { COMBAT_COMMS_ACTIONS } from "./combatComms";
import type { NpcShipSprite } from "../NpcShipSprite";
import { UiButton } from "../ui/UiButton";
import { CombatPlanningController, type PlannedTurn } from "./combatPlanning";
import { applyPlannedMovement, type PathFollower } from "./combatTrajectory";
import {
  WeaponAssignmentController,
  weaponRangeCircles,
  weaponRangeColor,
} from "./combatWeaponTargeting";
import { drawWeaponRangeCircles } from "./combatWeaponRangeOverlay";

const BAR_BTN_W = 168;
const BAR_BTN_H = 30;
const BAR_GAP = 8;
const ACTION_BTN_W = 132;

function barButtonSize(): { w: number; h: number } {
  const scale = currentFontScale();
  return { w: Math.round(BAR_BTN_W * scale), h: Math.round(BAR_BTN_H * scale) };
}
function actionButtonWidth(): number {
  return Math.round(ACTION_BTN_W * currentFontScale());
}

const LABEL_X_OFFSET_PX = 32;
const LABEL_RIGHT_PAD_PX = 14;
const MARKER_BUDGET_CHARS = 2;
function fitButtonWidth(baseWidth: number, label: string): number {
  const charPx = scaledFont(14) * MONO_CHAR_WIDTH_RATIO;
  const textPx = (label.length + MARKER_BUDGET_CHARS) * charPx;
  return Math.max(
    baseWidth,
    Math.round(LABEL_X_OFFSET_PX + textPx + LABEL_RIGHT_PAD_PX),
  );
}

function actionLabelText(key: string): string {
  if (key === "afterburner") return t("combat.planning.afterburner");
  const consumable = consumableById(key);
  if (consumable) return t(consumable.nameKey);
  const comms = COMBAT_COMMS_ACTIONS.find((a) => a.id === key);
  return t(comms?.nameKey ?? key);
}
const BAR_BOTTOM_OFFSET = 150;
const PLANNING_TINT = 0x66ccff;
const WARNING_TINT = 0xffcc00;

export interface CombatPlanningUiDeps {
  getUiLayer(): Container;
  getGameLayer(): Container;
  getScreenSize(): { width: number; height: number };
  getShipPos(): { x: number; y: number } | null;
  getFittedWeapons(): WeaponSpec[];
  isCombatant(sprite: NpcShipSprite): boolean;
  planning: CombatPlanningController<NpcShipSprite, WeaponSpec>;
  showMessage(text: string, color?: number): void;
  actions?: {
    getOwnedConsumableIds(): readonly string[];
    canAfterburn(): boolean;
  };
}

export class CombatPlanningUi {
  private readonly deps: CombatPlanningUiDeps;
  private readonly assign: WeaponAssignmentController<
    WeaponSpec,
    NpcShipSprite
  >;
  private bar: Container | null = null;
  private buttons: { weapon: WeaponSpec; button: UiButton }[] = [];
  private buttonWidths: number[] = [];
  private actionsBar: Container | null = null;
  private actionButtons: { key: string; button: UiButton }[] = [];
  private actionWidths: number[] = [];
  private rings: Graphics | null = null;

  constructor(deps: CombatPlanningUiDeps) {
    this.deps = deps;
    this.assign = new WeaponAssignmentController(deps.planning);
  }

  get isOpen(): boolean {
    return this.bar !== null;
  }

  get actionsOpen(): boolean {
    return this.actionsBar !== null;
  }

  get armedWeapon(): WeaponSpec | null {
    return this.assign.selectedWeapon;
  }

  enterPlanning(): void {
    this.exitPlanning();
    const weapons = this.deps.getFittedWeapons();
    const ship = this.deps.getShipPos();
    if (ship) {
      this.rings = new Graphics();
      this.rings.eventMode = "none";
      this.deps.getGameLayer().addChild(this.rings);
      drawWeaponRangeCircles(this.rings, weaponRangeCircles(weapons, ship));
    }
    if (weapons.length === 0) return;
    const bar = new Container();
    bar.label = "combat-planning-bar";
    const screen = this.deps.getScreenSize();
    const { w: baseW, h: btnH } = barButtonSize();
    const widths = weapons.map((w) => fitButtonWidth(baseW, w.name));
    const total =
      widths.reduce((sum, w) => sum + w, 0) + (weapons.length - 1) * BAR_GAP;
    const x0 = Math.max(0, (screen.width - total) / 2);
    const y = screen.height - BAR_BOTTOM_OFFSET;
    let x = x0;
    this.buttons = weapons.map((weapon, i) => {
      const w = widths[i];
      const button = new UiButton(
        "⌖",
        weapon.name,
        weaponRangeColor(i),
        () => this.armWeapon(weapon),
        w,
        btnH,
      );
      button.container.label = `cpw-${i}`;
      button.x = x;
      button.y = y;
      x += w + BAR_GAP;
      bar.addChild(button.container);
      return { weapon, button };
    });
    this.buttonWidths = widths;
    this.deps.getUiLayer().addChild(bar);
    this.bar = bar;
    this.buildActionRow(screen, y - (btnH + BAR_GAP), btnH);
    this.refreshLabels();
  }

  reposition(width: number, height: number): void {
    if (this.bar) {
      const { h: btnH } = barButtonSize();
      const y = height - BAR_BOTTOM_OFFSET;
      const total =
        this.buttonWidths.reduce((sum, w) => sum + w, 0) +
        (this.buttonWidths.length - 1) * BAR_GAP;
      let x = Math.max(0, (width - total) / 2);
      this.buttons.forEach(({ button }, i) => {
        button.x = x;
        button.y = y;
        x += this.buttonWidths[i] + BAR_GAP;
      });
      if (this.actionsBar) {
        const totalA =
          this.actionWidths.reduce((sum, w) => sum + w, 0) +
          (this.actionWidths.length - 1) * BAR_GAP;
        let xa = Math.max(0, (width - totalA) / 2);
        const yA = y - (btnH + BAR_GAP);
        this.actionButtons.forEach(({ button }, i) => {
          button.x = xa;
          button.y = yA;
          xa += this.actionWidths[i] + BAR_GAP;
        });
      }
    }
  }

  private buildActionRow(
    screen: { width: number; height: number },
    y: number,
    btnH: number,
  ): void {
    const actions = this.deps.actions;
    if (!actions) return;
    const keys: string[] = [
      "afterburner",
      ...new Set(actions.getOwnedConsumableIds()),
      ...COMBAT_COMMS_ACTIONS.map((a) => a.id),
    ];
    const row = new Container();
    row.label = "combat-planning-actions";
    const baseW = actionButtonWidth();
    const widths = keys.map((key) =>
      fitButtonWidth(baseW, actionLabelText(key)),
    );
    const total =
      widths.reduce((sum, w) => sum + w, 0) + (keys.length - 1) * BAR_GAP;
    const x0 = Math.max(0, (screen.width - total) / 2);
    let x = x0;
    this.actionButtons = keys.map((key, i) => {
      const w = widths[i];
      const button = new UiButton(
        "▣",
        actionLabelText(key),
        0x88ccff,
        () => this.toggleAction(key),
        w,
        btnH,
      );
      button.container.label = `cpa-${key}`;
      button.x = x;
      button.y = y;
      x += w + BAR_GAP;
      row.addChild(button.container);
      return { key, button };
    });
    this.actionWidths = widths;
    this.deps.getUiLayer().addChild(row);
    this.actionsBar = row;
  }

  toggleAction(key: string): void {
    const plan = this.deps.planning.plan;
    if (key === "afterburner") {
      this.deps.planning.setAfterburner(!plan.afterburner);
    } else if (consumableById(key)) {
      this.deps.planning.setConsumable(plan.consumableId === key ? null : key);
    } else {
      this.deps.planning.setComms(plan.commsAction === key ? null : key);
    }
    this.refreshLabels();
  }

  exitPlanning(): void {
    this.assign.clearSelection();
    if (this.rings) {
      this.rings.parent?.removeChild(this.rings);
      this.rings.destroy();
      this.rings = null;
    }
    if (this.bar) {
      this.bar.parent?.removeChild(this.bar);
      this.bar.destroy({ children: true });
      this.bar = null;
    }
    this.buttons = [];
    this.buttonWidths = [];
    if (this.actionsBar) {
      this.actionsBar.parent?.removeChild(this.actionsBar);
      this.actionsBar.destroy({ children: true });
      this.actionsBar = null;
    }
    this.actionButtons = [];
    this.actionWidths = [];
  }

  handleTargetClick(sprite: NpcShipSprite): boolean {
    if (!this.isOpen || !this.assign.selectedWeapon) return false;
    if (!this.deps.isCombatant(sprite)) return false;
    const ship = this.deps.getShipPos();
    if (!ship) return false;
    const result = this.assign.selectTarget(sprite, ship, {
      x: sprite.x,
      y: sprite.y,
    });
    if (!result) return false;
    const params = { weapon: result.weapon.name, target: sprite.npc.name };
    if (result.inRange) {
      this.deps.showMessage(t("combat.planning.assigned", params), PLANNING_TINT); // prettier-ignore
    } else {
      this.deps.showMessage(t("combat.planning.assignedFar", params), WARNING_TINT); // prettier-ignore
    }
    this.refreshLabels();
    return true;
  }

  destroy(): void {
    this.exitPlanning();
  }

  armWeapon(weapon: WeaponSpec): void {
    const armed = this.assign.selectWeapon(weapon);
    if (armed) {
      this.deps.showMessage(
        t("combat.planning.armWeapon", { name: armed.name }),
        PLANNING_TINT,
      );
    }
    this.refreshLabels();
  }

  private refreshLabels(): void {
    const targets = this.deps.planning.plan.weaponTargets;
    for (const { weapon, button } of this.buttons) {
      const marker =
        this.assign.selectedWeapon === weapon
          ? "▶ "
          : targets.has(weapon)
            ? "✓ "
            : "";
      button.setLabel(`${marker}${weapon.name}`);
    }
    const plan = this.deps.planning.plan;
    for (const { key, button } of this.actionButtons) {
      if (key === "afterburner") {
        const spent = this.deps.actions?.canAfterburn() === false;
        const marker = plan.afterburner ? "✓ " : spent ? "⛔ " : "";
        button.setLabel(`${marker}${actionLabelText(key)}`);
        continue;
      }
      const marker =
        plan.consumableId === key || plan.commsAction === key ? "✓ " : "";
      button.setLabel(`${marker}${actionLabelText(key)}`);
    }
  }
}

export interface CombatPlanningHost {
  getShipPhysics(): PathFollower | null;
  getUi(): CombatPlanningUi | null;
  showMessage(text: string, color?: number): void;
  setMiniLogVisible?(visible: boolean): void;
  onFightEnd(): void;
  onConfirmPlan?(plan: PlannedTurn<NpcShipSprite, WeaponSpec>): void;
  breakOffPursuit?(): void;
  isAutoCombat?(): boolean;
}

export function createCombatPlanningController(
  host: CombatPlanningHost,
): CombatPlanningController<NpcShipSprite, WeaponSpec> {
  return new CombatPlanningController<NpcShipSprite, WeaponSpec>({
    roundMs: COMBAT_ROUND_MS,
    isTargetValid: (target) => !target.container?.destroyed,
    onEnterPlanning: () => {
      if (host.isAutoCombat?.()) return;
      host.getUi()?.enterPlanning();
      host.setMiniLogVisible?.(false);
      host.showMessage(t("combat.planning.enter"), PLANNING_TINT);
    },
    onConfirm: (plan) => {
      if (applyPlannedMovement(plan.destination, host.getShipPhysics()))
        host.breakOffPursuit?.(); // planned course overrides the orbit-strafe
      host.onConfirmPlan?.(plan);
    },
    onEnterExecuting: () => {
      host.getUi()?.exitPlanning();
      host.setMiniLogVisible?.(true);
      if (host.isAutoCombat?.()) return;
      host.showMessage(t("combat.planning.executing"), PLANNING_TINT);
    },
    onCombatEnd: () => {
      host.getUi()?.exitPlanning();
      host.setMiniLogVisible?.(true);
      host.onFightEnd();
    },
  });
}
