import type { Container } from "pixi.js";
import type { CombatModule } from "./CombatModule";
import { CombatPauseController, type PauseReason } from "./combatPause";
import { CombatPauseOverlay } from "./CombatPauseOverlay";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";

/** The flight scene binds the controller/overlay to these concrete handles. */
export type FlightPauseController = CombatPauseController<
  NpcShipSprite,
  WeaponSpec
>;
export type FlightPauseOverlay = CombatPauseOverlay<NpcShipSprite, WeaponSpec>;

/** Just the slice of the flight renderer the pause UI needs (Low Coupling). */
interface PauseUiRenderer {
  uiLayer: Container;
  app: { screen: { width: number; height: number } };
}

/**
 * Wire the active-pause combat UI for the flight scene (Task 3): a pure
 * {@link CombatPauseController} plus its {@link CombatPauseOverlay}, cross-linked
 * so an incoming attack opens the overlay, row clicks update the controller's
 * selection (mirrored into the combat module so the reticle tracks it), and
 * confirm/resume fire one shot / resume time.
 *
 * The scene keeps only the returned controller (it reads `paused` and raises
 * `requestPause`); the overlay is owned entirely by the controller's dep
 * closures and lives on the UI layer, torn down with it on scene exit. Extracted
 * to keep `SpaceFlightScene` a thin Controller (flight-module convention).
 *
 * Called with no args (before the scene has a render context, e.g. at field-init
 * time or in unit tests) it returns a bare, overlay-less controller so the
 * `paused` flag is always defined; the scene rebuilds the wired one in
 * initialize() once the renderer + combat module exist.
 */
export function createCombatPauseUi(
  renderer?: PauseUiRenderer,
  combat?: CombatModule,
  onStopShip?: () => void, // Stop the ship when pause starts (prevent orbit drift)
): FlightPauseController {
  if (!renderer || !combat) return new CombatPauseController();

  // Controller ↔ overlay are mutually referential; this holder lets both be
  // `const` (the overlay is assigned last, after the controller exists).
  const ref: { overlay?: FlightPauseOverlay } = {};

  const controller: FlightPauseController = new CombatPauseController({
    onPause: (reason) => {
      onStopShip?.(); // Stop ship movement immediately (prevent orbit drift during pause)
      if (ref.overlay) openOverlay(ref.overlay, controller, combat, reason);
    },
    onResume: () => ref.overlay?.close(),
    onConfirm: (a) => combat.confirmAttack(a.target, a.weapon),
  });

  const sync = (): void =>
    ref.overlay?.setSelection(
      controller.selectedTarget,
      controller.selectedWeapon,
    );

  ref.overlay = new CombatPauseOverlay(
    renderer.uiLayer,
    { getScreenSize: () => renderer.app.screen },
    {
      onSelectTarget: (s) => {
        controller.selectTarget(s);
        combat.selectTarget(s); // mirror into the reticle + status HUD
        sync();
      },
      onSelectWeapon: (w) => {
        controller.selectWeapon(w);
        sync();
      },
      // Resuming from the overlay (fire OR continue) starts a fresh combat round
      // (Task 9 (v)): the player has taken their between-rounds decision, so the
      // round's spent-damage budget resets and fire re-opens. This is the
      // live-only begin-round seam — the headless agent drives the controller's
      // resume() directly (bypassing these handlers) and begins its rounds
      // explicitly per step, so it never resets the budget mid-step.
      onConfirm: () => {
        combat.beginCombatRound();
        controller.confirm();
      },
      onResume: () => {
        combat.beginCombatRound();
        controller.resume();
      },
    },
  );

  return controller;
}

/**
 * Pre-select the target/weapon for this pause (preserving any selection carried
 * over from before it, else the auto-fire defaults) and open the overlay with
 * the live combatant + fitted-weapon lists.
 */
function openOverlay(
  overlay: FlightPauseOverlay,
  controller: FlightPauseController,
  combat: CombatModule,
  reason: PauseReason,
): void {
  const combatants = [...combat.combatants];
  const weapons = combat.fittedWeapons();
  const carried =
    controller.selectedTarget && combatants.includes(controller.selectedTarget)
      ? controller.selectedTarget
      : null;
  const target = carried ?? combat.selectedTarget ?? combatants[0] ?? null;
  const weapon = controller.selectedWeapon ?? weapons[0] ?? null;
  controller.selectTarget(target);
  controller.selectWeapon(weapon);
  if (target) combat.selectTarget(target);
  overlay.open({
    reason,
    targets: combatants.map((s) => ({
      value: s,
      label: s.npc.name,
      hpFraction: s.npc.maxHull > 0 ? s.npc.hullHP / s.npc.maxHull : 0,
    })),
    weapons: weapons.map((w) => ({
      value: w,
      label: `${w.name} (${w.damage})`,
    })),
    selectedTarget: target,
    selectedWeapon: weapon,
  });
}
