import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/presentation/PlanetSprite", async () => {
  const { Container: PixiContainer, Graphics } = await import("pixi.js");
  return {
    PlanetSprite: class {
      container = new PixiContainer();
      graphics = new Graphics();
      createHitArea(): void {}
      setTooltipHandlers(): void {}
      setOrbitForDay(): void {}
      update(): void {}
      destroy(): void {}
    },
  };
});
vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: class {
    container = { addChild: (): void => {} };
    destroy(): void {}
  },
}));

import { Container } from "pixi.js";
import type { Renderer } from "@/presentation/Renderer";
import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import { AUTO_COMBAT_ENABLED_KEY } from "@/systems/settings/gameSettings";
import type { CombatPlanningController } from "@/presentation/flight/combatPlanning";
import type { CombatAutoToggle } from "@/presentation/flight/combatAutoToggle";
import type { WeaponSpec } from "@/systems/equipment/GearCatalog";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";

function makeRenderer(): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer: new Container(),
  } as unknown as Renderer;
}

const weapon = (id: string): WeaponSpec => ({ id }) as unknown as WeaponSpec;
const npc = (id: string, x: number, y: number): NpcShipSprite =>
  ({ id, x, y }) as unknown as NpcShipSprite;

function buildScene(opts: {
  combatants: NpcShipSprite[];
  weapons: WeaponSpec[];
  selectedTarget?: NpcShipSprite;
}) {
  const scene = new SpaceFlightScene(makeRenderer());
  const s = scene as unknown as Record<string, unknown>;
  s.hud = { showMessage: vi.fn(), setMiniLogVisible: vi.fn() };
  s.shipPhysics = { shipX: 0, shipY: 0 };
  s.combatModule = {
    isActive: true,
    fittedWeapons: () => opts.weapons,
    combatants: new Set(opts.combatants),
    selectedTarget: opts.selectedTarget ?? null,
  };
  const planning = s.combatPlanning as CombatPlanningController<
    NpcShipSprite,
    WeaponSpec
  >;
  const toggle = s.autoCombatToggle as CombatAutoToggle;
  const tick = () =>
    (
      scene as unknown as { maybeAutoConfirmCombat(): void }
    ).maybeAutoConfirmCombat();
  const showMessage = (s.hud as { showMessage: ReturnType<typeof vi.fn> })
    .showMessage;
  return { s, planning, toggle, tick, showMessage };
}

afterEach(() => {
  localStorage.removeItem(AUTO_COMBAT_ENABLED_KEY);
});

describe("auto-combat mode wiring", () => {
  it("auto-assigns all weapons to the nearest hostile and confirms the turn without planning UI spam", () => {
    localStorage.setItem(AUTO_COMBAT_ENABLED_KEY, "true");
    const w1 = weapon("w1");
    const w2 = weapon("w2");
    const near = npc("near", 30, 0);
    const far = npc("far", 700, 0);
    const { planning, tick, showMessage } = buildScene({
      combatants: [far, near],
      weapons: [w1, w2],
    });

    planning.beginCombat();
    expect(showMessage).not.toHaveBeenCalled();
    const plan = planning.plan;

    tick();

    expect(planning.isExecuting).toBe(true);
    expect(plan.weaponTargets.get(w1)).toBe(near);
    expect(plan.weaponTargets.get(w2)).toBe(near);
    expect(showMessage).not.toHaveBeenCalled();
  });

  it("leaves manual planning untouched when the mode is off", () => {
    const { planning, tick, showMessage } = buildScene({
      combatants: [npc("a", 10, 0)],
      weapons: [weapon("w1")],
    });

    planning.beginCombat();
    expect(showMessage).toHaveBeenCalled();

    tick();

    expect(planning.isPlanning).toBe(true);
    expect(planning.plan.weaponTargets.size).toBe(0);
  });

  it("mounts the toggle button while a fight is active and unmounts it after", () => {
    const { s, toggle, tick } = buildScene({
      combatants: [npc("a", 10, 0)],
      weapons: [weapon("w1")],
    });

    tick();
    expect(toggle.mounted).toBe(true);

    (s.combatModule as { isActive: boolean }).isActive = false;
    tick();
    expect(toggle.mounted).toBe(false);
  });

  it("keeps every gun on the player's selected ship, not the nearest one", () => {
    localStorage.setItem(AUTO_COMBAT_ENABLED_KEY, "true");
    const w1 = weapon("w1");
    const near = npc("near", 30, 0);
    const chosen = npc("chosen", 700, 0);
    const { planning, tick } = buildScene({
      combatants: [near, chosen],
      weapons: [w1],
      selectedTarget: chosen,
    });

    planning.beginCombat();
    const plan = planning.plan;
    tick();

    expect(plan.weaponTargets.get(w1)).toBe(chosen);
  });

  it("routes empty-space clicks past the running-turn guard only in auto-combat (source wiring)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/presentation/SpaceFlightScene.ts", "utf-8");
    expect(src).toMatch(/combatRouteClickAllowed\(\{/);
    expect(src).toMatch(
      /autoConfirmCombatTurn\([\s\S]*?this\.combatModule\.selectedTarget,\s*\)/,
    );
  });

  it("keeps auto-confirming each subsequent round that reopens planning", () => {
    localStorage.setItem(AUTO_COMBAT_ENABLED_KEY, "true");
    const { planning, tick } = buildScene({
      combatants: [npc("a", 10, 0)],
      weapons: [weapon("w1")],
    });

    planning.beginCombat();
    tick();
    expect(planning.isExecuting).toBe(true);

    planning.tickExecute(999999);
    expect(planning.isPlanning).toBe(true);

    tick();
    expect(planning.isExecuting).toBe(true);
  });
});
