import { Container, Graphics, Text } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { NpcShipManagerDeps } from "./NpcShipManager";
import { SeededRNG } from "@/utils/seededRNG";
import { ENCOUNTER_CONFIG, ENCOUNTER_OUTCOME_CONFIG } from "@/config/balance";
import { scaledFont } from "@/utils/fontScale";
import {
  rollEncounter,
  type Encounter,
  type EncounterType,
} from "@/systems/encounters/encounterGenerator";
import {
  resolveEncounter,
  type EncounterChoice,
  type EncounterOutcome,
} from "@/systems/encounters/encounterOutcome";
import {
  applyEncounterOutcome,
  encounterPlayerStateFor,
  encounterSystemView,
} from "@/systems/encounters/encounterFlight";
import { encounterOutcomeMessageRu } from "@/systems/encounters/encounterOutcomeText";

/** Per-type copy + accent for the exploration-encounter prompt (Task 3). */
const ENCOUNTER_PROMPT_COPY: Record<
  EncounterType,
  { title: string; desc: string; engageLabel: string; color: number }
> = {
  derelict: {
    title: "ОБЛОМОК КОРАБЛЯ",
    desc: "Дрейфующий корпус судна.\nПристыковаться и обыскать его?",
    engageLabel: "[ Обыскать ]",
    color: 0xffaa33,
  },
  anomaly: {
    title: "АНОМАЛИЯ",
    desc: "Странное пространственное возмущение.\nПросканировать его?",
    engageLabel: "[ Сканировать ]",
    color: 0x33ddff,
  },
  distress: {
    title: "СИГНАЛ SOS",
    desc: "Кто-то зовёт на помощь.\nОткликнуться на сигнал бедствия?",
    engageLabel: "[ Откликнуться ]",
    color: 0x66ff88,
  },
};

/** Toast colour for a resolved encounter: good green, bad red, neutral grey. */
function encounterOutcomeColor(kind: EncounterOutcome["kind"]): number {
  switch (kind) {
    case "salvage":
    case "bonus":
    case "rescue":
      return 0x66ff88;
    case "trap":
    case "ambush":
    case "hazard":
      return 0xff5555;
    case "ignored":
    default:
      return 0xaaaaaa;
  }
}

/**
 * Everything the encounter controller reads from (or pushes back to) the
 * owning {@link NpcShipManager} without depending on the concrete manager
 * class. Mirrors the {@link NpcInteractionController}/{@link
 * CombatPursuitController} shape (Tasks 1–2): a narrow deps bundle, owned by
 * the manager as a property, its methods forwarded 1:1.
 */
export interface EncounterControllerDeps {
  uiLayer: Container;
  getScreenSize(): { width: number; height: number };
  /** Scene-facing accessors (the manager's own {@link NpcShipManagerDeps}). */
  flight: NpcShipManagerDeps;
  getGameEngine(): GameEngine | null;
  getNpcSprites(): NpcShipSprite[];
  /** True while the OVERMIND-core prompt already owns the screen. */
  isOvermindPromptOpen(): boolean;
  /** Spawn + mount a new NPC sprite (manager owns sprite/anchor bookkeeping). */
  addNpcSprite(npc: NpcShip, entry: boolean): void;
  /** The manager's shared {@link NpcSimulator} pirate factory. */
  spawnPirateInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip;
}

/**
 * Owns the exploration-encounter cluster extracted from {@link
 * NpcShipManager} (plan Task 3): rolling a derelict/anomaly/distress
 * encounter on system entry, presenting its two-choice prompt, and applying
 * the player's response (credits/cargo/rep via the existing banking/economy
 * seams, or spawning a trap/ambush hostile into in-flight combat). The
 * overlay is transient/ephemeral — no save state.
 */
export class EncounterController {
  private overlay: Container | null = null;
  private activeEncounter: Encounter | null = null;

  constructor(private readonly deps: EncounterControllerDeps) {}

  /** True while the exploration-encounter prompt is open (Escape close-chain). */
  get isOpen(): boolean {
    return this.overlay !== null;
  }

  /**
   * The encounter currently being presented, or `null` when none is open —
   * exposed so a non-clicking driver (the dev-only live autopilot) can resolve
   * the open prompt through the real {@link applyEncounterChoice} instead of
   * only being able to blind-close it via `closeEncounterPrompt()`.
   */
  get current(): Encounter | null {
    return this.activeEncounter;
  }

  /** Tear down any open prompt overlay (manager destroy()). */
  destroy(): void {
    if (this.overlay) {
      if (!this.overlay.destroyed) {
        this.overlay.destroy({ children: true });
      }
      this.overlay = null;
      this.activeEncounter = null;
    }
  }

