import type { Container } from "pixi.js";
import type { CombatModule } from "./CombatModule";
import { CombatPauseController, type PauseReason } from "./combatPause";
import { CombatPauseOverlay } from "./CombatPauseOverlay";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";

export type FlightPauseController = CombatPauseController<
  NpcShipSprite,
  WeaponSpec
>;
export type FlightPauseOverlay = CombatPauseOverlay<NpcShipSprite, WeaponSpec>;

interface PauseUiRenderer {
  uiLayer: Container;
  app: { screen: { width: number; height: number } };
}

export function createCombatPauseUi(
  renderer?: PauseUiRenderer,
  combat?: CombatModule,
  onStopShip?: () => void, // Stop the ship when pause starts (prevent orbit drift)
): FlightPauseController {
  if (!renderer || !combat) return new CombatPauseController();

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
