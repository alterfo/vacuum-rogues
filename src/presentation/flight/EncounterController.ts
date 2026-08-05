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

export interface EncounterControllerDeps {
  uiLayer: Container;
  getScreenSize(): { width: number; height: number };
  flight: NpcShipManagerDeps;
  getGameEngine(): GameEngine | null;
  getNpcSprites(): NpcShipSprite[];
  isOvermindPromptOpen(): boolean;
  addNpcSprite(npc: NpcShip, entry: boolean): void;
  spawnPirateInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip;
}

export class EncounterController {
  private overlay: Container | null = null;
  private activeEncounter: Encounter | null = null;

  constructor(private readonly deps: EncounterControllerDeps) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  get current(): Encounter | null {
    return this.activeEncounter;
  }

  destroy(): void {
    if (this.overlay) {
      if (!this.overlay.destroyed) {
        this.overlay.destroy({ children: true });
      }
      this.overlay = null;
      this.activeEncounter = null;
    }
  }

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

  maybeShowEntryEncounter(): void {
    if (
      (this.deps.flight.isInCombat?.() ?? false) ||
      this.deps.isOvermindPromptOpen() ||
      this.overlay
    )
      return;
    const encounter = this.rollEntryEncounter();
    if (!encounter) return;
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

  private rollEntryEncounter(): Encounter | null {
    const gameEngine = this.deps.getGameEngine();
    const galaxy = gameEngine?.galaxy;
    const player = gameEngine?.player;
    if (!galaxy || !player) return null;
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

  applyEncounterChoice(
    encounter: Encounter,
    choice: EncounterChoice,
    rng?: () => number,
  ): EncounterOutcome {
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

  private encounterOutcomeMessage(outcome: EncounterOutcome): string {
    return encounterOutcomeMessageRu(outcome);
  }

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

  closeEncounterPrompt(): void {
    if (!this.overlay) return;
    const ov = this.overlay;
    this.overlay = null;
    this.activeEncounter = null;
    queueMicrotask(() => {
      if (!ov.destroyed) ov.destroy({ children: true });
    });
  }

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
