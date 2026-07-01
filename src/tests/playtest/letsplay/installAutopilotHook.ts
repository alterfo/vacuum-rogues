/**
 * Dev-only autopilot — the install hook + concrete live-scene controller (Task 3).
 *
 * This is the dev-only counterpart that turns the pure {@link AutopilotController}
 * into something you can flip on in the *live, rendered* game. It:
 *  - builds a concrete {@link LiveSceneController} over the real {@link GameEngine}
 *    (the same `transitionTo` wiring the headless {@link PlayerAgent} drives, but on
 *    the live engine — route/land/dock/warp/trade/take-quest), and
 *  - constructs an {@link AutopilotController} with `() => observe(engine)`, the
 *    default policy from the neural feature gate ({@link selectPlayerPolicy} —
 *    heuristic unless the neural flag is on), and that live controller, then
 *  - exposes it as `window.__autopilot` and binds a toggle hotkey (Backquote).
 *
 * It lives under `src/tests/` and is imported **only** via a DEV-gated dynamic
 * `import()` from `main.ts` (through {@link attachDevAutopilot}), so no production
 * module statically imports it and the prod bundle is unaffected (enforced by
 * `letsplayDevOnly.test.ts`). The toggle reuses the controller's reclaim-on-input,
 * so the first human pointer/key after engaging hands control straight back.
 */
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { observe } from "./observe";
import { selectPlayerPolicy } from "./policyGate";
// Trained player net (behavioural-cloned from the MemoryHeuristicPolicy teacher,
// `tools/ai/train_player.py`). Dev-only JSON, passed to the gate so the live
// autopilot runs the net when НЕЙРОСЕТЬ is on; the gate ignores it when off.
import playerWeights from "./weights/player.weights.json";
import { AutopilotController, type AutopilotDeps } from "./AutopilotController";
import type { LiveSceneController } from "./LiveApplier";
import { exportFlags } from "./oddityFlags";
import {
  currentSystem,
  landedPlanet,
  acceptBoardQuests,
  executeTradeOnPlanet,
  pickWarpTarget,
} from "./engineQueries";

/** The `keydown` that toggles the autopilot (Backquote / `` ` `` — unused in flight). */
export const AUTOPILOT_HOTKEY_CODE = "Backquote";

/** Whether a `keydown` is the silent oddity-flag hotkey (Shift+F). */
function isOddityFlagKey(e: KeyboardEvent): boolean {
  return e.shiftKey && e.key.toLowerCase() === "f";
}

/** How long the indicator flashes "flagged" after `Shift+F` (ms). */
const FLAG_FLASH_MS = 1000;

/**
 * Briefly swap the "● АВТОПИЛОТ" pill's text to "⚑ ОТМЕЧЕНО" as visual
 * confirmation that `Shift+F` recorded a flag, then restore it. A no-op
 * without a `document` or before the indicator has ever been shown (its
 * element is created lazily by `domIndicator()` in `AutopilotController.ts`).
 */
function flashFlaggedIndicator(): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("autopilot-indicator");
  if (!el) return;
  const original = el.textContent;
  el.textContent = "⚑ ОТМЕЧЕНО";
  setTimeout(() => {
    el.textContent = original;
  }, FLAG_FLASH_MS);
}

/** The dev-only window hook published at `window.__autopilot`. */
export interface AutopilotWindowHook {
  /** Engage the autopilot (idempotent). */
  start(): void;
  /** Disengage (idempotent — also the reclaim-on-input path). */
  stop(): void;
  /** Flip engaged ↔ disengaged. */
  toggle(): void;
  /** Whether the autopilot is currently flying. */
  readonly engaged: boolean;
  /** The underlying controller (for advanced/manual driving). */
  readonly controller: AutopilotController;
  /** Flag the current moment as an oddity for later review (see `oddityFlags.ts`). */
  flag(note?: string): void;
  /** All flagged oddities so far, serialized as JSON (copy-paste from the console). */
  exportFlags(): string;
}

/**
 * Build the concrete {@link LiveSceneController} that drives the *live* engine.
 * Each verb maps onto the same real `transitionTo` / scene call the headless
 * {@link PlayerAgent} uses, so the live loop and the harness loop behave
 * identically. Verbs with no live executor yet (`executeTrade`, combat, repair)
 * degrade to a safe no-op exactly as the headless applier does, and `tick` is a
 * no-op because the live rAF loop already advances frames between decisions.
 */
