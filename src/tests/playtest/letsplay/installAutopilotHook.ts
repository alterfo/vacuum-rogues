import type { GameEngine } from "@/systems/GameEngine";
import { SceneType, QuestType, type ResourceType } from "@/types";
import { logger } from "@/utils/logger";
import { warpEdgePoint } from "@/utils/flightGeometry";
import { observe, buildQuestSnapshots, marketSnapshotFor } from "./observe";
import { selectPlayerPolicy } from "./policyGate";
import {
  MemoryHeuristicPolicy,
  warpWantsQuestBias,
  isBattleReady,
  OVERMIND_THREAT_HULL_FRACTION,
} from "./MemoryHeuristicPolicy";
import { LOW_HULL_FRACTION } from "./HeuristicPolicy";
import type { NpcShip } from "@/domain/NpcShip";
import type { CommsContext } from "@/systems/comms/commsOptions";
import { isNeuralEnabled } from "@/systems/settings/gameSettings";
import { GAME_BALANCE } from "@/config/balance";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { Encounter } from "@/systems/encounters/encounterGenerator";
import type { EncounterChoice } from "@/systems/encounters/encounterOutcome";
import {
  isHelpPanelOpen,
  dismissHelpPanel,
} from "@/presentation/ui/mountSceneHelp";
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
import { confirmPlanningIfOpen } from "./planningDriver";
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
  executeArmUp,
} from "./equipmentQueries";
import { executeTakeLoan, executeRepayLoan } from "./bankingQueries";

export const AUTOPILOT_HOTKEY_CODE = "Backquote";

function isOddityFlagKey(e: KeyboardEvent): boolean {
  return e.shiftKey && e.key.toLowerCase() === "f";
}

const FLAG_FLASH_MS = 1000;

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

export interface AutopilotWindowHook {
  start(): void;
  stop(): void;
  toggle(): void;
  readonly engaged: boolean;
  readonly controller: AutopilotController;
  flag(note?: string): void;
  exportFlags(): string;
}

