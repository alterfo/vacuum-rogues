import { test, expect, type Page } from '@playwright/test';
import { waitForEngine, waitForScene } from './fixtures/mockHeavySystems';


const SHOT_DIR = 'e2e/screenshots/exploration';

async function settle(page: Page, frames = 6): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const tick = () => (i++ < n ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.locator('canvas').first().screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

test.describe('Sun band artifact exploration (F4)', () => {
  test.setTimeout(120_000);

  test('isolate the band source layer by layer', async ({ page }) => {
    await page.addInitScript(() => {
      (window as Record<string, unknown>).__mockONNX = true;
      (window as Record<string, unknown>).__skipAudio = true;
      (window as Record<string, unknown>).__fastAnimations = true;
    });

    await page.goto('/');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (scene: string, ctx?: object) => Promise<void>;
      };
      await engine.transitionTo('RACE_SELECTION', { gameEngine: engine });
    });
    await waitForScene(page, 'RaceSelectionScene');
    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: {
          e2eSelectFaction?: (f: string) => void;
          e2eConfirmSelection?: () => void;
        } | null;
      };
      engine.currentScene?.e2eSelectFaction?.('OUTLANDERS');
      engine.currentScene?.e2eConfirmSelection?.();
    });
    await waitForScene(page, 'SpaceFlightScene', 30_000);

    await page.waitForFunction(
      () => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: Record<string, unknown> | null;
        };
        const sr = engine.currentScene?.['starRenderer'] as Record<string, unknown> | undefined;
        return Boolean(sr && (sr['sunSphere'] || sr['starTiling']));
      },
      undefined,
      { timeout: 30_000 },
    );

    const diag = await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const scene = engine.currentScene as Record<string, unknown>;
      const sr = scene['starRenderer'] as Record<string, unknown>;
      const sphere = sr['sunSphere'] as {
        mesh: { texture: { width: number; height: number; source: { label?: string } } };
      } | null;
      const tiling = sr['starTiling'] as {
        texture: { source: { label?: string } };
      } | null;
      const tex = sphere?.mesh.texture ?? null;
      return {
        path: sphere ? 'sphere-mesh' : tiling ? 'tiling-fallback' : 'procedural',
        textureLabel:
          tex?.source.label ?? tiling?.texture.source.label ?? 'n/a',
        textureSize: tex ? `${tex.width}x${tex.height}` : 'n/a',
        starX: (sr['centerX'] as number) ?? 0,
        starY: (sr['centerY'] as number) ?? 0,
      };
    });
     
    console.log('SUN_DIAG', JSON.stringify(diag));
    expect(diag.path).not.toBe('procedural');

    await page.evaluate(
      ({ wx, wy }) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: {
            e2eSetCameraZoom?: (z: number) => void;
            e2eSetCameraPan?: (x: number, y: number) => void;
            e2eGetCameraState?: () => { zoom: number };
          } | null;
        };
        const scene = engine.currentScene;
        if (!scene) return;
        scene.e2eSetCameraZoom?.(2);
        const z = scene.e2eGetCameraState?.().zoom ?? 2;
        scene.e2eSetCameraPan?.(
          window.innerWidth / 2 - wx * z,
          window.innerHeight / 2 - wy * z,
        );
      },
      { wx: diag.starX, wy: diag.starY },
    );

    await shot(page, 'sun-band-00-full');

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const sr = (engine.currentScene as Record<string, unknown>)['starRenderer'] as Record<
        string,
        unknown
      >;
      const halo = sr['starHaloContainer'] as { visible: boolean } | null;
      if (halo) halo.visible = false;
    });
    await shot(page, 'sun-band-01-no-halo');

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const sr = (engine.currentScene as Record<string, unknown>)['starRenderer'] as Record<
        string,
        unknown
      >;
      const surface = sr['starSurface'] as {
        mask: { visible: boolean } | null;
      } | null;
      if (surface?.mask) {
        const m = surface.mask;
        surface.mask = null;
        m.visible = false;
      }
    });
    await shot(page, 'sun-band-02-no-limbmask');

    await page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: Record<string, unknown> | null;
      };
      const sr = (engine.currentScene as Record<string, unknown>)['starRenderer'] as Record<
        string,
        unknown
      >;
      const sphere = sr['sunSphere'] as {
        mesh: {
          texture: { source: { style: { addressMode: string; update?: () => void } } };
        };
      } | null;
      if (sphere) {
        sphere.mesh.texture.source.style.addressMode = 'clamp-to-edge';
        sphere.mesh.texture.source.style.update?.();
      }
    });
    await shot(page, 'sun-band-03-clamp');
  });
});
