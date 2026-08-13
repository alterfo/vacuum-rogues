import { GameEngine } from './systems/GameEngine';
import { DIContainer } from './core/DIContainer';
import { SaveManagerAdapter, ExceptionHandlerAdapter, QuestManagerAdapter } from './core/adapters';
import { GalaxyService, PlayerService } from './core/services';
import { AdaptiveQualityProfile } from './ai/AdaptiveQualityProfile';
import { OverlayPresenter } from './presentation/OverlayPresenter';
import { logger } from './utils/logger';
import { GameConfig } from './config/balance';
import { gatherDiagnostics } from './systems/feedback/gatherDiagnostics';
import { openFeedback } from './systems/feedback/openFeedback';
import { shouldShowMobileGate, markDismissed } from './systems/device/mobileGateState';
import { attachDevAutopilot } from './dev/devAutopilot';

declare const __DEBUG__: boolean;

async function registerServiceWorker(): Promise<void> {
  if (import.meta.env.DEV) {
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

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              logger.info('Доступно обновление. Перезагрузите страницу для применения.');
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

function initializeDIContainer(): DIContainer {
  const container = DIContainer.getInstance();

  container.register('ISaveService', new SaveManagerAdapter());
  container.register('IGalaxyService', new GalaxyService());
  container.register('IPlayerService', new PlayerService());
  container.register('IExceptionHandler', new ExceptionHandlerAdapter());
  container.register('IQuestService', new QuestManagerAdapter());

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

function hideBootLoader(): void {
  const el = document.getElementById('boot-loader');
  if (!el) return;
  el.classList.add('hidden');
  window.setTimeout(() => el.remove(), 500);
}

function failBootLoader(): void {
  const el = document.getElementById('boot-loader');
  if (!el) return;
  el.classList.add('error');
  const text = el.querySelector('.bl-text');
  if (text) text.textContent = 'Не удалось загрузить игру. Обновите страницу.';
}

function wireIssueButton(engine: GameEngine): void {
  const btn = document.getElementById('vr-issue-btn');
  if (!btn) return;
  btn.addEventListener('click', () => openFeedback(gatherDiagnostics(engine)));
  btn.classList.add('ready');
}

function maybeShowMobileGate(): void {
  if (!shouldShowMobileGate()) return;
  const gate = document.getElementById('mobile-gate');
  if (!gate) return;
  gate.classList.add('show');
  const dismiss = (): void => {
    gate.classList.add('hidden');
    window.setTimeout(() => gate.classList.remove('show'), 350);
    markDismissed();
  };
  document
    .getElementById('mobile-gate-continue')
    ?.addEventListener('click', dismiss, { once: true });
}

async function main(): Promise<void> {
  checkDomainLock();
  maybeShowMobileGate();

  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => history.pushState(null, '', location.href));

  await registerServiceWorker();

  try {
    const qualityProfile = new AdaptiveQualityProfile();
    const container = initializeDIContainer();

    let engineForRenderer: GameEngine | null = null;
    const overlayPresenter = new OverlayPresenter(
      () => engineForRenderer?.renderer ?? null,
    );

    const engine = new GameEngine({
      saveService: container.resolve('ISaveService'),
      galaxyService: container.resolve('IGalaxyService'),
      playerService: container.resolve('IPlayerService'),
      exceptionHandler: container.resolve('IExceptionHandler'),
      qualityProfile,
      questService: container.resolve('IQuestService'),
      overlayPresenter,
    });
    engineForRenderer = engine;

    await engine.initialize({
      seed: 'NEURAL_ONSLAUGHT',
      systemCount: 30,
      overmindSpeed: 1.0,
    });
    logger.info('Вакуумные Пройдохи initialized');
    hideBootLoader();
    wireIssueButton(engine);

    if (typeof __DEBUG__ !== 'undefined' && __DEBUG__) {
      (window as unknown as Record<string, GameEngine>).__gameEngine = engine;
    }

    if (import.meta.env.DEV) {
      attachDevAutopilot(
        import.meta.env.DEV,
        engine,
        () => import('./tests/playtest/letsplay/installAutopilotHook'),
        (err) => logger.warn('Dev autopilot hook unavailable:', err),
      );
      import('./dev/EconomyAdminPanel')
        .then((mod) => mod.installEconomyAdminPanel(engine))
        .catch((err) => logger.warn('Dev economy admin panel unavailable:', err));
    }
  } catch (error) {
    logger.error('Failed to initialize game:', error);
    failBootLoader();
  }
}

main();