export function createLiveSceneController(
  engine: GameEngine,
): LiveSceneController {
  const goTo = (scene: SceneType, context: object = {}): Promise<void> =>
    engine.transitionTo(scene, { gameEngine: engine, ...context });

  // Anti-ping-pong warp tracking — mirrors PlayerAgent.lastSystemId/visitedSystemIds.
  let lastSystemId: string | null = null;
  const visitedSystemIds = new Set<string>();

  return {
    tick() {
      // A pending warp plots the route but does NOT start movement — the player
      // must press Ход (Space / run-turn) to fly to the system edge. The live rAF
      // loop does not do this automatically. Drive it manually each tick.
      // Guard: only start once — calling executeRouteTo while already moving
      // resets the path each tick and causes the ship to jerk visibly.
      const scene = engine.currentScene as {
        pendingWarp?: unknown;
        plannedRoute?: { x: number; y: number } | null;
        executeRouteTo?: (x: number, y: number) => void;
        shipPhysics?: { isMoving: boolean } | null;
      } | null;
      if (
        engine.currentSceneType === SceneType.SPACE_FLIGHT &&
        scene?.pendingWarp != null &&
        scene.plannedRoute != null &&
        typeof scene.executeRouteTo === "function" &&
        !scene.shipPhysics?.isMoving
      ) {
        scene.executeRouteTo(scene.plannedRoute.x, scene.plannedRoute.y);
      }
    },
    async leaveToFlight() {
      await goTo(SceneType.SPACE_FLIGHT);
    },
    land(planetId) {
      // In a live flight scene, physically route the ship to the planet so it
      // actually flies there instead of teleporting (as the headless harness does).
      // We access the private planetManager/executeRouteTo via a structural cast —
      // acceptable here because this module is dev-only and `private` is TS-only.
      const scene = engine.currentScene as {
        planetManager?: {
          planetSprites: Array<{
            planet: { id: string };
            screenX: number;
            screenY: number;
            displayRadius: number;
          }>;
          routeTargetPlanetId: string | null;
        };
        executeRouteTo?: (
          x: number,
          y: number,
          landing?: { planetX: number; planetY: number; planetRadius: number },
        ) => void;
        shipPhysics?: unknown;
      } | null;

      const pm = scene?.planetManager;
      if (
        pm &&
        typeof scene?.executeRouteTo === "function" &&
        scene.shipPhysics
      ) {
        const sprite =
          pm.planetSprites.find((s) => s.planet.id === planetId) ??
          pm.planetSprites[0];
        if (sprite) {
          const alreadyEnRoute =
            pm.routeTargetPlanetId === sprite.planet.id &&
            (scene.shipPhysics as { isMoving?: boolean }).isMoving;
          if (!alreadyEnRoute) {
            pm.routeTargetPlanetId = sprite.planet.id;
            scene.executeRouteTo(sprite.screenX, sprite.screenY, {
              planetX: sprite.screenX,
              planetY: sprite.screenY,
              planetRadius: sprite.displayRadius,
            });
          }
          return; // ship is flying (or just started); auto-land fires via SpaceFlightScene.update()
        }
      }
      // Fallback for headless / non-flight scenes: direct scene transition.
      const sys = currentSystem(engine);
      const planet =
        sys?.planets.find((p) => p.id === planetId) ?? sys?.planets[0];
      if (planet) void goTo(SceneType.PLANET, { planet });
    },
    async dock(stationId) {
      const sys = currentSystem(engine);
      const station =
        sys?.stations.find((s) => s.id === stationId) ?? sys?.stations[0];
      if (station) await goTo(SceneType.STATION, { station });
    },
    async openStarMap() {
      // Save ship position before leaving — identical to returnToStarMap() in
      // SpaceFlightScene. Without this, the warp re-entry to SPACE_FLIGHT places
      // the ship at center ± exitVector×innerRadius (right at the sun boundary)
      // instead of where it actually was.
      const flightScene = engine.currentScene as {
        shipPhysics?: { shipX: number; shipY: number } | null;
      } | null;
      if (
        engine.currentSceneType === SceneType.SPACE_FLIGHT &&
        flightScene?.shipPhysics
      ) {
        engine.lastFlightShipPos = {
          x: flightScene.shipPhysics.shipX,
          y: flightScene.shipPhysics.shipY,
        };
      }
      await goTo(SceneType.STAR_MAP);
    },
    async warp(systemId) {
      const sys = currentSystem(engine);
      const prevId = sys?.id ?? null;
      const connections = sys?.connections ?? [];
      // When all local connections are already visited (dead-end pocket or
      // fully-explored galaxy) reset the visited set so exploration restarts
      // rather than cycling inside the pocket indefinitely.
      if (
        connections.length > 0 &&
        connections.every((c) => visitedSystemIds.has(c.toSystemId))
      ) {
        visitedSystemIds.clear();
      }
      // Prefers unvisited systems, then avoids the system we just came from,
      // then falls back to connections[0] — prevents ping-pong.
      const target =
        systemId ?? pickWarpTarget(connections, lastSystemId, visitedSystemIds);
      if (prevId) visitedSystemIds.add(prevId);
      lastSystemId = prevId;
      const scene = engine.currentScene as {
        performWarpJumpTo?: (id: string) => Promise<void>;
      } | null;
      if (target && typeof scene?.performWarpJumpTo === "function") {
        await scene.performWarpJumpTo(target);
      }
    },
    async openTrade(planetId) {
      const sys = currentSystem(engine);
      const planet =
        landedPlanet(engine) ??
        sys?.planets.find((p) => p.id === planetId) ??
        sys?.planets[0];
      if (planet) {
        // Execute buy/sell directly via the real TradeSystem seam.
        // Opening the TRADE scene causes PLANET→TRADE→FLIGHT→PLANET loop:
        // the teacher always picks move="leave-market" in TRADE without buying,
        // so no cargo is ever acquired and holdingForOtherSystem stays 0.
        executeTradeOnPlanet(engine, planet);
      }
      // Take off after trading; the next FLIGHT tick decides warp/land/etc.
      await goTo(SceneType.SPACE_FLIGHT);
    },
    executeTrade() {
      // No live market executor yet — safe no-op (mirrors the headless applier).
    },
    takeQuest() {
      acceptBoardQuests(engine);
    },
    attack() {
      // Combat is owned by CombatModule; the autopilot degrades to a no-op here.
    },
    flee() {
      // No disengage verb at this level — a safe no-op.
    },
    repair() {
      // Repair is owned by the station UI — a safe no-op.
    },
    buyGear() {
      // No live executor yet — safe no-op (mirrors the headless applier pattern
      // for verbs not yet wired to the rendered scene).
    },
    upgradeHull() {
      // No live executor yet — safe no-op.
    },
    buyModule() {
      // No live executor yet — safe no-op.
    },
    takeLoan() {
      // No live executor yet — safe no-op.
    },
    repayLoan() {
      // No live executor yet — safe no-op.
    },
    sellCargo() {
      // No live executor yet — safe no-op.
    },
  };
}