  /** Rebuild the open prompt at the new font scale (manager refreshFontScale()). */
  refreshFontScale(): void {
    if (this.activeEncounter && this.overlay) {
      const enc = this.activeEncounter;
      if (!this.overlay.destroyed) {
        this.overlay.destroy({ children: true });
      }
      this.overlay = null;
      this.activeEncounter = null;
      this.showEncounterPrompt(enc);
    }
  }

  /**
   * Roll a random exploration encounter for this system entry and, if one
   * fires, present its choice prompt. No-op when an OVERMIND-core or
   * encounter overlay already owns the screen, or before the galaxy/player
   * are wired.
   */
  maybeShowEntryEncounter(): void {
    // Don't pop a "dock the derelict?" modal while a fight is already underway
    // (a hostile system turns its garrison aggressive on entry, and hostile
    // space is exactly where encounters fire most often).
    if (
      (this.deps.flight.isInCombat?.() ?? false) ||
      this.deps.isOvermindPromptOpen() ||
      this.overlay
    )
      return;
    const encounter = this.rollEntryEncounter();
    if (!encounter) return;
    // The roll is deterministic by (system, day) and initialize() runs on every
    // entry into a fresh flight scene (land→take-off, star-map round trip,
    // in-session reload) WITHOUT advancing the day. Offer each (system, day)
    // encounter at most once per session, else the identical encounter re-fires
    // and a good salvage is re-claimable for free credits/cargo. Prefer the
    // shared FlightSessionState (Task 5); fall back to the GameEngine
    // accessor for fake/host setups that don't wire it.
    const session = this.deps.flight.sessionState;
    if (session) {
      if (session.hasOfferedEncounter(encounter.id)) return;
      session.markEncounterOffered(encounter.id);
    } else {
      const offered = this.deps.getGameEngine()?.offeredEncounterIds;
      if (offered) {
        if (offered.has(encounter.id)) return;
        offered.add(encounter.id);
      }
    }
    this.showEncounterPrompt(encounter);
  }

  /**
   * Pure roll seeded by (system, day): a given entry is deterministic/replay-
   * stable, yet a re-entry on a later day differs. Reads the live galaxy danger +
   * player progression. Returns null when nothing fires.
   */
  private rollEntryEncounter(): Encounter | null {
    const gameEngine = this.deps.getGameEngine();
    const galaxy = gameEngine?.galaxy;
    const player = gameEngine?.player;
    if (!galaxy || !player) return null;
    // Defensive: a lightweight host/test galaxy/player may not implement the
    // danger/rep surface the pure helpers read — skip the roll rather than throw.
    if (
      typeof galaxy.isOvermindSystem !== "function" ||
      typeof player.getReputation !== "function"
    ) {
      return null;
    }
    const systemId = player.currentSystemId;
    const seed = `${systemId}:${galaxy.gameDays}`;
    return rollEncounter(
      encounterSystemView(galaxy, systemId),
      seed,
      encounterPlayerStateFor(player),
      ENCOUNTER_CONFIG,
    );
  }

  /**
   * Resolve the player's response to a presented encounter and apply it through
   * the existing seams: credits/cargo/rep via {@link applyEncounterOutcome}, and
   * a trap/ambush's combat by spawning a hostile into the in-flight CombatModule.
   * `rng` is injectable so a test can drive a specific branch. Returns the outcome.
   */
  applyEncounterChoice(
    encounter: Encounter,
    choice: EncounterChoice,
    rng?: () => number,
  ): EncounterOutcome {
    // `rng` undefined ⇒ resolveEncounter falls back to its deterministic default
    // (seeded off encounter.id); the balance config is always supplied.
    const outcome = resolveEncounter(
      encounter,
      choice,
      rng,
      ENCOUNTER_OUTCOME_CONFIG,
    );
    const gameEngine = this.deps.getGameEngine();
    const player = gameEngine?.player;
    const galaxy = gameEngine?.galaxy;
    if (player && galaxy) {
      applyEncounterOutcome(
        {
          bank: gameEngine?.bank,
          player,
          galaxy,
          loadout: gameEngine?.playerLoadout,
        },
        encounter,
        outcome,
      );
    }
    if (outcome.startCombat) this.spawnEncounterAmbush(encounter);
    this.deps.flight.showMessage(
      this.encounterOutcomeMessage(outcome),
      encounterOutcomeColor(outcome.kind),
    );
    return outcome;
  }

  /**
   * Russian toast for a resolved outcome (the resolver's `message` is English).
   * Delegates to the shared `encounterOutcomeMessageRu` so the toast and the
   * bank-ledger reason stay in lockstep and neither leaks the raw enum kind.
   */
  private encounterOutcomeMessage(outcome: EncounterOutcome): string {
    return encounterOutcomeMessageRu(outcome);
  }

