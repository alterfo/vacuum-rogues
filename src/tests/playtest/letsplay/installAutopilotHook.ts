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
import { SceneType, QuestType } from "@/types";
import { logger } from "@/utils/logger";
import { observe, buildQuestSnapshots, marketSnapshotFor } from "./observe";
import { selectPlayerPolicy } from "./policyGate";
import { MemoryHeuristicPolicy } from "./MemoryHeuristicPolicy";
import { isNeuralEnabled } from "@/systems/settings/gameSettings";
// Trained player net (behavioural-cloned from the MemoryHeuristicPolicy teacher,
// `tools/ai/train_player.py`). Dev-only JSON, passed to the gate so the live
// autopilot runs the net when НЕЙРОСЕТЬ is on; the gate ignores it when off.
import playerWeights from "./weights/player.weights.json";
import { AutopilotController, type AutopilotDeps } from "./AutopilotController";
import {
  type AgentMemory,
  createMemory,
  questBaselineForObserve,
} from "./AgentMemory";
import { bestKnownMargin } from "./memoryFeatures";
import { deliveryCargoNeed } from "./observeHelpers";
import type { LiveSceneController } from "./LiveApplier";
import { exportFlags } from "./oddityFlags";
import {
  currentSystem,
  landedPlanet,
  acceptBoardQuests,
  executeMemoryAwareTrade,
  executeRepair,
  executeSellAll,
  pickWarpTarget,
  questRoutingPreference,
  reachableNeighbors,
  systemHopDistances,
} from "./engineQueries";
import {
  executeBuyBestGear,
  executeUpgradeHull,
  executeBuyBestModule,
} from "./equipmentQueries";
import { executeTakeLoan, executeRepayLoan } from "./bankingQueries";

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
  getMemory: () => AgentMemory = () => createMemory(),
): LiveSceneController {
  const goTo = (scene: SceneType, context: object = {}): Promise<void> =>
    engine.transitionTo(scene, { gameEngine: engine, ...context });

  // Anti-ping-pong warp tracking — mirrors PlayerAgent.lastSystemId/visitedSystemIds.
  let lastSystemId: string | null = null;
  const visitedSystemIds = new Set<string>();

  return {
    tick() {
      // Auto-dismiss any open encounter overlay (SOS / wreckage / anomaly scan)
      // so the autopilot keeps flying without a human pointer click. A click on
      // the overlay's dismiss button fires a native `pointerdown` that bubbles to
      // `window`, triggering reclaim-on-input → stop(). Driving the close
      // programmatically via closeModals() bypasses that race entirely.
      const sceneForModal = engine.currentScene as {
        npcManager?: { hasOpenModal?: () => boolean; closeModals?: () => void };
      } | null;
      if (sceneForModal?.npcManager?.hasOpenModal?.()) {
        sceneForModal.npcManager.closeModals?.();
        return;
      }

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

      // Resolve to a habitable planet: exact target if specified, else the first
      // habitable planet in the system. Never fall back to an uninhabited planet
      // (no market = instant take-off loop and live-autopilot disconnect).
      const sys = currentSystem(engine);
      const allPlanets = sys?.planets ?? [];
      const resolved = planetId
        ? allPlanets.find((p) => p.id === planetId)
        : allPlanets.find((p) => p.isHabitable !== false);
      if (!resolved) return;

      const pm = scene?.planetManager;
      if (
        pm &&
        typeof scene?.executeRouteTo === "function" &&
        scene.shipPhysics
      ) {
        const sprite = pm.planetSprites.find(
          (s) => s.planet.id === resolved.id,
        );
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
      // Headless fallback: direct scene transition to the resolved planet.
      void goTo(SceneType.PLANET, { planet: resolved });
    },
    async dock(stationId) {
      const sys = currentSystem(engine);
      const station =
        sys?.stations.find((s) => s.id === stationId) ?? sys?.stations[0];
      if (station) {
        await goTo(SceneType.STATION, { station });
        // dock() always teleports (no physical-docking-range simulation like
        // land()'s real-route branch), so it must refuel itself — mirrors
        // SpaceFlightScene.onDockAtStation (Task 7).
        const ship = engine.player?.ship;
        if (ship) ship.energy = ship.maxEnergy;
      }
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
      const connections = reachableNeighbors(
        engine.galaxy?.systems ?? [],
        prevId,
      );
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
      const questTarget = questRoutingPreference(
        engine.questManager.getActiveQuests(),
        prevId,
      );
      const target =
        systemId ??
        pickWarpTarget(
          connections,
          lastSystemId,
          visitedSystemIds,
          new Set(engine.galaxy?.overmindSystems ?? []),
          questTarget,
          questTarget != null
            ? systemHopDistances(engine.galaxy?.systems ?? [], questTarget)
            : undefined,
        );
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
      const player = engine.player;
      if (planet && player) {
        // Execute buy/sell directly via the real TradeSystem seam.
        // Opening the TRADE scene causes PLANET→TRADE→FLIGHT→PLANET loop:
        // the teacher always picks move="leave-market" in TRADE without buying,
        // so no cargo is ever acquired and holdingForOtherSystem stays 0.
        //
        // Mirrors PlayerAgent's TRADE-scene branch: a carried DELIVERY quest's
        // unmet cargo need wins first (never speculative — capped to the exact
        // shortfall, only when profitable), otherwise the best known
        // cross-planet margin's good, but ONLY when this planet is that
        // margin's own cheap buy planet — else `null` (sell-only), so landing
        // to realise a sell never immediately re-buys the same good here.
        const quests = buildQuestSnapshots(engine, player);
        const questCommittedGoods = new Set(
          quests
            .filter((q) => q.type === QuestType.DELIVERY && q.collectItem)
            .map((q) => q.collectItem!.type),
        );
        const market = planet.market
          ? marketSnapshotFor(planet, player)
          : undefined;
        const questNeed = deliveryCargoNeed(quests, market);
        if (questNeed) {
          executeMemoryAwareTrade(
            engine,
            planet,
            questNeed.good,
            questNeed.qty,
            questCommittedGoods,
          );
        } else {
          const margin = bestKnownMargin(getMemory());
          const preferredGood =
            margin.buyPlanet === planet.id ? margin.good : null;
          executeMemoryAwareTrade(
            engine,
            planet,
            preferredGood,
            undefined,
            questCommittedGoods,
          );
        }
      }
      // Take off after trading; the next FLIGHT tick decides warp/land/etc.
      await goTo(SceneType.SPACE_FLIGHT);
    },
    executeTrade() {
      // No live market executor yet — safe no-op (mirrors the headless applier).
    },
    takeQuest() {
      acceptBoardQuests(engine, getMemory().completedQuestsBaseline);
    },
    attack(targetId) {
      // Engage the nearest (or named) hostile via the real CombatModule seam.
      // e2eEngageCombat is __DEBUG__-gated in NpcShipManager so it never runs
      // in a production build.
      const nm = (
        engine.currentScene as {
          npcManager?: { e2eEngageCombat?: (id?: string) => void };
        } | null
      )?.npcManager;
      nm?.e2eEngageCombat?.(targetId);
    },
    flee() {
      // Break off combat pursuit — mirrors the player plotting a manual flee
      // route, which calls breakOffCombatPursuit() in SpaceFlightScene.
      const nm = (
        engine.currentScene as {
          npcManager?: { breakOffCombatPursuit?: () => void };
        } | null
      )?.npcManager;
      nm?.breakOffCombatPursuit?.();
    },
    repair() {
      // Guard on a fully-resolved player ship — executeRepair reads
      // player.ship directly (no optional chaining), so this keeps the verb a
      // true no-op rather than a throw on an incompletely-initialized player.
      if (engine.player?.ship) executeRepair(engine);
    },
    buyGear() {
      executeBuyBestGear(engine);
    },
    upgradeHull() {
      executeUpgradeHull(engine);
    },
    buyModule() {
      executeBuyBestModule(engine);
    },
    takeLoan() {
      executeTakeLoan(engine);
    },
    repayLoan() {
      executeRepayLoan(engine);
    },
    sellCargo() {
      // legalActionsForScene only offers sell-cargo from PLANET/TRADE, both of
      // which imply the player is landed — mirrors PlayerAgent's sell-cargo guard.
      const planet = landedPlanet(engine);
      if (planet) executeSellAll(engine, planet);
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

  // The live scene controller is built before the AutopilotController that will
  // own the trading memory it needs (openTrade's known-margin lookup) — this
  // ref lets the controller close over that memory once it exists, without a
  // circular construction order.
  let controllerRef: AutopilotController | null = null;
  const controller = new AutopilotController({
    observe: () =>
      observe(
        engine,
        questBaselineForObserve(
          controllerRef?.currentMemory() ?? createMemory(),
          engine,
        ),
      ),
    // When the neural toggle is off (default), use MemoryHeuristicPolicy — the
    // BC teacher that carries a per-engagement belief, executes buy-low/sell-high
    // routes, and warps to explore new systems. The stateless HeuristicPolicy
    // (selectPlayerPolicy's off-default) has no loop-prevention and gets stuck
    // in a PLANET → SPACE_FLIGHT spin forever. When neural is on, use the
    // trained NeuralPolicy via the gate (same source-of-truth as the settings panel).
    policy: isNeuralEnabled()
      ? selectPlayerPolicy({ weights: playerWeights })
      : new MemoryHeuristicPolicy(),
    controller: createLiveSceneController(
      engine,
      () => controllerRef?.currentMemory() ?? createMemory(),
    ),
    onError: (err) => logger.warn("Autopilot tick fault (continuing):", err),
    // The Shift+F oddity-flag hotkey (below) must never disengage the autopilot.
    ignoreReclaimKey: isOddityFlagKey,
    ...overrides,
  });
  controllerRef = controller;

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