export function createLiveSceneController(
  engine: GameEngine,
  getMemory: () => AgentMemory = () => createMemory(),
): LiveSceneController {
  const goTo = (scene: SceneType, context: object = {}): Promise<void> =>
    engine.transitionTo(scene, { gameEngine: engine, ...context });

  let lastSystemId: string | null = null;
  const visitedSystemIds = new Set<string>();

  let tickCount = 0;
  let questJournalGraceGiven = false;
  let settingsPanelGraceGiven = false;
  let planetInfoGraceGiven = false;
  let systemMenuGraceGiven = false;

  function dismissBlockingModal(): boolean {
    if (isHelpPanelOpen()) {
      dismissHelpPanel();
      return true;
    }
    const planetScene = engine.currentScene as {
      isCustomsModalOpen?: boolean;
      customsBribeCost?: number | null;
      applyCustomsChoice?: (choice: "pay" | "bribe" | "dump") => boolean;
    } | null;
    if (planetScene?.isCustomsModalOpen && planetScene.applyCustomsChoice) {
      const bribe = planetScene.customsBribeCost ?? null;
      const credits = engine.player?.credits ?? 0;
      const choice = bribe != null && credits >= bribe ? "bribe" : "dump";
      planetScene.applyCustomsChoice(choice);
      return true;
    }
    const scene = engine.currentScene as {
      npcManager?: {
        hasOpenModal?: () => boolean;
        closeModals?: () => void;
        isEncounterPromptOpen?: boolean;
        activeEncounter?: Encounter | null;
        closeEncounterPrompt?: () => void;
        applyEncounterChoice?: (
          encounter: Encounter,
          choice: EncounterChoice,
        ) => unknown;
        isOvermindPromptOpen?: boolean;
        spawnOvermindCoreCombatant?: () => void;
        openContactNpc?: {
          npc: NpcShip;
          context: CommsContext | undefined;
        } | null;
        onPayTribute?: (npc: NpcShip) => void;
        onFleeShakedown?: (npc: NpcShip) => void;
        onAttackNpc?: (npc: NpcShip) => void;
      };
      pendingWarp?: unknown;
      plannedRoute?: { x: number; y: number } | null;
      shipPhysics?: { isMoving: boolean } | null;
      isTurnRunning?: boolean;
      combatModule?: { isActive?: boolean } | null;
      e2eStartTurn?: () => void;
      combatPause?: { paused?: boolean; resume?: () => void };
    } | null;
    if (
      scene?.npcManager?.isEncounterPromptOpen &&
      scene.npcManager.activeEncounter
    ) {
      const encounter = scene.npcManager.activeEncounter;
      scene.npcManager.closeEncounterPrompt?.();
      scene.npcManager.applyEncounterChoice?.(encounter, "engage");
      return true;
    }
    if (scene?.npcManager?.isOvermindPromptOpen) {
      const obs = observe(engine);
      const hull = obs.player?.hullFraction ?? 1;
      if (
        isBattleReady(obs) &&
        hull >= OVERMIND_THREAT_HULL_FRACTION &&
        typeof scene.npcManager.spawnOvermindCoreCombatant === "function"
      ) {
        scene.npcManager.spawnOvermindCoreCombatant();
        return true;
      }
      scene.npcManager.closeModals?.();
      return true;
    }
    const contact = scene?.npcManager?.openContactNpc;
    if (contact?.context === "pirate-shakedown" && contact.npc) {
      const npc = contact.npc;
      const obs = observe(engine);
      const hull = obs.player?.hullFraction ?? 1;
      if (
        isBattleReady(obs) &&
        hull >= OVERMIND_THREAT_HULL_FRACTION &&
        typeof scene?.npcManager?.onAttackNpc === "function"
      ) {
        scene.npcManager.onAttackNpc(npc);
        return true;
      }
      if (
        hull < LOW_HULL_FRACTION &&
        typeof scene?.npcManager?.onFleeShakedown === "function"
      ) {
        scene.npcManager.onFleeShakedown(npc);
        return true;
      }
      if (typeof scene?.npcManager?.onPayTribute === "function") {
        scene.npcManager.onPayTribute(npc);
        return true;
      }
    }
    if (scene?.npcManager?.hasOpenModal?.()) {
      scene.npcManager.closeModals?.();
      if (
        engine.currentSceneType === SceneType.SPACE_FLIGHT &&
        scene.pendingWarp == null &&
        !scene.plannedRoute &&
        !scene.shipPhysics?.isMoving &&
        !scene.isTurnRunning &&
        !scene.combatModule?.isActive &&
        typeof scene.e2eStartTurn === "function"
      ) {
        scene.e2eStartTurn();
      }
      return true;
    }
    if (
      scene?.combatPause?.paused &&
      typeof scene.combatPause.resume === "function"
    ) {
      scene.combatPause.resume();
      return true;
    }
    return false;
  }

  const runLiveTrade = async (): Promise<void> => {
    const scene = engine.currentScene as {
      e2eBuyItem?: (r: ResourceType, qty: number) => boolean;
      e2eSellItem?: (r: ResourceType, qty: number) => boolean;
    } | null;
    if (!scene?.e2eBuyItem || !scene.e2eSellItem) {
      return;
    }
    const sys = currentSystem(engine);
    const planet = landedPlanet(engine) ?? sys?.planets[0];
    const player = engine.player;
    if (!planet || !player) return;
    const quests = buildQuestSnapshots(engine, player);
    const questCommittedGoods = new Set(
      quests
        .filter((q) => q.type === QuestType.DELIVERY && q.collectItem)
        .map((q) => q.collectItem!.type),
    );
    const market = planet.market
      ? marketSnapshotFor(planet, player, sys?.ownerFaction)
      : undefined;
    const questNeed = deliveryCargoNeed(quests, market);
    const executor = {
      buy: (good: ResourceType, qty: number) => {
        scene.e2eBuyItem!(good, qty);
      },
      sell: (good: ResourceType, qty: number) => {
        scene.e2eSellItem!(good, qty);
      },
    };
    if (questNeed) {
      executeMemoryAwareTrade(
        engine,
        planet,
        questNeed.good,
        questNeed.qty,
        questCommittedGoods,
        executor,
      );
    } else {
      const margin = bestKnownMargin(getMemory());
      const preferredGood = margin.buyPlanet === planet.id ? margin.good : null;
      executeMemoryAwareTrade(
        engine,
        planet,
        preferredGood,
        undefined,
        questCommittedGoods,
        executor,
      );
    }
    await goTo(SceneType.SPACE_FLIGHT);
  };

  return {
    dismissBlockingModal,
    tick() {
      tickCount++;
      if (dismissBlockingModal()) {
        confirmPlanningIfOpen(engine.currentScene, { assignWeapons: true });
        return;
      }
      if (confirmPlanningIfOpen(engine.currentScene, { assignWeapons: true })) {
        return;
      }

      const sceneForHud = engine.currentScene as {
        hud?: {
          isQuestJournalOpen?: () => boolean;
          isSettingsPanelOpen?: () => boolean;
          closeModals?: () => void;
          isSystemModalOpen?: () => boolean;
          closeSystemMenu?: () => void;
        };
        planetManager?: {
          hasInfoPanel?: boolean;
          closeInfoPanel?: () => void;
        };
      } | null;
      const journalOpen = !!sceneForHud?.hud?.isQuestJournalOpen?.();
      const settingsOpen = !!sceneForHud?.hud?.isSettingsPanelOpen?.();
      if (journalOpen || settingsOpen) {
        const journalDue =
          !journalOpen || tickCount <= 1 || questJournalGraceGiven;
        const settingsDue =
          !settingsOpen || tickCount <= 1 || settingsPanelGraceGiven;
        if (journalDue && settingsDue) {
          sceneForHud?.hud?.closeModals?.();
          questJournalGraceGiven = false;
          settingsPanelGraceGiven = false;
          return;
        }
        if (journalOpen) questJournalGraceGiven = true;
        if (settingsOpen) settingsPanelGraceGiven = true;
        return;
      }
      questJournalGraceGiven = false;
      settingsPanelGraceGiven = false;
      if (sceneForHud?.planetManager?.hasInfoPanel) {
        if (tickCount <= 1 || planetInfoGraceGiven) {
          sceneForHud.planetManager.closeInfoPanel?.();
          planetInfoGraceGiven = false;
          return;
        }
        planetInfoGraceGiven = true;
        return;
      }
      planetInfoGraceGiven = false;

      if (sceneForHud?.hud?.isSystemModalOpen?.()) {
        if (tickCount <= 1 || systemMenuGraceGiven) {
          sceneForHud.hud.closeSystemMenu?.();
          systemMenuGraceGiven = false;
          return;
        }
        systemMenuGraceGiven = true;
        return;
      }
      systemMenuGraceGiven = false;

      const scene = engine.currentScene as {
        pendingWarp?: unknown;
        plannedRoute?: { x: number; y: number } | null;
        executeRouteTo?: (x: number, y: number) => void;
        shipPhysics?: { isMoving: boolean } | null;
        isTurnRunning?: boolean;
        combatModule?: { isActive?: boolean } | null;
        e2eStartTurn?: () => void;
      } | null;
      if (
        engine.currentSceneType === SceneType.SPACE_FLIGHT &&
        scene?.pendingWarp != null &&
        scene.plannedRoute != null &&
        typeof scene.executeRouteTo === "function" &&
        !scene.shipPhysics?.isMoving
      ) {
        scene.executeRouteTo(scene.plannedRoute.x, scene.plannedRoute.y);
        return;
      }

      if (
        engine.currentSceneType === SceneType.SPACE_FLIGHT &&
        scene?.pendingWarp == null &&
        !scene?.plannedRoute &&
        !scene?.shipPhysics?.isMoving &&
        !scene?.isTurnRunning &&
        !scene?.combatModule?.isActive &&
        typeof scene?.e2eStartTurn === "function"
      ) {
        scene.e2eStartTurn();
      }
    },
    async leaveToFlight() {
      const scene = engine.currentScene as { station?: { id?: string } } | null;
      const fromStationId = scene?.station?.id;
      await goTo(
        SceneType.SPACE_FLIGHT,
        fromStationId ? { fromStationId } : {},
      );
    },
    land(planetId) {
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
      void goTo(SceneType.PLANET, { planet: resolved });
    },
    async dock(stationId) {
      const sys = currentSystem(engine);
      const station =
        sys?.stations.find((s) => s.id === stationId) ?? sys?.stations[0];
      if (!station) return;

      const flightScene = engine.currentScene as {
        planetManager?: {
          stationMarkers?: Array<{
            station: { id: string };
            x: number;
            y: number;
          }>;
          routeTargetStationId?: string | null;
        };
        executeRouteTo?: (x: number, y: number) => void;
        shipPhysics?: { isMoving?: boolean } | null;
      } | null;
      const pm = flightScene?.planetManager;
      const marker = pm?.stationMarkers?.find(
        (m) => m.station.id === station.id,
      );

      if (
        marker &&
        pm &&
        typeof flightScene?.executeRouteTo === "function" &&
        flightScene.shipPhysics
      ) {
        const alreadyEnRoute =
          pm.routeTargetStationId === marker.station.id &&
          flightScene.shipPhysics.isMoving;
        if (!alreadyEnRoute) {
          pm.routeTargetStationId = marker.station.id;
          flightScene.executeRouteTo(marker.x, marker.y);
        }
        return; // ship is flying (or just started); proactive dock fires via SpaceFlightScene.update()
      }

      if (marker) {
        engine.lastFlightShipPos = { x: marker.x, y: marker.y };
      }
      await goTo(SceneType.STATION, { station });
      const ship = engine.player?.ship;
      if (ship) ship.energy = ship.maxEnergy;
    },
    async openStarMap() {
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
    async warp(systemId, reason) {
      const pauseScene = engine.currentScene as {
        combatPause?: { paused?: boolean; resume?: () => void };
      } | null;
      if (
        pauseScene?.combatPause?.paused &&
        typeof pauseScene.combatPause.resume === "function"
      ) {
        pauseScene.combatPause.resume();
      }
      confirmPlanningIfOpen(pauseScene, { assignWeapons: false });
      const sys = currentSystem(engine);
      const prevId = sys?.id ?? null;
      const connections = reachableNeighbors(
        engine.galaxy?.systems ?? [],
        prevId,
      );
      if (
        connections.length > 0 &&
        connections.every((c) => visitedSystemIds.has(c.toSystemId))
      ) {
        visitedSystemIds.clear();
      }
      const hostileHeld = new Set([
        ...(engine.galaxy?.overmindSystems ?? []),
        ...(engine.galaxy?.pirateSystems ?? []),
      ]);
      const player = engine.player;
      const rawQuestTarget = warpWantsQuestBias(reason)
        ? questRoutingPreference(
            engine.questManager.getActiveQuests().map((q) => {
              const collectObj = q.objectives?.find(
                (o) => o.type === "COLLECT_ITEM" && !o.completed && o.itemType,
              );
              const carried = collectObj
                ? (player?.inventory?.resources?.find(
                    (r) => r.type === collectObj.itemType,
                  )?.amount ?? 0)
                : 0;
              return {
                type: q.type,
                targetSystemId: q.targetSystemId ?? null,
                collectItem: collectObj
                  ? { carried, required: collectObj.targetAmount }
                  : null,
              };
            }),
            prevId,
          )
        : null;
      const questTarget =
        rawQuestTarget != null && hostileHeld.has(rawQuestTarget)
          ? null
          : rawQuestTarget;
      const directTarget =
        systemId != null && connections.some((c) => c.toSystemId === systemId)
          ? systemId
          : undefined;
      const destination =
        directTarget == null &&
        systemId != null &&
        !hostileHeld.has(systemId) &&
        (engine.galaxy?.systems ?? []).some((s) => s.id === systemId)
          ? systemId
          : null;
      const prefer = destination ?? questTarget;
      const target =
        directTarget ??
        pickWarpTarget(
          connections,
          lastSystemId,
          visitedSystemIds,
          hostileHeld,
          prefer,
          prefer != null
            ? systemHopDistances(engine.galaxy?.systems ?? [], prefer)
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
      if (planet) {
        await goTo(SceneType.TRADE, { planet });
        await runLiveTrade();
        return;
      }
      await goTo(SceneType.SPACE_FLIGHT);
    },
    async executeTrade() {
      await runLiveTrade();
    },
    takeQuest() {
      const scene = engine.currentScene as {
        e2eOpenJobBoard?: () => void;
        e2eAcceptBoardQuest?: (quest: GeneratedQuest) => void;
        e2eCloseJobBoard?: () => void;
      } | null;
      if (
        scene?.e2eOpenJobBoard &&
        scene.e2eAcceptBoardQuest &&
        scene.e2eCloseJobBoard
      ) {
        scene.e2eOpenJobBoard();
        acceptBoardQuests(engine, getMemory().completedQuestsBaseline, (q) =>
          scene.e2eAcceptBoardQuest!(q),
        );
        scene.e2eCloseJobBoard();
        return;
      }
      acceptBoardQuests(engine, getMemory().completedQuestsBaseline);
    },
    attack(targetId) {
      const scene = engine.currentScene as {
        combatPause?: { paused?: boolean; confirm?: () => unknown };
        combatModule?: { isActive?: boolean } | null;
        npcManager?: {
          e2eEngageCombat?: (id?: string) => void;
          npcSprites?: Array<{ npc: { id: string } }>;
          interaction?: { onAttackNpc?: (npc: { id: string }) => void };
        };
      } | null;
      if (
        confirmPlanningIfOpen(scene, {
          preferredTargetId: targetId,
          closeOnTarget: true,
        })
      ) {
        return;
      }
      if (
        scene?.combatPause?.paused &&
        typeof scene.combatPause.confirm === "function"
      ) {
        scene.combatPause.confirm();
        return;
      }
      if (scene?.combatModule?.isActive) return;
      const npcSprites = scene?.npcManager?.npcSprites ?? [];
      const sprite = targetId
        ? (npcSprites.find((s) => s.npc.id === targetId) ?? npcSprites[0])
        : npcSprites[0];
      if (
        sprite &&
        typeof scene?.npcManager?.interaction?.onAttackNpc === "function"
      ) {
        scene.npcManager.interaction.onAttackNpc(sprite.npc);
        return;
      }
      scene?.npcManager?.e2eEngageCombat?.(targetId);
    },
    flee() {
      const scene = engine.currentScene as {
        combatPause?: { paused?: boolean; resume?: () => void };
        npcManager?: { breakOffCombatPursuit?: () => void };
        shipPhysics?: {
          shipX: number;
          shipY: number;
          isMoving?: boolean;
        } | null;
        executeRouteTo?: (x: number, y: number) => void;
        pendingWarp?: unknown;
        starRenderer?: { centerX: number; centerY: number } | null;
        SYSTEM_BOUNDARY_RADIUS?: number;
      } | null;
      if (
        scene?.combatPause?.paused &&
        typeof scene.combatPause.resume === "function"
      ) {
        scene.combatPause.resume();
      }
      scene?.npcManager?.breakOffCombatPursuit?.();

      if (
        scene?.shipPhysics &&
        typeof scene.executeRouteTo === "function" &&
        scene.pendingWarp == null &&
        !scene.shipPhysics.isMoving &&
        scene.starRenderer &&
        typeof scene.SYSTEM_BOUNDARY_RADIUS === "number"
      ) {
        const edge = warpEdgePoint(
          { x: scene.shipPhysics.shipX, y: scene.shipPhysics.shipY },
          { x: scene.starRenderer.centerX, y: scene.starRenderer.centerY },
          { x: 1, y: 0 }, // degenerate-centre fallback only; fromMidSystem wins otherwise
          scene.SYSTEM_BOUNDARY_RADIUS,
          true,
        );
        scene.executeRouteTo(edge.x, edge.y);
      }
      confirmPlanningIfOpen(scene, { assignWeapons: false });
    },
    repair() {
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
      const planet = landedPlanet(engine);
      if (planet) executeSellAll(engine, planet);
    },
    armUp() {
      executeArmUp(engine);
    },
    liberate() {
      engine.liberateCurrentSystem();
    },
  };
}

export function installAutopilotHook(
  engine: GameEngine,
  overrides: Partial<AutopilotDeps> = {},
): AutopilotWindowHook {
  const win =
    typeof window !== "undefined"
      ? (window as unknown as { __autopilot?: AutopilotWindowHook })
      : null;
  if (win?.__autopilot) return win.__autopilot;

  let controllerRef: AutopilotController | null = null;
  let lastGalaxyId: string | null = null;
  const resetMemoryOnGalaxyChange = (): void => {
    const id = engine.galaxy?.id ?? null;
    if (id !== null && id !== lastGalaxyId) {
      if (lastGalaxyId !== null) controllerRef?.resetMemory();
      lastGalaxyId = id;
    }
  };
  const controller = new AutopilotController({
    observe: () => {
      resetMemoryOnGalaxyChange();
      return observe(
        engine,
        questBaselineForObserve(
          controllerRef?.currentMemory() ?? createMemory(),
          engine,
        ),
      );
    },
    policy: isNeuralEnabled()
      ? selectPlayerPolicy({ weights: playerWeights })
      : new MemoryHeuristicPolicy(),
    controller: createLiveSceneController(
      engine,
      () => controllerRef?.currentMemory() ?? createMemory(),
    ),
    onError: (err) => logger.warn("Autopilot tick fault (continuing):", err),
    ignoreReclaimKey: isOddityFlagKey,
    isTerminal: () =>
      engine.currentSceneType === SceneType.GAME_OVER ||
      engine.currentSceneType === SceneType.WIN_SCREEN,
    ...overrides,
  });
  controllerRef = controller;

  let speedBeforeAutopilot: number | null = null;
  const hudForSpeed = (): { setGameSpeed?: (scale: number) => void } | null =>
    (
      engine.currentScene as {
        hud?: { setGameSpeed?: (scale: number) => void };
      } | null
    )?.hud ?? null;

  const hook: AutopilotWindowHook = {
    start: () => {
      speedBeforeAutopilot = engine.gameSpeedMultiplier;
      hudForSpeed()?.setGameSpeed?.(
        Math.max(...GAME_BALANCE.gameSpeedMultipliers),
      );
      controller.start();
    },
    stop: () => {
      controller.stop();
      if (speedBeforeAutopilot !== null) {
        hudForSpeed()?.setGameSpeed?.(speedBeforeAutopilot);
        speedBeforeAutopilot = null;
      }
    },
    toggle: () => (controller.isEngaged ? hook.stop() : hook.start()),
    get engaged() {
      return controller.isEngaged;
    },
    controller,
    flag: (note?: string) => controller.flag(note),
    exportFlags: () => exportFlags(),
  };

  if (win) {
    win.__autopilot = hook;
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
