/**
 * Live planning-phase UI for the pause-and-plan combat loop (Task 14.5b of
 * `docs/plans/20260713-tactical-pause-combat-rework.md`).
 *
 * Two pieces, both owned here so `SpaceFlightScene` stays a thin controller under
 * its line-count guard:
 *
 * - **{@link CombatPlanningUi}** — the visible planning surface: the per-weapon
 *   range rings (Task 5 `weaponRangeCircles`/`drawWeaponRangeCircles`, world-space
 *   on the game layer) and the bottom-centre weapon bar (one {@link UiButton} per
 *   fitted gun, tinted to match its ring). It drives the two-step
 *   click-a-weapon-then-click-a-target interaction through Task 5's
 *   {@link WeaponAssignmentController}, writing assignments into the planned-turn
 *   draft. Mounted on `onEnterPlanning`, torn down on confirm/round-start/fight-end.
 * - **{@link createCombatPlanningController}** — the scene's
 *   `CombatPlanningController` factory: binds the concrete `NpcShipSprite`/`WeaponSpec`
 *   handles, wires the planning toasts (through `t()` — the 14.5a hardcoded strings
 *   moved into the i18n dictionaries) and the UI mount/unmount side effects, and
 *   applies the confirmed movement via Task 3's {@link applyPlannedMovement}.
 *
 * Click routing (movement vs. weapon-assign) needs no mode toggle: an NPC sprite
 * click stops propagation and reaches {@link CombatPlanningUi.handleTargetClick}
 * via the scene's `selectCombatTarget` seam, while an empty-space click falls
 * through to the stage handler's `previewCombatCourse` movement branch.
 */

import { Container, Graphics } from "pixi.js";
import { t } from "@/i18n/i18n";
import { COMBAT_ROUND_MS } from "@/config/balance";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { NpcShipSprite } from "../NpcShipSprite";
import { UiButton } from "../ui/UiButton";
import { CombatPlanningController } from "./combatPlanning";
import { applyPlannedMovement, type PathFollower } from "./combatTrajectory";
import {
  WeaponAssignmentController,
  weaponRangeCircles,
  weaponRangeColor,
} from "./combatWeaponTargeting";
import { drawWeaponRangeCircles } from "./combatWeaponRangeOverlay";

/** Weapon-bar button geometry (screen px). */
const BAR_BTN_W = 168;
const BAR_BTN_H = 30;
const BAR_GAP = 8;
/** Bar baseline above the bottom HUD ХОД cluster + toast lane. */
const BAR_BOTTOM_OFFSET = 150;
/** Toast tint for planning-phase feedback (matches the 14.5a planning toasts). */
const PLANNING_TINT = 0x66ccff;
const WARNING_TINT = 0xffcc00;

/** The scene state the planning UI reads (all closures — resolved live). */
export interface CombatPlanningUiDeps {
  getUiLayer(): Container;
  getGameLayer(): Container;
  getScreenSize(): { width: number; height: number };
  getShipPos(): { x: number; y: number } | null;
  /** The player's fitted guns (`CombatModule.fittedWeapons()` — catalog refs). */
  getFittedWeapons(): WeaponSpec[];
  /** Only an engaged combatant is assignable (mirrors `selectTarget`'s guard). */
  isCombatant(sprite: NpcShipSprite): boolean;
  /** The planned-turn draft the assignments land in (also the phase gate). */
  planning: CombatPlanningController<NpcShipSprite, WeaponSpec>;
  showMessage(text: string, color?: number): void;
}

/**
 * The planning-phase surface: per-weapon range rings + the weapon-assignment bar.
 * All mount/unmount is idempotent — `enterPlanning` rebuilds from the live loadout
 * each round, so a mid-fight refit or a killed assignment never leaves stale UI.
 */
export class CombatPlanningUi {
  private readonly deps: CombatPlanningUiDeps;
  private readonly assign: WeaponAssignmentController<
    WeaponSpec,
    NpcShipSprite
  >;
  private bar: Container | null = null;
  private buttons: { weapon: WeaponSpec; button: UiButton }[] = [];
  private rings: Graphics | null = null;

