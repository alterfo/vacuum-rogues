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

/** Fade out + remove the instant boot loader once the engine is ready. */
function hideBootLoader(): void {
  const el = document.getElementById('boot-loader');
  if (!el) return;
  el.classList.add('hidden');
  window.setTimeout(() => el.remove(), 500);
}

/** Boot failed — keep the loader up but swap the spinner for an error message. */
function failBootLoader(): void {
  const el = document.getElementById('boot-loader');
  if (!el) return;
  el.classList.add('error');
  const text = el.querySelector('.bl-text');
  if (text) text.textContent = 'Не удалось загрузить игру. Обновите страницу.';
}

/**
 * Reveal the always-on global «Оставить issue» button and wire its click to open
 * a prefilled GitHub issue with a full diagnostics snapshot (scene, day, seed,
 * player, viewport, device, build, userAgent…) of the live game. The button is
 * a DOM overlay, so it persists across every PixiJS scene transition.
 */
function wireIssueButton(engine: GameEngine): void {
  const btn = document.getElementById('vr-issue-btn');
  if (!btn) return;
  btn.addEventListener('click', () => openFeedback(gatherDiagnostics(engine)));
  btn.classList.add('ready');
}

/**
 * Soft mobile boot gate: when the device looks phone-class and the visitor hasn't
 * dismissed the notice (`sr_mobile_ack`), reveal the `#mobile-gate` overlay. The
 * engine still boots underneath — «Всё равно продолжить» hides the overlay and
 * remembers the choice so it won't nag on the next load. Never shown on desktop.
 */
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
  // Dismissal is one-shot (it persists via markDismissed and hides the gate), so
  // bind once — keeps maybeShowMobileGate idempotent if ever called more than once.
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

    // The presenter is constructed before the engine exists (renderer isn't built
    // until engine.initialize() runs), so it reads the renderer back through this
    // ref cell rather than holding a reference up front.
    const engineRef: { current: GameEngine | null } = { current: null };
    const overlayPresenter = new OverlayPresenter(
      () => engineRef.current?.renderer ?? null,
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
    engineRef.current = engine;

    await engine.initialize({
      seed: 'NEURAL_ONSLAUGHT',
      systemCount: 30,
      overmindSpeed: 1.0,
    });
    logger.info('Вакуумные Пройдохи initialized');
    hideBootLoader();
    wireIssueButton(engine);

    // Expose engine to window for E2E testing (dev/test mode only)
    if (typeof __DEBUG__ !== 'undefined' && __DEBUG__) {
      (window as unknown as Record<string, GameEngine>).__gameEngine = engine;
    }

    // Dev-only autopilot: hand the live ship to the agent and watch it play the
    // real game (window.__autopilot / Backquote hotkey). The dynamic import literal
    // is written inside `if (import.meta.env.DEV)` so Vite/Rollup drops the dev-only
    // chunk from the prod bundle entirely; attachDevAutopilot is the runtime gate.
    if (import.meta.env.DEV) {
      attachDevAutopilot(
        import.meta.env.DEV,
        engine,
        () => import('./tests/playtest/letsplay/installAutopilotHook'),
        (err) => logger.warn('Dev autopilot hook unavailable:', err),
      );
    }
  } catch (error) {
    logger.error('Failed to initialize game:', error);
    failBootLoader();
  }
}

main();
