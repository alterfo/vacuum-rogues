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

  // Task 2 (docs/plans/20260712-autopilot-live-tick-symptoms.md) — grace flags
  // for the quest-journal/settings panel and the planet-info panel. `tick()`
  // used to close either panel unconditionally the instant it saw it open,
  // which raced a human who had just opened it manually (confirmed via a
  // real-engine probe: zero ticks of survival). Each flag lets a panel that
  // OPENS MID-SESSION survive the tick that first observes it open — closing
  // only fires on a later tick if it's still open then, preserving the
  // original idle-panel auto-dismiss this code exists for. A panel that is
  // already open on this controller's very first-ever tick call (`tickCount
  // <= 1`) is treated as a stale leftover from before the autopilot engaged
  // — exactly the idle-panel case the original fix targeted — and still
  // closes immediately, with no grace.
  //
  // Caveat (review, 2026-07-12): the probe that "confirmed" this race calls
  // `hud.toggleQuestJournal()`/`planetManager.handlePlanetClick()` directly,
  // not through a real DOM dispatch. In a genuine browser session, the same
  // native keydown/pointerdown that opens one of these panels also bubbles to
  // `window` and hits `AutopilotController`'s reclaim-on-input listener
  // (subscribed at `start()`), disengaging the autopilot in that same
  // synchronous event — exactly the hazard the encounter-overlay branch above
  // documents and works around. So this grace window may rarely or never
  // trigger via real mouse/keyboard input; it has not been confirmed reachable
  // outside the direct-call probe. See the plan's Task 1 finding for symptom 3.
  let tickCount = 0;
  let questJournalGraceGiven = false;
  let settingsPanelGraceGiven = false;
  let planetInfoGraceGiven = false;
  let systemMenuGraceGiven = false;

  /**
   * Auto-dismiss the "always close on sight, no grace" blocking surfaces —
   * onboarding help panel, any manager-owned modal (NPC contact panel /
   * OVERMIND-core overlay / exploration-encounter prompt), and a stuck
   * active-pause («Огонь!») overlay. Exposed as its own `LiveSceneController`
   * verb (not just inlined in `tick()`) so `AutopilotController.tickOnce()`
   * can run it as a gate BEFORE the policy decides — live-session finding
   * 2026-07-12: a distant pirate's shakedown hail (`openShakedownHail`) opens
   * the manager-owned modal AND calls `endTurn()`, but `observe()` has no
   * notion of either fact, so the policy still sees the hostile and legally
   * picks `attack`/`flee`. Those verbs dispatch straight to their own
   * executors (`LiveApplier.applyLiveAction` only routes `wait`/`move`
   * through `tick()`), so the panel was never closed — a silent, permanent
   * hang. Gating every tick on this check, not just wait/move, closes that
   * hole for every action kind, not only the ones a given surface happened
   * to be reachable from today.
   *
   * The active-pause branch has the same shape for a different reason (also
   * live-session, 2026-07-12): a multi-ship Жнец garrison re-triggers
   * `combatPause` faster than a single per-verb resume can make progress.
   * `attack()`/`flee()` already resume/confirm it themselves, but `warp()`'s
   * own resume only runs once the scene has ALREADY reached STAR_MAP — from
   * SPACE_FLIGHT, a `warp` decision dispatches to `openStarMap()` FIRST
   * (`LiveApplier`'s two-step warp), which had no pause awareness at all. A
   * heavy garrison attack re-pauses combat before that first `openStarMap()`
   * call's scene transition can land, so the ship never leaves SPACE_FLIGHT
   * and the flee-stagnant-jump escape valve never actually fires — confirmed
   * live: `combatPause.paused` stayed `true` across a full 10 s window with
   * zero net ship displacement. Resuming (declining to fire) up front, before
   * ANY verb runs, covers every dispatch path uniformly instead of requiring
   * each new verb to remember its own resume.
   */
  function dismissBlockingModal(): boolean {
    // Auto-dismiss any open onboarding/contextual-help panel (F3, live-session
    // finding): a full-screen help panel blocks a real player's pointer, but
    // the autopilot keeps acting through the port UNDER it and never
    // dismisses on its own. `isHelpPanelOpen`/`dismissHelpPanel` are the
    // module-level query+dismiss seam `mountSceneHelp`/`showHelpOnce` expose
    // for exactly this (no scene reference needed). Never freezes the turn,
    // so no restart is needed here.
    if (isHelpPanelOpen()) {
      dismissHelpPanel();
      return true;
    }
    // Customs-inspection modal (PlanetScene, live report 2026-07-19: "unclear
    // what the autopilot does when caught with contraband"). Unlike the
    // encounter prompt, this is a PLANET-scene blocking overlay; without a seam
    // the autopilot keeps issuing PLANET actions underneath it while a human
    // sees a stuck modal. Resolve it the same way the encounter prompt is
    // resolved: prefer the cheapest clearance (bribe — no reputation cost),
    // falling back to dumping the cargo when the bribe is unaffordable (dump
    // always succeeds). Checked before the SPACE_FLIGHT npcManager branch below,
    // which never applies on the PLANET scene anyway.
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
    // Exploration encounters (derelict/anomaly/distress) are worth resolving
    // for real, not just clearing on sight (live report, 2026-07-19): "engage"
    // is the choice that actually rolls the reward/risk outcome
    // (applyEncounterChoice → resolveEncounter); the blanket closeModals()
    // below used to blind-dismiss this prompt exactly like the contact-panel/
    // OVERMIND overlays it also covers, silently forfeiting every encounter
    // the autopilot ever rolled. Checked BEFORE the generic branch so contact
    // -panel/OVERMIND dismissal below is completely unchanged.
    //
    // CRITICAL: close the prompt FIRST, exactly like the real UI button
    // (`EncounterController`'s engage-button handler calls
    // `closeEncounterPrompt()` before `applyEncounterChoice()`) — a 2026-07-19
    // live regression in this fix's first version called only
    // `applyEncounterChoice` and never closed the prompt, so `activeEncounter`
    // stayed set and the NEXT tick's `dismissBlockingModal()` saw the same
    // still-open prompt and applied "engage" again, forever (infinite credits
    // from the same anomaly/derelict, confirmed live: "+300 кр" repeating).
    if (
      scene?.npcManager?.isEncounterPromptOpen &&
      scene.npcManager.activeEncounter
    ) {
      const encounter = scene.npcManager.activeEncounter;
      scene.npcManager.closeEncounterPrompt?.();
      scene.npcManager.applyEncounterChoice?.(encounter, "engage");
      return true;
    }
    // OVERMIND-core boss prompt — the real win-condition fight. `hasOpenModal()`
    // below also covers this surface, and its blanket `closeModals()` closes it
    // exactly like clicking «Отступить» (retreat) — so the autopilot never once
    // pressed «Атаковать ядро» (`spawnOvermindCoreCombatant()`, the win fight).
    // Checked FIRST, ahead of the generic branch, so the boss prompt gets a real
    // attack-vs-retreat decision instead of an unconditional retreat. Reuses
    // `MemoryHeuristicPolicy`'s existing battle-ready + hull-fraction signals (no
    // new threat math): attack the core only when the ship is capability-battle-
    // ready AND its hull is healthy (≥ the same `OVERMIND_THREAT_HULL_FRACTION`
    // the front-avoidance branch flees under); otherwise fall through to the
    // existing `closeModals()` retreat path — the safe default is unchanged.
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
      // Not ready to win the fight — retreat exactly like the old blanket path.
      scene.npcManager.closeModals?.();
      return true;
    }
    // Pirate shakedown hail — «Кошелёк или жизнь!». The generic `hasOpenModal()`
    // branch below also covers this contact-panel surface, and its blanket
    // `closeModals()` closes it exactly like declining outright — so the
    // autopilot never once paid tribute, fought, or fled a shakedown; it just
    // silently forfeited every one (and the panel's `endTurn()` froze the turn
    // until the generic re-arm below fired). Checked FIRST, ahead of the generic
    // branch, so it gets a real pay/attack/flee decision reusing the same
    // hull-fraction signals the rest of the policy already uses (no new threat
    // math): fight when capability-battle-ready AND hull healthy (≥ the
    // `OVERMIND_THREAT_HULL_FRACTION` the boss branch also uses), flee when
    // genuinely hurt (`hull < LOW_HULL_FRACTION`, the flee-vs-fight cutoff the
    // base ladder uses), else pay the pirate off and move on. Each real handler
    // (`onPayTribute`/`onFleeShakedown`/`onAttackNpc`) closes the panel AND
    // re-arms the frozen turn itself, so no `e2eStartTurn()` re-arm is needed
    // here; a headless double lacking these methods falls through to the generic
    // `closeModals()` + `e2eStartTurn()` re-arm path below unchanged.
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
      // No real handler available (headless double) — fall through to the
      // generic closeModals() + e2eStartTurn() re-arm path below.
    }
    // Auto-dismiss any open contact-panel/OVERMIND overlay so the autopilot
    // keeps flying without a human pointer click. A click on the overlay's
    // dismiss button fires a native `pointerdown` that bubbles to `window`,
    // triggering reclaim-on-input → stop(). Driving the close
    // programmatically via closeModals() bypasses that race entirely.
    if (scene?.npcManager?.hasOpenModal?.()) {
      scene.npcManager.closeModals?.();
      // Only a pirate's shakedown hail (of the surfaces `hasOpenModal()`
      // covers) calls `endTurn()` before opening — closing it programmatically
      // (no human follow-up click) would otherwise leave `isTurnRunning`
      // frozen forever. Re-arm it under the exact same safe-to-restart guard
      // `tick()`'s idle restart uses below, so this can't step on a route or
      // fight already under way (and is a no-op for the encounter/OVERMIND
      // overlays, which never freeze the turn to begin with).
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

  // Drive the REAL TRADE scene's buy/sell seam, then leave back to
  // SPACE_FLIGHT (Task 4, docs/plans/20260727-autopilot-ui-parity-fixes.md).
  // Shared by `openTrade` (the live PLANET→TRADE→FLIGHT round trip) and the
  // LiveApplier's scene-aware `executeTrade` fallback (already in TRADE). The
  // buy/sell decision + reserve-cap math is identical to the old domain bypass
  // — it just runs through `TradeScene`'s `e2eBuyItem`/`e2eSellItem` so it
  // drives the real market UI. Leaving to SPACE_FLIGHT afterwards is essential:
  // the policy's TRADE case pushes `trade` before `move`, so without leaving
  // the agent re-picks `trade` every tick and re-sells the just-bought lot
  // forever (a land↔trade spin the two-step must not create) — this mirrors the
  // headless applier's `goTo(...)`-after-trade in PlayerAgent.ts.
  const runLiveTrade = async (): Promise<void> => {
    const scene = engine.currentScene as {
      e2eBuyItem?: (r: ResourceType, qty: number) => boolean;
      e2eSellItem?: (r: ResourceType, qty: number) => boolean;
    } | null;
    if (!scene?.e2eBuyItem || !scene.e2eSellItem) {
      // Not in a live market (headless double / no TradeScene) — safe no-op,
      // no scene transition (mock-engine callers stay put).
      return;
    }
    const sys = currentSystem(engine);
    const planet = landedPlanet(engine) ?? sys?.planets[0];
    const player = engine.player;
    if (!planet || !player) return;
    // A carried DELIVERY quest's unmet cargo need wins first (never
    // speculative — capped to the exact shortfall, only when profitable),
    // otherwise the best known cross-planet margin's good, but ONLY when this
    // planet is that margin's own cheap buy planet — else `null` (sell-only).
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
      if (dismissBlockingModal()) return;

      // Mirror the same auto-dismiss for the two other blocking-modal
      // registries the live scene owns: the quest journal / accessibility
      // panel (`FlightHud.closeModals()`) and the planet info panel
      // (`PlanetManager.closeInfoPanel()`). Without this the autopilot sat
      // silently idle behind either panel — it keeps acting through the port
      // underneath, so a human never sees a decision fire until they close
      // the panel themselves (reported as "dropped off").
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
        // `closeModals()` is a bulk close shared by the journal AND the
        // settings/accessibility panel — it has no per-panel granularity. The
        // two panels are independently openable (neither toggle closes the
        // other), so both can be open at once. Closing while either one is
        // still mid-grace would destroy the OTHER as collateral damage — e.g.
        // a human opens the settings panel while the journal (already open a
        // tick) is idle-and-due-to-close; without this check the settings
        // panel would vanish having never gotten its own grace tick. Only
        // actually close once EVERY currently-open panel in this shared
        // registry agrees it's due.
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
        // At least one panel still wants its grace tick — defer closing
        // either, granting grace to whichever is open and hasn't had it yet.
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

      // Mirror the same auto-dismiss for the in-flight system menu — a third,
      // separate blocking-modal registry the live scene owns
      // (`FlightHud.isSystemModalOpen()` / `closeSystemMenu()`). The real
      // engine's `SpaceFlightScene.isBlockingModalOpen()` already treats an open
      // «[МЕНЮ]» (and its load-confirm sub-panel) as blocking, so if it's ever
      // open when the live autopilot ticks the agent would sit idle behind it
      // forever. Use the same grace gate as the planet-info block above: a
      // stale-leftover menu open on the very first tick closes immediately, a
      // menu a human opens mid-session survives one tick before being closed.
      // Close via the menu's own `closeSystemMenu()` (its own registry — the
      // bulk `hud.closeModals()` never touches it, FlightHud.ts).
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

      // F7 (live-session finding): a stationary "wait" decision needs an
      // actively RUNNING turn for `SpaceFlightScene.advanceWaitTime` to accrue
      // days — the Space-Rangers turn model gates it on `isTurnRunning`, and
      // the live rAF loop never starts one on its own (only a route/committed
      // jump does, via `executeRouteTo`). Press "Ход" (`e2eStartTurn`, the
      // same seam E2E specs use — idempotent, it no-ops if already running)
      // whenever the ship is genuinely idle: not moving, no pending warp/
      // planned route (both handled above), no turn already running, no
      // active fight. Without this a stagnation-wait loops forever with the
      // calendar frozen (measured: 8.9 min stuck at day 0).
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
      if (!station) return;

      // Physically route the ship to the station so it actually flies there —
      // the live report (2026-07-19) the old always-teleport behavior caused:
      // "sometimes the autopilot teleports to the shipyard/dock instead of
      // flying to it." Mirrors `land()`'s real-route branch: set the station as
      // the live scene's own route target and drive `executeRouteTo`, exactly
      // like a human clicking the station marker (`PlanetManager.onStationClick`
      // → `SpaceFlightScene.handleStationDock`) — the scene's own proactive
      // docking (`updateShip`, `DOCKING_RANGE`) fires `onDockAtStation` once the
      // ship is close enough, which already refuels/transitions for real, so no
      // manual refuel/scene-transition is needed on this path.
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

      // Headless/no-route-available fallback: teleport, unchanged from before.
      // Save the position the same way openStarMap() saves the pre-warp
      // position below: the SPACE_FLIGHT entry logic only ever reads
      // `lastFlightShipPos`, so without this, undocking falls back to the
      // plain system-edge spawn (confirmed live, 2026-07-12: dock right after a
      // fresh warp-in, then undock — the ship was back at the system boundary
      // instead of by the station it supposedly just left).
      if (marker) {
        engine.lastFlightShipPos = { x: marker.x, y: marker.y };
      }
      await goTo(SceneType.STATION, { station });
      const ship = engine.player?.ship;
      if (ship) ship.energy = ship.maxEnergy;
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
    async warp(systemId, reason) {
      // Resume the active-pause overlay first, mirroring `flee()`'s own guard
      // (decline to fire, don't freeze on it) — needed since the SPACE_FLIGHT
      // survive tier's `flee-stagnant-jump` escalation (a fold-stagnant flee
      // standoff) can push `warp` while combat-pause is open. Without this,
      // `performWarpJumpTo` below either no-ops or races the frozen overlay,
      // and the next tick re-observes the same outmatched/stagnant hostile and
      // re-picks `warp` again — a live combat-pause deadlock, confirmed live
      // (2026-07-12): the ship parked on the «Огонь!» overlay instead of the
      // system boundary, the exact failure mode `flee-stagnant-jump` exists to
      // break out of.
      const pauseScene = engine.currentScene as {
        combatPause?: { paused?: boolean; resume?: () => void };
      } | null;
      if (
        pauseScene?.combatPause?.paused &&
        typeof pauseScene.combatPause.resume === "function"
      ) {
        pauseScene.combatPause.resume();
      }
      // Same guard for the pause-and-plan freeze (Task 14.5): a warp escape
      // decided during PLANNING confirms an empty-weapons draft so the ship
      // can actually run for the edge instead of freezing on the draft.
      confirmPlanningIfOpen(pauseScene, { assignWeapons: false });
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
      // then falls back to connections[0] — prevents ping-pong. A
      // `find-sell-destination` warp deliberately stays blind to the carried
      // quest's target (same exclusion PlayerAgent's headless applier uses).
      // Avoid + never-steer-at hostile-held systems (Task 7), mirroring
      // PlayerAgent's headless resolution exactly: pirate dens included, and
      // a hostile target/destination degrades to the blind safe pick.
      const hostileHeld = new Set([
        ...(engine.galaxy?.overmindSystems ?? []),
        ...(engine.galaxy?.pirateSystems ?? []),
      ]);
      // Cargo-need-aware projection (Task 9, live report #11) mirroring
      // `buildQuestSnapshots`, inlined with optional chaining rather than
      // calling it directly: this applier-level fallback runs off the raw
      // `Quest` domain objects, which real production quests always carry
      // `.objectives`/a real player inventory for, but which minimal test
      // doubles legitimately omit — this stays a safe no-op (collectItem:
      // null, i.e. "ready", the pre-fix behavior) on those instead of
      // throwing.
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
        systemId != null &&
        !hostileHeld.has(systemId) &&
        connections.some((c) => c.toSystemId === systemId)
          ? systemId
          : undefined;
      // A non-adjacent `systemId` naming a real system is a DESTINATION
      // (e.g. `go-restock`'s remembered buy system, Task 7) — route toward it
      // hop-by-hop, mirroring PlayerAgent's headless destination resolution.
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
      // Open the REAL market scene rather than trading through a domain bypass
      // (Task 4, docs/plans/20260727-autopilot-ui-parity-fixes.md). The prior
      // bypass existed because opening TRADE and then immediately leaving
      // ("leave-market" without buying) never acquired cargo — that gap is now
      // closed by the live `executeTrade()` below, which drives the real
      // buy/sell on the next tick. This mirrors the headless two-step
      // PLANET→TRADE→execute shape (MemoryHeuristicPolicy.ts:2086): the
      // policy's TRADE-scene branch pushes `trade` (→ `executeTrade`) then
      // `move` (→ back to SPACE_FLIGHT).
      const sys = currentSystem(engine);
      const planet =
        landedPlanet(engine) ??
        sys?.planets.find((p) => p.id === planetId) ??
        sys?.planets[0];
      if (planet) {
        await goTo(SceneType.TRADE, { planet });
        // Realise the buy/sell through the just-opened real TRADE scene, then
        // `runLiveTrade` leaves back to SPACE_FLIGHT. On a headless double /
        // mock engine (no e2e seams) this is a safe no-op and the ship stays
        // on the TRADE transition the applier asserted.
        await runLiveTrade();
        return;
      }
      // No resolvable planet (empty system / headless double) — don't strand on
      // the planet; back out to flight so the next tick can re-decide.
      await goTo(SceneType.SPACE_FLIGHT);
    },
    async executeTrade() {
      // LiveApplier fallback: when the agent is observed already inside the
      // TRADE scene, drive the same real buy/sell + leave that `openTrade`
      // performs on the PLANET→TRADE→FLIGHT round trip (Task 4).
      await runLiveTrade();
    },
    takeQuest() {
      // Drive the real job-board panel when it's reachable (live report,
      // 2026-07-19: watching the autopilot never showed it browsing the
      // market/quests/info-bureau even though it clearly does) — same
      // selection logic either way (`acceptBoardQuests`'s own filtering), this
      // only makes the accept visible via `PlanetScene`'s e2e seam instead of
      // a silent domain-only call. Unlike `openTrade` below, this carries NO
      // regression risk: quest selection never depended on the panel being
      // open, so there is no "leaves without acting" failure mode to trigger.
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
      // Pause-and-plan loop (Task 14.5): while the tactical PLANNING freeze is
      // open, an attack decision means "assign every weapon to the target,
      // steer at it, confirm" — the exact assign-and-«Ход» a human runs. The
      // next planning phase (after the execute window) re-lands here via the
      // policy's next attack pick, so the fight resolves round by round.
      if (
        confirmPlanningIfOpen(scene, {
          preferredTargetId: targetId,
          closeOnTarget: true,
        })
      ) {
        return;
      }
      // When combat is on the active-pause overlay, pressing «Огонь!» is what
      // fires — `combatPause.confirm()` shoots one aimed shot and resumes time.
      // Without this the overlay sits open forever and the ship freezes
      // mid-fight (the exact "can't react to the Fire modal / stands still"
      // bug): the headless applier already un-freezes the same pause via
      // `combatPause.resume()`, but the live executor only *engaged* combat and
      // never drove the overlay. Confirm on each tick the pause re-arms so the
      // fight actually resolves shot by shot.
      if (
        scene?.combatPause?.paused &&
        typeof scene.combatPause.confirm === "function"
      ) {
        scene.combatPause.confirm();
        return;
      }
      // An already-engaged fight is DRIVEN by the planning loop, never
      // re-targeted (mirror of PlayerAgent.driveAttack's alreadyFighting
      // guard): during a 3 s execute window the 800 ms tick lands here with
      // PLANNING closed, and falling through to onAttackNpc would re-plot an
      // intercept each tick (clobbering the just-confirmed course via
      // breakOffCombatPursuit) — and via the stale-id `?? npcSprites[0]`
      // fallback below could escalateHostility on an arbitrary neutral
      // (review 2026-07-15).
      if (scene?.combatModule?.isActive) return;
      // Route through the real "Атаковать" handler — the exact one the
      // contact-panel button calls — rather than the `e2eEngageCombat` E2E
      // seam. That seam is built for staging a deterministic test fight
      // (paired with `e2eForceAggressorInRange`): it registers the target as
      // a combatant UNCONDITIONALLY, no range check at all. `observe()`'s
      // hostile list has no distance filter either — any hostile anywhere in
      // the system is a legal "attack" target — so the policy can pick one
      // thousands of pixels away. Confirmed live (2026-07-12): right after a
      // warp-in the policy attacked a system-wide hostile ~3500px off,
      // `combatModule.isActive` latched true with that unreachable NPC as the
      // sole combatant, and the ship just sat there — no pursuit, no fire,
      // "under attack" with nothing nearby, forever (the stale engagement
      // also never self-prunes: `pruneDisengaged` only runs while the turn is
      // running, and `isTurnRunning` never restarts because `dismissBlockingModal`'s
      // idle-restart deliberately refuses while `combatModule.isActive` is
      // true — a genuine catch-22). `onAttackNpc` does the real player's own
      // range check: pursues (plots an intercept route, which itself re-arms
      // the turn) when out of range, engages only once actually in weapon
      // range — exactly like a human clicking «Атаковать».
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
      // Fallback for hosts/tests that only model the narrower E2E seam.
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
      // Resume the active-pause overlay first (decline to fire) so time isn't
      // frozen on it, then break off pursuit — mirrors the player dismissing
      // «Огонь!» with «Продолжить» and plotting a manual disengage. Without the
      // resume, a flee decision taken while the overlay is up would leave the
      // ship frozen on the overlay instead of actually breaking away.
      if (
        scene?.combatPause?.paused &&
        typeof scene.combatPause.resume === "function"
      ) {
        scene.combatPause.resume();
      }
      scene?.npcManager?.breakOffCombatPursuit?.();

      // F8 (live-session finding): breaking off pursuit ALONE leaves the ship
      // with no course at all — `breakOffCombatPursuit` only yields the
      // auto-track steering, it never plots a route, so a real player's flee
      // (a click away from the threat) has no live-autopilot equivalent and
      // the ship freezes mid-space (shipPhysics.targetX/Y == shipX/Y exactly,
      // isMoving=false, forever). Drive an actual escape: the same radially-
      // outward-from-ship near-edge point `warpEdgePoint(..., fromMidSystem:
      // true)` computes for a COMMITTED flee-jump (Task 9 (iv)) — any
      // direction away from the system centre needs no star-avoidance detour
      // and is a real, immediate escape vector, not just a steering release.
      // Skipped while a jump is already pending/in transit (that flee path is
      // the committed-warp near-edge routing, not this one) or already moving
      // (don't reset an in-progress escape route every tick).
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
      // Pause-and-plan loop (Task 14.5): a flee decision during the PLANNING
      // freeze confirms an empty-weapons draft — deliberate hold-fire-and-run.
      // The escape route plotted above (or an in-progress one) survives the
      // confirm (a null destination leaves the current course untouched).
      confirmPlanningIfOpen(scene, { assignWeapons: false });
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
    armUp() {
      executeArmUp(engine);
    },
    liberate() {
      engine.liberateCurrentSystem();
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
  // F6 (live-session finding): AgentMemory must not survive a «Новая игра»
  // restart while the autopilot stays continuously engaged across it (that
  // path never calls `AutopilotController.start()`, the usual reset seam).
  // Detected by galaxy IDENTITY, not just presence — `GalaxySimulator`
  // constructs a fresh `Galaxy` with a new id every new game/generation.
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
    // Game Over / Win screen ⇒ self-stop rather than spin on the sole legal
    // "wait" forever (2026-07-18 live report).
    isTerminal: () =>
      engine.currentSceneType === SceneType.GAME_OVER ||
      engine.currentSceneType === SceneType.WIN_SCREEN,
    ...overrides,
  });
  controllerRef = controller;

  // Auto-max speed on engage (2026-07-18 request): the autopilot is dull to
  // watch at 1×, so engaging it jumps straight to the fastest selectable
  // `GAME_BALANCE.gameSpeedMultipliers` tier (10×) and disengaging restores
  // whatever the player had picked before — mirrors `FlightHud`'s own
  // persist/restore contract (`restoreGameSpeed`) rather than inventing a
  // second one. `hud` is read fresh each call (not captured once) since a
  // land/take-off rebuilds the HUD instance between engage and disengage.
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