  constructor(deps: CombatPlanningUiDeps) {
    this.deps = deps;
    this.assign = new WeaponAssignmentController(deps.planning);
  }

  /** True while the planning surface is mounted. */
  get isOpen(): boolean {
    return this.bar !== null;
  }

  /** The gun armed by the first click, awaiting a target (null = none). */
  get armedWeapon(): WeaponSpec | null {
    return this.assign.selectedWeapon;
  }

  /** Mount the range rings + weapon bar for a fresh planning round. */
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
    const total = weapons.length * BAR_BTN_W + (weapons.length - 1) * BAR_GAP;
    const x0 = Math.max(0, (screen.width - total) / 2);
    const y = screen.height - BAR_BOTTOM_OFFSET;
    this.buttons = weapons.map((weapon, i) => {
      const button = new UiButton(
        "⌖",
        weapon.name,
        weaponRangeColor(i),
        () => this.armWeapon(weapon),
        BAR_BTN_W,
        BAR_BTN_H,
      );
      button.container.label = `cpw-${i}`;
      button.x = x0 + i * (BAR_BTN_W + BAR_GAP);
      button.y = y;
      bar.addChild(button.container);
      return { weapon, button };
    });
    this.deps.getUiLayer().addChild(bar);
    this.bar = bar;
    this.refreshLabels();
  }

  /** Tear down the planning surface (confirm / round start / fight end). */
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
  }

  /**
   * Second click of the two-step assignment: an NPC sprite clicked during
   * PLANNING. Assigns the armed weapon to it (out-of-range is flagged, not
   * rejected — Task 5's recorded decision) and reports whether the click was
   * consumed; unconsumed clicks fall through to the legacy target-select.
   */
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

  /**
   * First click of the two-step assignment: arm (or toggle off) a gun. Public
   * (the weapon-bar buttons call it) so it unit-tests without PixiJS pointer
   * events — the same convention as `SettingsPanel.selectFont` et al.
   */
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

  /** Reflect armed/assigned state in the bar labels (▶ armed, ✓ assigned). */
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
  }
}

/** The scene members the planning-controller factory reads (all lazy closures). */
export interface CombatPlanningHost {
  /** Structural `ShipPhysics` subset so tests fake it (see `PathFollower`). */
  getShipPhysics(): PathFollower | null;
  /** The planning surface — null until the scene's `initialize()` builds it. */
  getUi(): CombatPlanningUi | null;
  showMessage(text: string, color?: number): void;
  /** Fight over → restore the pre-combat route overlay (or clear the preview). */
  onFightEnd(): void;
}

/**
 * Build the scene's `CombatPlanningController` with the live UI + toast side
 * effects wired (extracted from the `SpaceFlightScene` field initializer for the
 * line guard). The confirmed destination flies via Task 3's
 * {@link applyPlannedMovement}; per-weapon fire reads the confirmed draft through
 * `CombatModuleDeps` (Task 6), not through this factory.
 */
export function createCombatPlanningController(
  host: CombatPlanningHost,
): CombatPlanningController<NpcShipSprite, WeaponSpec> {
  return new CombatPlanningController<NpcShipSprite, WeaponSpec>({
    roundMs: COMBAT_ROUND_MS,
    onEnterPlanning: () => {
      host.getUi()?.enterPlanning();
      host.showMessage(t("combat.planning.enter"), PLANNING_TINT);
    },
    onConfirm: (plan) =>
      applyPlannedMovement(plan.destination, host.getShipPhysics()),
    onEnterExecuting: () => {
      host.getUi()?.exitPlanning();
      host.showMessage(t("combat.planning.executing"), PLANNING_TINT);
    },
    onCombatEnd: () => {
      host.getUi()?.exitPlanning();
      host.onFightEnd();
    },
  });
}
