import { GameEngine } from './systems/GameEngine';
import { DIContainer } from './core/DIContainer';
import { SaveManagerAdapter, ONNXAdapter, ExceptionHandlerAdapter, QuestManagerAdapter, EquipmentSystemAdapter } from './core/adapters';
import { GalaxyService, PlayerService } from './core/services';
import { AdaptiveQualityProfile } from './ai/AdaptiveQualityProfile';
import { logger } from './utils/logger';
import { GameConfig } from './config/balance';

declare const __DEBUG__: boolean;

async function registerServiceWorker(): Promise<void> {
  // Never register the SW in development: it caches the dev modules and then
  // serves stale code, so source edits silently don't take effect until the
  // cache is manually cleared. Only register for production builds.
  if (import.meta.env.DEV) {
    // A SW left over from a previous production/preview build can keep serving
    // stale modules even though we no longer register one in dev — which makes
    // source fixes silently "not work". Actively tear down any existing SW and
    // its caches on dev boot so what you see is always the current code.
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length > 0) {
          await Promise.all(regs.map((r) => r.unregister()));
          logger.warn(
            `Unregistered ${regs.length} stale Service Worker(s) in dev — reload once to drop the old cache.`,
          );
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (error) {
      logger.warn('Dev Service Worker cleanup failed:', error);
    }
    logger.info('Service Worker disabled in dev (avoids caching stale modules)');
    return;
  }
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.ts', {
        type: 'module',
        scope: '/',
      });
      logger.info(`Service Worker registered: ${registration.scope}`);

      // Listen for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content available
              logger.info('Доступно обновление. Перезагрузите страницу для применения.');
              // Show non-blocking notification to user
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Вакуумные Пройдохи', {
                  body: 'Доступно обновление. Перезагрузите страницу для применения.',
                });
              }
            }
          });
        }
      });
    } catch (error) {
      logger.warn('Service Worker registration failed:', error);
    }
  }
}

function initializeDIContainer(qualityProfile: AdaptiveQualityProfile): DIContainer {
  const container = DIContainer.getInstance();

  container.register('ISaveService', new SaveManagerAdapter());
  container.register('IGalaxyService', new GalaxyService());
  container.register('IPlayerService', new PlayerService());
  container.register('IOnnxService', new ONNXAdapter(qualityProfile));
  container.register('IExceptionHandler', new ExceptionHandlerAdapter());
  container.register('IQuestService', new QuestManagerAdapter());
  container.register('IEquipmentService', new EquipmentSystemAdapter());

  return container;
}

function checkDomainLock(): void {
  if (import.meta.env.DEV) return;
  const host = location.hostname;
  const allowed = GameConfig.ALLOWED_ORIGINS.some((origin) => host === origin || host.endsWith(`.${origin}`));
  if (!allowed) {
    document.body.innerHTML = `<div style="color:#f00;font-size:2rem;text-align:center;margin-top:20vh">Запуск на данном домене запрещён.</div>`;
    throw new Error(`Domain lock: "${host}" not in ALLOWED_ORIGINS`);
  }
}

async function main(): Promise<void> {
  checkDomainLock();

  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => history.pushState(null, '', location.href));

  await registerServiceWorker();

  try {
    const qualityProfile = new AdaptiveQualityProfile();
    const container = initializeDIContainer(qualityProfile);

    const engine = new GameEngine({
      saveService: container.resolve('ISaveService'),
      galaxyService: container.resolve('IGalaxyService'),
      playerService: container.resolve('IPlayerService'),
      onnxService: container.resolve('IOnnxService'),
      exceptionHandler: container.resolve('IExceptionHandler'),
      qualityProfile,
      questService: container.resolve('IQuestService'),
      equipmentService: container.resolve('IEquipmentService'),
    });

    await engine.initialize({
      seed: 'NEURAL_ONSLAUGHT',
      systemCount: 30,
      overmindSpeed: 1.0,
    });
    logger.info('Вакуумные Пройдохи initialized');

    // Expose engine to window for E2E testing (dev/test mode only)
    if (typeof __DEBUG__ !== 'undefined' && __DEBUG__) {
      (window as unknown as Record<string, GameEngine>).__gameEngine = engine;
    }
  } catch (error) {
    logger.error('Failed to initialize game:', error);
  }
}

main();