/**
 * Install the dev-only autopilot over the live `engine`: build the controller
 * (default heuristic policy via the neural gate), publish `window.__autopilot`,
 * and bind the {@link AUTOPILOT_HOTKEY_CODE} toggle. Idempotent — a second call
 * returns the already-installed hook. `overrides` lets a test inject a fake
 * scheduler / spy controller so it never spins a real timer.
 */
export function installAutopilotHook(
  engine: GameEngine,
  overrides: Partial<AutopilotDeps> = {},
): AutopilotWindowHook {
  const win =
    typeof window !== "undefined"
      ? (window as unknown as { __autopilot?: AutopilotWindowHook })
      : null;
  if (win?.__autopilot) return win.__autopilot;

  const controller = new AutopilotController({
    observe: () => observe(engine),
    // The neural feature gate picks the brain: heuristic by default (flag off),
    // the trained NeuralPolicy (fed the exported weights) when the settings
    // toggle is on — same seam, smarter. `enabled` is omitted so it reads the
    // live isNeuralEnabled() flag, the same source of truth the settings panel
    // writes (see policyGate.ts) — do not force it on here.
    policy: selectPlayerPolicy({ weights: playerWeights }),
    controller: createLiveSceneController(engine),
    onError: (err) => logger.warn("Autopilot tick fault (continuing):", err),
    // The Shift+F oddity-flag hotkey (below) must never disengage the autopilot.
    ignoreReclaimKey: isOddityFlagKey,
    ...overrides,
  });

  const hook: AutopilotWindowHook = {
    start: () => controller.start(),
    stop: () => controller.stop(),
    toggle: () =>
      controller.isEngaged ? controller.stop() : controller.start(),
    get engaged() {
      return controller.isEngaged;
    },
    controller,
    flag: (note?: string) => controller.flag(note),
    exportFlags: () => exportFlags(),
  };

  if (win) {
    win.__autopilot = hook;
    // The hotkey listener is bound *before* any engage, so it always precedes the
    // controller's reclaim-on-input listener (added on start) in the dispatch
    // order — pressing the hotkey to disengage resolves to a clean stop, not a
    // stop-then-restart race with reclaim.
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (hook.engaged && isOddityFlagKey(e)) {
        hook.flag();
        flashFlaggedIndicator();
        return;
      }
      if (e.code !== AUTOPILOT_HOTKEY_CODE) return;
      hook.toggle();
    });
    logger.info(
      "Dev autopilot ready: press `` ` `` (Backquote) or call window.__autopilot.start()",
    );
  }

  return hook;
}