  /**
   * Spawn the hostile a trap/ambush spills into and open in-flight combat with
   * it (mirrors `OvermindBossController.spawnOvermindCoreCombatant` but a plain
   * pirate). Registered in the domain galaxy so a day-boundary refresh can't
   * despawn it mid-fight.
   */
  private spawnEncounterAmbush(encounter: Encounter): void {
    const gameEngine = this.deps.getGameEngine();
    const systemId = gameEngine?.player?.currentSystemId ?? "";
    const id = `enc-ambush:${encounter.id}`;
    if (this.deps.getNpcSprites().some((s) => s.npc.id === id)) return;
    const rng = new SeededRNG(id);
    const foe = this.deps.spawnPirateInSystem(rng, id, systemId);
    foe.name = encounter.type === "distress" ? "Засада" : "Ловушка";
    foe.markHostile();
    const galaxy = gameEngine?.galaxy;
    if (galaxy) galaxy.npcShips.push(foe);
    this.deps.addNpcSprite(foe, true);
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === id);
    if (!sprite) return;
    sprite.setAggressive(true);
    this.deps.flight.startInFlightCombat?.(sprite);
    this.deps.flight.selectCombatTarget?.(sprite);
  }

  /** Tear down the encounter prompt overlay (idempotent). */
  closeEncounterPrompt(): void {
    if (!this.overlay) return;
    const ov = this.overlay;
    this.overlay = null;
    this.activeEncounter = null;
    // Guard: a scene transition's clearUILayer() may already have destroyed it.
    queueMicrotask(() => {
      if (!ov.destroyed) ov.destroy({ children: true });
    });
  }

  /**
   * Present the two-choice prompt for a rolled encounter (engage / leave). A
   * lightweight overlay reusing the OVERMIND-core prompt's layout — engaging runs
   * {@link applyEncounterChoice}; leaving resolves it as the neutral `ignored`.
   */
  showEncounterPrompt(encounter: Encounter): void {
    if (!this.deps.getGameEngine()) return;
    this.closeEncounterPrompt();
    this.activeEncounter = encounter;
    const copy = ENCOUNTER_PROMPT_COPY[encounter.type];
    const { width, height } = this.deps.getScreenSize();

    const overlay = new Container();
    this.overlay = overlay;
    const bg = new Graphics();
    bg.roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6).fill({
      color: 0x000000,
      alpha: 0.85,
    });
    // Swallow clicks on the panel so they don't bubble to the route handler.
    bg.eventMode = "static";
    bg.on("pointerdown", (e) => e.stopPropagation());

    const border = new Graphics();
    border
      .roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6)
      .stroke({ width: 2, color: copy.color });

    const title = new Text({
      text: copy.title,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(20),
        fill: copy.color,
        fontWeight: "bold",
      },
    });
    title.anchor.set(0.5);
    title.x = width / 2;
    title.y = height / 2 - 80;
    title.eventMode = "none";

    const desc = new Text({
      text: copy.desc,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xcccccc,
        align: "center",
      },
    });
    desc.anchor.set(0.5);
    desc.x = width / 2;
    desc.y = height / 2 - 30;
    desc.eventMode = "none";

    const engageBtn = this.buildEncounterButton(
      copy.engageLabel,
      copy.color,
      () => {
        this.closeEncounterPrompt();
        this.applyEncounterChoice(encounter, "engage");
      },
    );
    engageBtn.x = width / 2 - 200;
    engageBtn.y = height / 2 + 40;

    const leaveBtn = this.buildEncounterButton("[ Уйти ]", 0x4488ff, () => {
      this.closeEncounterPrompt();
      this.applyEncounterChoice(encounter, "ignore");
    });
    leaveBtn.x = width / 2 + 20;
    leaveBtn.y = height / 2 + 40;

    overlay.addChild(bg, border, title, desc, engageBtn, leaveBtn);
    this.deps.uiLayer.addChild(overlay);
  }

  /** Build one labelled prompt button wired to `onPress` (stops propagation). */
  private buildEncounterButton(
    label: string,
    color: number,
    onPress: () => void,
  ): Container {
    const btn = new Container();
    const g = new Graphics();
    g.roundRect(0, 0, 180, 36, 4)
      .fill({ color: 0x111820 })
      .stroke({ width: 1, color });
    const text = new Text({
      text: label,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: color,
      },
    });
    text.x = 8;
    text.y = 9;
    text.eventMode = "none";
    btn.addChild(g, text);
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      onPress();
    });
    return btn;
  }
}
