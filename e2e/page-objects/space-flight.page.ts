import { type Page, expect } from '@playwright/test';
import { GamePageBase } from './base.page';

export class SpaceFlightPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  async navigateFromMainMenu() {
    await this.page.goto('/');
    await this.waitForGameInitialization();
    
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string) => Promise<void>;
      };
      await engine.transitionTo('SPACE_FLIGHT');
    });
    await this.waitForSpaceFlight();
  }

  async waitForSpaceFlight() {
    await this.page.waitForFunction(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine.currentScene?.constructor.name === 'SpaceFlightScene';
    }, { timeout: 5000 });
  }

  async expectSpaceFlightVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }

  async setShipTarget(x: number, y: number) {
    await this.page.evaluate((target) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetTarget?: (x: number, y: number) => void } | null;
      };
      engine.currentScene?.e2eSetTarget?.(target.x, target.y);
    }, { x, y });
  }

  async clickToMoveShip(x: number, y: number) {
    await this.setShipTarget(x, y);
  }

  async clickBackToMap() {
    await this.page.evaluate(async () => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eClickBackToMap?: () => Promise<void> } | null;
      };
      await engine.currentScene?.e2eClickBackToMap?.();
    });
  }

  async expectParallaxStars() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();

    const box = await this.getCanvasBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  }

  async expectShipVisible() {
    const canvas = this.page.locator('canvas');
    await expect(canvas).toBeVisible();
  }

  async getCameraState() {
    return await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eGetCameraState?: () => { zoom: number; panX: number; panY: number };
        } | null;
      };
      return engine.currentScene?.e2eGetCameraState?.() ?? { zoom: 1, panX: 0, panY: 0 };
    });
  }

  async setCameraZoom(zoom: number) {
    await this.page.evaluate((z) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetCameraZoom?: (zoom: number) => void } | null;
      };
      engine.currentScene?.e2eSetCameraZoom?.(z);
    }, zoom);
  }

  async setCameraPan(x: number, y: number) {
    await this.page.evaluate((pan) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetCameraPan?: (x: number, y: number) => void } | null;
      };
      engine.currentScene?.e2eSetCameraPan?.(pan.x, pan.y);
    }, { x, y });
  }

  async wheelZoom(deltaY: number) {
    const canvas = this.page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.wheel(0, deltaY);
    await this.page.waitForTimeout(100); // Allow zoom to apply
  }

  async panCamera(startX: number, startY: number, endX: number, endY: number, useShift = true) {
    const canvas = this.page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const absStartX = box.x + startX;
    const absStartY = box.y + startY;
    const absEndX = box.x + endX;
    const absEndY = box.y + endY;

    if (useShift) {
      await this.page.keyboard.down('Shift');
      await this.page.mouse.move(absStartX, absStartY);
      await this.page.mouse.down({ button: 'left' });
      await this.page.mouse.move(absEndX, absEndY);
      await this.page.mouse.up({ button: 'left' });
      await this.page.keyboard.up('Shift');
    } else {
      await this.page.mouse.move(absStartX, absStartY);
      await this.page.mouse.down({ button: 'right' });
      await this.page.mouse.move(absEndX, absEndY);
      await this.page.mouse.up({ button: 'right' });
    }

    await this.page.waitForTimeout(100); // Allow pan to apply
  }

  async expectMinimapVisible() {
    const hasМinimap = await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eHasMinimap?: () => boolean;
        } | null;
      };
      return engine.currentScene?.e2eHasMinimap?.() ?? false;
    });
    expect(hasМinimap).toBe(true);
  }

  async getShipPosition() {
    return await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eGetShipPosition?: () => { x: number; y: number };
        } | null;
      };
      return engine.currentScene?.e2eGetShipPosition?.() ?? { x: 0, y: 0 };
    });
  }

  async openQuestJournal() {
    await this.page.keyboard.press('j');
    await this.page.waitForTimeout(200);
  }

  async expectQuestJournalOpen() {
    const isOpen = await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eIsQuestJournalOpen?: () => boolean;
        } | null;
      };
      return engine.currentScene?.e2eIsQuestJournalOpen?.() ?? false;
    });
    expect(isOpen).toBe(true);
  }


  async waitForScene() {
    await this.waitForSpaceFlight();
  }

  async getSceneState() {
    return await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eGetSceneState?: () => {
            planetsCount: number;
            npcsCount: number;
            isFlying: boolean;
            turnNumber: number;
          };
        } | null;
      };
      return (
        engine.currentScene?.e2eGetSceneState?.() ?? {
          planetsCount: 0,
          npcsCount: 0,
          isFlying: false,
          turnNumber: 0,
        }
      );
    });
  }

  async setBackgroundVisible(visible: boolean) {
    await this.page.evaluate((v) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eSetBackgroundVisible?: (visible: boolean) => void } | null;
      };
      engine.currentScene?.e2eSetBackgroundVisible?.(v);
    }, visible);
  }

  async clickPlanet(index: number) {
    await this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eClickPlanet?: (index: number) => void } | null;
      };
      engine.currentScene?.e2eClickPlanet?.(i);
    }, index);
  }

  async clickNpc(index: number) {
    await this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eClickNpc?: (index: number) => void } | null;
      };
      engine.currentScene?.e2eClickNpc?.(i);
    }, index);
  }

  async startTurn() {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2eStartTurn?: () => void } | null;
      };
      engine.currentScene?.e2eStartTurn?.();
    });
  }

  async pressPause() {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { e2ePressPause?: () => void } | null;
      };
      engine.currentScene?.e2ePressPause?.();
    });
  }

  async screenshot(name: string) {
    const canvas = this.page.locator('canvas');
    await canvas.screenshot({ path: `e2e/screenshots/${name}.png` });
  }


  async hasPlannedRoute(): Promise<boolean> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      return engine.currentScene?.['plannedRoute'] != null;
    });
  }

  async getPlanetCursor(index: number): Promise<string> {
    return this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const pm = engine.currentScene?.['planetManager'] as
        | { planetSprites?: { graphics?: { cursor?: string } }[] }
        | undefined;
      return pm?.planetSprites?.[i]?.graphics?.cursor ?? '';
    }, index);
  }

  async getNpcCursor(index: number): Promise<string> {
    return this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const nm = engine.currentScene?.['npcManager'] as
        | { npcSprites?: { container?: { cursor?: string } }[] }
        | undefined;
      return nm?.npcSprites?.[i]?.container?.cursor ?? '';
    }, index);
  }

  async isNpcClickable(index: number): Promise<boolean> {
    return this.page.evaluate((i) => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const nm = engine.currentScene?.['npcManager'] as
        | { npcSprites?: { container?: { eventMode?: string } }[] }
        | undefined;
      return nm?.npcSprites?.[i]?.container?.eventMode === 'static';
    }, index);
  }

  async isContactPanelOpen(): Promise<boolean> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const nm = engine.currentScene?.['npcManager'] as
        | { hasOpenModal?: () => boolean }
        | undefined;
      return nm?.hasOpenModal?.() ?? false;
    });
  }

  async freezeWorld(): Promise<void> {
    await this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as
        | (Record<string, unknown> & { animationFrameId?: number })
        | undefined;
      const id = engine?.['animationFrameId'] as number | undefined;
      if (typeof id === 'number') cancelAnimationFrame(id);
    });
    await this.settle();
  }

  async settle(frames = 4): Promise<void> {
    await this.page.evaluate(
      (n) =>
        new Promise<void>((resolve) => {
          let i = 0;
          const tick = () => (i++ < n ? requestAnimationFrame(tick) : resolve());
          requestAnimationFrame(tick);
        }),
      frames,
    );
  }

  async getDeferredPause(): Promise<{ turnRunning: boolean; pauseDeferred: boolean }> {
    return this.page.evaluate(() => {
      const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
        currentScene: { isTurnRunning?: boolean; pauseAtDayBoundary?: boolean } | null;
      };
      const s = engine.currentScene;
      return {
        turnRunning: s?.isTurnRunning === true,
        pauseDeferred: s?.pauseAtDayBoundary === true,
      };
    });
  }

  async waitForTurnEnd(timeout = 4_000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const engine = (window as unknown as Record<string, unknown>).__gameEngine as {
          currentScene: { isTurnRunning?: boolean } | null;
        };
        return engine.currentScene?.isTurnRunning === false;
      },
      undefined,
      { timeout },
    );
  }
}
