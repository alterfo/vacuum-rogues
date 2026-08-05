import { test, expect } from '@playwright/test';
import { applyMockHeavySystems } from './fixtures/mockHeavySystems';


type DropZone = {
  x: number;
  y: number;
  w: number;
  h: number;
  target: { kind: 'gear'; slotIndex: number } | { kind: 'hull' };
};
type ChipRect = { id: string; x: number; y: number; w: number; h: number };
type Slot = { gearId: string; micromoduleId?: string };
type StationSceneHandle = {
  e2eOpenHangar: () => void;
  e2eDropZones: () => DropZone[];
  e2eMicromoduleChips: () => ChipRect[];
};
type Loadout = {
  install: (gearId: string) => boolean;
  installedSlots: () => Slot[];
  derivedStats: () => { weaponDamage: number };
};
type GameEngine = {
  player: { credits: number; inventory: { micromodules: unknown[] } };
  playerLoadout: Loadout | null;
  currentScene: StationSceneHandle & { constructor: { name: string } };
  transitionTo: (scene: string, ctx?: object) => Promise<void>;
};

function w(): GameEngine {
  return (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
}

test.describe('Micromodule drag-and-drop fitting', () => {
  test.beforeEach(async ({ page }) => {
    await applyMockHeavySystems(page);
    await page.goto('/');
    await page.waitForFunction(
      () => !!(window as unknown as { __gameEngine?: unknown }).__gameEngine,
      { timeout: 15000 },
    );
    await page.evaluate(async () => {
      await (window as unknown as { __gameEngine: GameEngine }).__gameEngine.transitionTo(
        'SPACE_FLIGHT',
      );
    });
  });

  test('drag a weapon micromodule onto the fitted weapon raises weapon damage', async ({
    page,
  }) => {
    const setup = await page.evaluate(() => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      e.player.credits = 10000;
      e.playerLoadout!.install('wpn_pulse');
      e.player.inventory.micromodules.push({
        id: 'mm_wpn_1',
        name: 'Усилитель урона ур.1',
        targetCategory: 'WEAPON',
        bonusType: 'damage',
        bonusTier: 1,
      });
      return { beforeDamage: e.playerLoadout!.derivedStats().weaponDamage };
    });
    expect(setup.beforeDamage).toBeGreaterThan(0);

    await page.evaluate(async () => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const station = {
        id: 'craft-test',
        name: 'Тестовый центр крафта',
        type: 'CRAFT_CENTER',
        faction: 'OUTLANDERS',
        orbitRadius: 100,
        orbitAngle: 0,
      };
      await e.transitionTo('STATION', { gameEngine: e, station });
    });
    await page.waitForFunction(
      () =>
        (window as unknown as { __gameEngine: GameEngine }).__gameEngine.currentScene
          ?.constructor?.name === 'StationScene',
      { timeout: 8000 },
    );

    const coords = await page.evaluate(() => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const scene = e.currentScene;
      scene.e2eOpenHangar();
      const slots = e.playerLoadout!.installedSlots();
      const weaponIdx = slots.findIndex((s) => s.gearId === 'wpn_pulse');
      const zone = scene
        .e2eDropZones()
        .find((z) => z.target.kind === 'gear' && z.target.slotIndex === weaponIdx);
      const chip = scene.e2eMicromoduleChips().find((c) => c.id === 'mm_wpn_1');
      if (!zone || !chip) return null;
      return {
        chip: { cx: chip.x + chip.w / 2, cy: chip.y + chip.h / 2 },
        slot: { cx: zone.x + zone.w / 2, cy: zone.y + zone.h / 2 },
      };
    });
    expect(coords).not.toBeNull();

    await page.mouse.move(coords!.chip.cx, coords!.chip.cy);
    await page.mouse.down();
    await page.mouse.move(coords!.slot.cx, coords!.slot.cy, { steps: 8 });
    await page.mouse.up();

    const result = await page.evaluate(() => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      return {
        afterDamage: e.playerLoadout!.derivedStats().weaponDamage,
        ownedCount: e.player.inventory.micromodules.length,
        slotMm: e.playerLoadout!
          .installedSlots()
          .find((s) => s.gearId === 'wpn_pulse')?.micromoduleId,
      };
    });
    expect(result.afterDamage).toBeGreaterThan(setup.beforeDamage);
    expect(result.ownedCount).toBe(0);
    expect(result.slotMm).toBe('mm_wpn_1');
  });

  test('dragging a weapon micromodule onto the engine slot is rejected (no stat change)', async ({
    page,
  }) => {
    const before = await page.evaluate(() => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      e.playerLoadout!.install('wpn_pulse');
      e.player.inventory.micromodules.push({
        id: 'mm_wpn_1',
        name: 'Усилитель урона ур.1',
        targetCategory: 'WEAPON',
        bonusType: 'damage',
        bonusTier: 1,
      });
      return e.playerLoadout!.derivedStats().weaponDamage;
    });

    await page.evaluate(async () => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      await e.transitionTo('STATION', {
        gameEngine: e,
        station: {
          id: 'craft-test',
          name: 'Тестовый центр крафта',
          type: 'CRAFT_CENTER',
          faction: 'OUTLANDERS',
          orbitRadius: 100,
          orbitAngle: 0,
        },
      });
    });
    await page.waitForFunction(
      () =>
        (window as unknown as { __gameEngine: GameEngine }).__gameEngine.currentScene
          ?.constructor?.name === 'StationScene',
      { timeout: 8000 },
    );

    const coords = await page.evaluate(() => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      const scene = e.currentScene;
      scene.e2eOpenHangar();
      const slots = e.playerLoadout!.installedSlots();
      const engineIdx = slots.findIndex((s) => s.gearId === 'eq_engine_i');
      const zone = scene
        .e2eDropZones()
        .find((z) => z.target.kind === 'gear' && z.target.slotIndex === engineIdx);
      const chip = scene.e2eMicromoduleChips().find((c) => c.id === 'mm_wpn_1');
      if (!zone || !chip) return null;
      return {
        chip: { cx: chip.x + chip.w / 2, cy: chip.y + chip.h / 2 },
        slot: { cx: zone.x + zone.w / 2, cy: zone.y + zone.h / 2 },
      };
    });
    expect(coords).not.toBeNull();

    await page.mouse.move(coords!.chip.cx, coords!.chip.cy);
    await page.mouse.down();
    await page.mouse.move(coords!.slot.cx, coords!.slot.cy, { steps: 8 });
    await page.mouse.up();

    const result = await page.evaluate(() => {
      const e = (window as unknown as { __gameEngine: GameEngine }).__gameEngine;
      return {
        afterDamage: e.playerLoadout!.derivedStats().weaponDamage,
        ownedCount: e.player.inventory.micromodules.length,
      };
    });
    expect(result.afterDamage).toBe(before);
    expect(result.ownedCount).toBe(1);
  });
});
