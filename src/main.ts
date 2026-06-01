import { GameEngine } from './systems/GameEngine';
import { DIContainer } from './core/DIContainer';
import { SaveManagerAdapter, ONNXAdapter, ExceptionHandlerAdapter, QuestManagerAdapter, EquipmentSystemAdapter } from './core/adapters';
import { GalaxyService, PlayerService } from './core/services';
import { AdaptiveQualityProfile } from './ai/AdaptiveQualityProfile';
import { logger } from './utils/logger';

declare const __DEBUG__: boolean;

async function registerServiceWorker(): Promise<void> {
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
                new Notification('Космические рейнджеры', {
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

async function main(): Promise<void> {
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
    logger.info('Space Rangers: Neural Onslaught initialized');

    // Expose engine to window for E2E testing (dev/test mode only)
    if (typeof __DEBUG__ !== 'undefined' && __DEBUG__) {
      (window as unknown as Record<string, GameEngine>).__gameEngine = engine;
    }
  } catch (error) {
    logger.error('Failed to initialize game:', error);
  }
}

main();
