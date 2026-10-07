import { GameScene } from "./GameScene";
import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { JobBoardPanel } from "./JobBoardPanel";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import { TradeSystem } from "@/systems/TradeSystem";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import {
  payCustomsFine,
  standingRecoveryHint,
} from "@/systems/galaxy/landingAccess";
import { QuestType } from "@/types";
import type { ResourceType } from "@/types";
import { evaluateDelivery } from "@/systems/quests/deliveryCompletion";
import { resourceLabelRu } from "@/domain/RouteRumor";
import { pickVariantKey, panoramaTex, tex, loadTextureAsync } from "./textures";
import { scaledFont } from "@/utils/fontScale";
import { planetBackdropTint } from "@/utils/instanceTint";
import { UiButton, type ButtonAccent } from "./ui/UiButton";
import { factionColor as resolveFactionColor } from "./ui/palette";
import { Faction } from "@/types/faction";
import { factionDisplayLabel } from "@/config/factionConfig";
import { capturedSystemOccupierName } from "@/utils/planetTooltip";
import { mountSceneHelp, helpButtonRect } from "./ui/mountSceneHelp";
import { getRepLabel, getRepColor } from "@/utils/reputationUtils";
import {
  economyLabel,
  politicalLabel,
  resolvePopulation,
  formatPopulation,
} from "./ui/planetProfile";
import { applyLoadoutHullToShip } from "@/systems/equipment/GearBridge";
import { hullStatus } from "@/systems/equipment/hullStatus";
import { launchDenialReason } from "@/systems/equipment/launchDenial";
import { t } from "@/i18n/i18n";

interface PlanetContext {
  gameEngine?: GameEngine;
  planet?: Planet;
  resumeTextQuest?: boolean;
}

export interface PlanetServiceButton {
  label: string;
  color: number;
  action: () => void;
}

interface ServiceButtonDef {
  icon: string;
  label: string;
  accent: ButtonAccent | number;
  action: () => void;
}

export function visiblePlanetServices<T extends { label: string }>(
  isHabitable: boolean,
  buttons: T[],
): T[] {
  if (isHabitable) return buttons;
  return buttons.filter((b) => b.label === "Взлёт");
}

const PANORAMA_PARALLAX_MAX = 30;

export function computeParallaxTargetX(
  mouseX: number,
  screenWidth: number,
  baseX: number,
  maxOffset: number,
): number {
  const norm = (mouseX / screenWidth) * 2 - 1;
  return baseX + norm * maxOffset;
}

export function clampPanoramaX(
  x: number,
  panoramaWidth: number,
  screenWidth: number,
): number {
  if (panoramaWidth <= screenWidth) return (screenWidth - panoramaWidth) / 2;
  const min = screenWidth - panoramaWidth; // negative — right edge of pan range
  return Math.max(min, Math.min(0, x));
}

export function skyGradientColors(baseColor: number, steps: number): number[] {
  const br = (baseColor >> 16) & 0xff;
  const bg = (baseColor >> 8) & 0xff;
  const bb = baseColor & 0xff;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps <= 1 ? 1 : i / (steps - 1); // 0 at top → 1 at bottom
    const mix = t * 0.45;
    const r = Math.round(0x02 + (br - 0x02) * mix);
    const g = Math.round(0x03 + (bg - 0x03) * mix);
    const b = Math.round(0x0a + (bb - 0x0a) * mix);
    out.push((r << 16) | (g << 8) | b);
  }
  return out;
}

const BRIBE_COST = 500;
const PLANET_VISUAL_RADIUS = 196;

export const PLANET_BACKDROP_OVERLAY_ALPHA = 0.28;

export interface StarMapTier {
  hops: number;
  cost: number;
  label: string;
}
const STAR_MAP_TIERS: StarMapTier[] = [
  { hops: 1, cost: 500, label: "Ближняя (1 переход)" },
  { hops: 2, cost: 1500, label: "Средняя (2 перехода)" },
  { hops: 3, cost: 4000, label: "Дальняя (3 перехода)" },
];

const FACTION_PANORAMA: Record<string, string> = {
  OUTLANDERS: "outlanders_city",
  BASTIONS: "bastions_city",
  SYNDICATE: "syndicate_city",
  PARADOXES: "paradoxes_city",
  PROGRESSORS: "progressors_city",
  INDEPENDENT: "wilderness_jungle",
  OVERMIND: "wilderness_tundra",
};

const DANGER_ROW_GAP_STEPS = 0.5;

export function computePlanetMenuLayout(
  screenH: number,
  contentBottomY: number,
  count: number,
  dangerRows: number = 0,
): { btnStartY: number; btnStep: number; btnH: number; dangerGap: number } {
  const bottomMargin = 16;
  const btnStartY = contentBottomY + 36;
  const avail = Math.max(0, screenH - bottomMargin - btnStartY);
  const slots =
    Math.max(0, count) + DANGER_ROW_GAP_STEPS * Math.max(0, dangerRows);
  const btnStep = slots > 0 ? Math.min(38, avail / slots) : 32;
  const btnH = Math.min(
    Math.max(20, Math.min(Math.floor(btnStep) - 2, 32)),
    Math.floor(btnStep),
  );
  const dangerGap = dangerRows > 0 ? DANGER_ROW_GAP_STEPS * btnStep : 0;
  return { btnStartY, btnStep, btnH, dangerGap };
}

export function creditsHudAnchor(screenWidth: number): {
  x: number;
  y: number;
} {
  const reserved = helpButtonRect(screenWidth);
  const GAP = 10;
  return { x: reserved.x - GAP, y: 16 };
}

const PANORAMA_FALLBACK = "outlanders_city";

const WILDERNESS_PANORAMA: Record<string, string> = {
  ICE: "wilderness_tundra",
  VOLCANIC: "wilderness_desert",
  GAS_GIANT: "wilderness_desert", // no surface — neutral barren backdrop
  TERRESTRIAL: "wilderness_jungle",
  HABITAT: "wilderness_jungle",
  INDUSTRIAL: "wilderness_desert",
};

export function panoramaKeyForPlanet(
  planetType: string,
  faction: string,
  isHabitable: boolean = false,
): string {
  if (isHabitable) {
    const city = FACTION_PANORAMA[faction];
    if (city && city.endsWith("_city")) return city;
    return "wilderness_jungle";
  }
  return WILDERNESS_PANORAMA[planetType] ?? "wilderness_jungle";
}

const PLANET_BIOME: Record<string, string> = {
  ICE: "ice",
  VOLCANIC: "volcanic",
  GAS_GIANT: "gas",
  TERRESTRIAL: "terran",
  INDUSTRIAL: "industrial",
  HABITAT: "city",
};

export function resolvePlanetBackdropKey(
  planetType: string,
  planetId: string,
  faction: string,
  isHabitable: boolean = false,
): string {
  const biome = PLANET_BIOME[planetType] ?? "terran";
  const surfaceKey = pickVariantKey("surfaces", biome, planetId);
  if (surfaceKey) return surfaceKey;
  return `panoramas/${panoramaKeyForPlanet(planetType, faction, isHabitable)}`;
}

const RESOURCE_RU: Record<string, string> = {
  FUEL: "Топливо",
  METALS: "Металлы",
  CRYSTALS: "Кристаллы",
  ORGANICS: "Органика",
  ARTIFACTS: "Артефакты",
  WEAPONS: "Оружие",
  MEDICINE: "Медикаменты",
  ELECTRONICS: "Электроника",
  LUXURY: "Роскошь",
  DATA_CORES: "Ядра данных",
};

export function planetTypeLabel(type: string): string {
  const t: Record<string, string> = {
    TERRESTRIAL: "Земной",
    GAS_GIANT: "Газовый гигант",
    ICE: "Ледяной",
    VOLCANIC: "Вулканический",
    INDUSTRIAL: "Промышленный",
    HABITAT: "Обитаемый",
  };
  return t[type] ?? type;
}

export function planetInfoPanelLines(input: {
  planetType: string;
  isHabitable: boolean;
  factionName: string;
  economyType?: string | null;
  politicalSystem?: string | null;
  population?: number;
  populationSeed: string;
}): { subtitle: string; faction: string; profile: string | null } {
  const subtitle = `${planetTypeLabel(input.planetType)} • ${
    input.isHabitable ? "Обитаемая" : "Необитаемая"
  }`;
  const profile = input.isHabitable
    ? `Население: ${formatPopulation(
        resolvePopulation(input.population, input.populationSeed),
      )}  •  ${economyLabel(input.economyType)}  •  ${politicalLabel(
        input.politicalSystem,
      )}`
    : null;
  return { subtitle, faction: input.factionName, profile };
}

export class PlanetScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private uiContainer: Container | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private jobBoardPanel: JobBoardPanel | null = null;
  private creditsHudText: Text | null = null;
  private helpTeardown: (() => void) | null = null;
  private bribed = false;
  private suppressTextQuestResume = false;
  private customsModal: Container | null = null;
  private customsContext: {
    illegalGoods: { type: ResourceType; amount: number }[];
    penalty: number;
    bribeCost: number;
    faction: string;
  } | null = null;

  private panoramaSprite: Sprite | null = null;
  private panoramaWidth = 0;
  private isPanningPanorama = false;
  private lastPanoramaPointerX = 0;
  private boundPanoramaMove: ((e: FederatedPointerEvent) => void) | null = null;
  private boundPanoramaUp: (() => void) | null = null;
  private panoramaBaseX = 0;
  private panoramaTargetX = 0;

  initialize(context?: object): void {
    const ctx = context as PlanetContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;
    this.bribed = false;
    this.suppressTextQuestResume = ctx?.resumeTextQuest === false;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    const initSystem = this.gameEngine?.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet?.id),
    );
    const initFaction = initSystem?.ownerFaction ?? "INDEPENDENT";
    const backdropKey = resolvePlanetBackdropKey(
      this.planet?.type ?? "TERRESTRIAL",
      this.planet?.id ?? "",
      initFaction,
      this.planet?.isHabitable ?? false,
    );

    this.createUI();
    logger.info(`PlanetScene: ${this.planet?.name}`);
    this.gameEngine?.audio.playSfx("land").catch(() => {});
    this.checkDeliveryQuestCompletion();
    this.checkDiplomacyQuestCompletion();
    this.checkReturnQuestCompletion();
    this.checkCustoms();
    this.checkAndResumeTextQuest();

    this.boundPanoramaMove = (e) => this.onPanoramaMove(e);
    this.boundPanoramaUp = () => {
      this.isPanningPanorama = false;
    };
    const stage = this.renderer.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.renderer.app.screen;
    stage.on("pointermove", this.boundPanoramaMove);
    stage.on("pointerup", this.boundPanoramaUp);
    stage.on("pointerupoutside", this.boundPanoramaUp);

    this.mountHelp();

    if (!tex(backdropKey)) {
      this.gameEngine?.showLoadingOverlay("Посадка…");
      loadTextureAsync(backdropKey)
        .then((t) => t ?? loadTextureAsync(`panoramas/${PANORAMA_FALLBACK}`))
        .then((tex) => {
          this.gameEngine?.hideLoadingOverlay();
          if (tex && this.planet) {
            this.renderer.clearGameLayer();
            this.renderer.clearUILayer();
            this.createUI();
          }
        })
        .catch(() => {
          this.gameEngine?.hideLoadingOverlay();
        });
    }
  }

  update(deltaTime: number): void {
    if (
      !this.isPanningPanorama &&
      this.panoramaSprite &&
      !this.panoramaSprite.destroyed
    ) {
      const factor = Math.min(1, 0.0048 * deltaTime);
      const w = this.renderer.app.screen.width;
      const next =
        this.panoramaSprite.x +
        (this.panoramaTargetX - this.panoramaSprite.x) * factor;
      this.panoramaSprite.x = clampPanoramaX(next, this.panoramaWidth, w);
    }
  }

  private onPanoramaMove(e: FederatedPointerEvent): void {
    if (!this.panoramaSprite || this.panoramaSprite.destroyed) return;
    const w = this.renderer.app.screen.width;

    if (this.isPanningPanorama) {
      const dx = e.global.x - this.lastPanoramaPointerX;
      this.lastPanoramaPointerX = e.global.x;
      const newX = clampPanoramaX(
        this.panoramaSprite.x + dx,
        this.panoramaWidth,
        w,
      );
      this.panoramaSprite.x = newX;
      this.panoramaBaseX = newX;
      this.panoramaTargetX = newX;
    } else {
      this.panoramaTargetX = clampPanoramaX(
        computeParallaxTargetX(
          e.global.x,
          w,
          this.panoramaBaseX,
          PANORAMA_PARALLAX_MAX,
        ),
        this.panoramaWidth,
        w,
      );
    }
  }

  private checkDeliveryQuestCompletion(): void {
    if (!this.gameEngine?.player || !this.planet) return;
    const currentSystemId = this.gameEngine.player.currentSystemId;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;

    let shortfallShown = false;

    for (const quest of questManager.getActiveQuests()) {
      const result = evaluateDelivery(
        quest,
        player,
        currentSystemId,
        this.planet.id,
      );
      if (result.kind === "n/a") continue;

      if (result.kind === "shortfall") {
        if (!shortfallShown) {
          const cargoName = resourceLabelRu(result.cargo);
          this.showMessage(
            `${quest.title}: нужно ${result.required} ед. «${cargoName}», в трюме ${result.carried}`,
            0xffaa33,
          );
          shortfallShown = true;
        }
        continue;
      }

      const { collectObj, stack } = result;
      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        this.refreshCreditsHud();
        if (stack && collectObj && collectObj.itemType) {
          stack.amount -= collectObj.targetAmount;
          player.contrabandGoods = player.contrabandGoods.filter(
            (g) => g !== (collectObj.itemType as string),
          );
        }
        logger.info(
          `DELIVERY quest auto-completed on landing: ${quest.title} (reward: ${quest.reward?.credits ?? 0} cr)`,
        );
        this.gameEngine?.audio.playSfx("reward").catch(() => {});
        this.showMessage(
          `Задание выполнено: ${quest.title} +${quest.reward?.credits ?? 0} ₡`,
          0x00ff88,
        );
      }
    }
  }

  private checkDiplomacyQuestCompletion(): void {
    if (!this.gameEngine?.player || !this.planet) return;
    const planetId = this.planet.id;
    const systemId = this.gameEngine.player.currentSystemId;
    const questManager = this.gameEngine.questManager;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.DIPLOMACY) continue;
      if (quest.isCompleted || quest.isFailed || quest.isPendingReturn)
        continue;
      const hit = quest.objectives.some(
        (o) =>
          o.type === "VISIT_LOCATION" &&
          !o.completed &&
          (o.locationId === planetId || o.locationId === systemId),
      );
      if (!hit) continue;
      const marked = questManager.markObjectivesDone(quest.id);
      if (marked) {
        logger.info(`DIPLOMACY quest delivered: ${quest.title}`);
        this.gameEngine.questPendingReturnCallback?.(
          `Послание доставлено! Вернитесь за наградой`,
        );
        this.showMessage(`${quest.title} — вернитесь за наградой`, 0xffcc66);
      }
    }
  }

  private checkReturnQuestCompletion(): void {
    if (!this.gameEngine?.player || !this.planet) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;

    for (const quest of questManager.getPendingReturnQuests()) {
      if (quest.planetId !== this.planet.id) continue;
      const claimed = questManager.claimReturnReward(quest.id, player);
      if (claimed) {
        this.refreshCreditsHud();
        this.gameEngine.audio.playSfx("reward").catch(() => {});
        this.showMessage(
          `Награда получена: +${quest.reward.credits} ₡`,
          0xffdd44,
        );
        logger.info(
          `Return reward claimed on landing: ${quest.title} +${quest.reward.credits} cr`,
        );
      }
    }
  }

  private checkCustoms(): void {
    if (!this.gameEngine?.player || !this.planet?.isHabitable) return;
    const system = this.gameEngine.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
    if (!system) return;

    const tradeSystem = new TradeSystem();
    const player = this.gameEngine.player;
    const illegalGoods = player.inventory.resources.filter(
      (r) =>
        r.amount > 0 && !tradeSystem.isLegal(r.type, system.politicalSystem),
    );

    if (illegalGoods.length === 0) return;

    if (Math.random() >= 0.3) return;

    const penalty = illegalGoods.reduce((sum, r) => {
      return (
        sum + Math.round(tradeSystem.getBasePrice(r.type) * r.amount * 1.5)
      );
    }, 0);

    const goodNames = illegalGoods
      .map((r) => `${RESOURCE_RU[r.type as string] ?? r.type} (${r.amount})`)
      .join(", ");

    this.showCustomsModal(
      illegalGoods,
      goodNames,
      penalty,
      system.ownerFaction,
    );
  }

  private checkAndResumeTextQuest(): void {
    if (!this.gameEngine || !this.planet) return;
    if (this.suppressTextQuestResume) return;
    const activeQuests = this.gameEngine.questManager.getActiveQuests();
    const pending = activeQuests.find(
      (q) =>
        q.type === QuestType.TEXT_ADVENTURE &&
        q.planetId === this.planet!.id &&
        !q.isCompleted &&
        !q.isFailed,
    );
    if (!pending) return;
    const scriptId = pending.targetObjectId;
    if (!scriptId) return;

    setTimeout(() => {
      if (!this.gameEngine || !this.planet) return;
      this.gameEngine
        .startTextQuest(
          scriptId,
          undefined,
          SceneType.PLANET,
          { gameEngine: this.gameEngine, planet: this.planet },
          pending.id,
        )
        .catch((e) => logger.error("PlanetScene: text quest resume failed", e));
    }, 100);
  }

  private showCustomsModal(
    illegalGoods: { type: ResourceType; amount: number }[],
    goodNames: string,
    penalty: number,
    faction: string,
  ): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const modal = new Container();

    const backdrop = new Graphics();
    backdrop.rect(0, 0, w, h);
    backdrop.fill({ color: 0x000000, alpha: 0.75 });
    backdrop.eventMode = "static";
    backdrop.on("pointerdown", (e) => e.stopPropagation());
    modal.addChild(backdrop);

    const boxW = 460;
    const boxH = 280;
    const boxX = (w - boxW) / 2;
    const boxY = (h - boxH) / 2;
    const box = new Graphics();
    box.rect(boxX, boxY, boxW, boxH);
    box.fill({ color: 0x0d0d1a, alpha: 0.98 });
    box.stroke({ color: 0xff4444, width: 2 });
    modal.addChild(box);

    const addLabel = (
      text: string,
      x: number,
      y: number,
      size: number,
      color: number,
      bold = false,
    ): void => {
      const t = new Text({
        text,
        style: {
          fontFamily: "Courier New",
          fontSize: size,
          fill: color,
          fontWeight: bold ? "bold" : "normal",
          align: "center",
          wordWrap: true,
          wordWrapWidth: boxW - 40,
        },
      });
      t.anchor.set(0.5, 0);
      t.x = x;
      t.y = y;
      t.eventMode = "none";
      modal.addChild(t);
    };

    addLabel(
      "⚠ ТАМОЖЕННЫЙ ДОСМОТР",
      w / 2,
      boxY + 18,
      scaledFont(16),
      0xff4444,
      true,
    );
    addLabel(
      `Нелегальный груз: ${goodNames}`,
      w / 2,
      boxY + 50,
      scaledFont(12),
      0xffaa66,
    );

    const bribeCost = Math.round(penalty * 0.6);

    const makeBtn = (
      label: string,
      yOffset: number,
      color: number,
      onClick: () => void,
    ): void => {
      const btnW = 380;
      const btn = new Container();
      btn.x = (w - btnW) / 2;
      btn.y = boxY + yOffset;
      btn.eventMode = "static";
      btn.cursor = "pointer";

      const bg = new Graphics();
      bg.rect(0, 0, btnW, 34);
      bg.fill({ color, alpha: 0.85 });
      bg.stroke({ color: 0x888888, width: 1 });
      btn.addChild(bg);

      const lbl = new Text({
        text: label,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0xffffff,
        },
      });
      lbl.anchor.set(0.5);
      lbl.x = btnW / 2;
      lbl.y = 17;
      lbl.eventMode = "none";
      btn.addChild(lbl);

      btn.on("pointerdown", (e) => {
        e.stopPropagation();
        onClick();
      });
      btn.on("pointerover", () => {
        bg.clear();
        bg.rect(0, 0, btnW, 34);
        bg.fill({ color, alpha: 1.0 });
        bg.stroke({ color: 0xffffff, width: 1 });
      });
      btn.on("pointerout", () => {
        bg.clear();
        bg.rect(0, 0, btnW, 34);
        bg.fill({ color, alpha: 0.85 });
        bg.stroke({ color: 0x888888, width: 1 });
      });
      modal.addChild(btn);
    };

    makeBtn(`Заплатить штраф (${penalty} ₡)`, 110, 0x660000, () =>
      this.performCustomsChoice("pay"),
    );

    makeBtn(
      `Дать взятку (${bribeCost} ₡) — без потери репутации`,
      155,
      0x664400,
      () => this.performCustomsChoice("bribe"),
    );

    makeBtn("Выбросить груз — без штрафа", 200, 0x004400, () =>
      this.performCustomsChoice("dump"),
    );

    addLabel(
      `Штраф: ${penalty} ₡  •  Взятка: ${bribeCost} ₡`,
      w / 2,
      boxY + 248,
      scaledFont(11),
      0xaaaaaa,
    );

    this.customsModal = modal;
    this.customsContext = { illegalGoods, penalty, bribeCost, faction };
    this.renderer.uiLayer.addChild(modal);
  }

  get isCustomsModalOpen(): boolean {
    return this.customsModal != null && !this.customsModal.destroyed;
  }

  get customsBribeCost(): number | null {
    return this.customsContext?.bribeCost ?? null;
  }

  applyCustomsChoice(choice: "pay" | "bribe" | "dump"): boolean {
    return this.performCustomsChoice(choice);
  }

  private closeCustomsModal(): void {
    this.customsModal?.destroy({ children: true });
    this.customsModal = null;
    this.customsContext = null;
  }

  private performCustomsChoice(choice: "pay" | "bribe" | "dump"): boolean {
    const ctx = this.customsContext;
    const player = this.gameEngine?.player;
    if (!ctx || !this.isCustomsModalOpen || !player) return false;
    const { illegalGoods, penalty, bribeCost, faction } = ctx;

    if (choice === "pay") {
      if (!payCustomsFine(this.gameEngine?.bank, player, penalty)) {
        this.showMessage(
          `Недостаточно кредитов (нужно ${penalty} ₡)`,
          0xff5544,
        );
        return false;
      }
      this.refreshCreditsHud();
      logger.info(`Customs fine paid: ${penalty} cr (faction ${faction})`);
      this.closeCustomsModal();
      this.showMessage(`Штраф уплачен: −${penalty} ₡`, 0xff8844);
      return true;
    }

    if (choice === "bribe") {
      if (player.credits < bribeCost) {
        this.showMessage(
          `Недостаточно кредитов (нужно ${bribeCost} ₡)`,
          0xff5544,
        );
        return false;
      }
      adjustPlayerCredits(
        this.gameEngine?.bank,
        player,
        -bribeCost,
        GL_COUNTERPARTY.BRIBES,
        "Взятка таможне",
      );
      this.refreshCreditsHud();
      logger.info(`Customs bribed: ${bribeCost} cr`);
      this.closeCustomsModal();
      this.showMessage(`Взятка уплачена: −${bribeCost} ₡`, 0xffaa44);
      return true;
    }

    for (const good of illegalGoods) {
      const stack = player.inventory.resources.find(
        (r) => r.type === good.type,
      );
      if (stack) stack.amount = 0;
      player.contrabandGoods = player.contrabandGoods.filter(
        (g) => g !== (good.type as string),
      );
    }
    logger.info("Contraband dumped to avoid customs");
    this.closeCustomsModal();
    this.showMessage("Нелегальный груз выброшен", 0x66ff66);
    return true;
  }

  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "PLANET",
      { firstTimeKey: "refuel" },
    );
  }

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    const stage = this.renderer?.app?.stage;
    if (stage) {
      if (this.boundPanoramaMove) {
        stage.off("pointermove", this.boundPanoramaMove);
      }
      if (this.boundPanoramaUp) {
        stage.off("pointerup", this.boundPanoramaUp);
        stage.off("pointerupoutside", this.boundPanoramaUp);
      }
    }
    this.boundPanoramaMove = null;
    this.boundPanoramaUp = null;
    this.panoramaSprite = null;
    this.isPanningPanorama = false;
    this.customsModal = null;
    this.customsContext = null;
    this.closeJobBoard();
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.uiContainer = null;
    this.gameEngine = null;
    this.planet = null;
  }

  private createUI(): void {
    if (!this.planet) return;
    const ui = new Container();
    this.uiContainer = ui;
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    const system = this.gameEngine?.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
    const faction = system?.ownerFaction ?? "INDEPENDENT";
    const factionName = factionDisplayLabel(faction);
    const factionColor = resolveFactionColor(faction as Faction);

    const backdropKey = resolvePlanetBackdropKey(
      this.planet?.type ?? "TERRESTRIAL",
      this.planet?.id ?? "",
      faction,
      this.planet?.isHabitable ?? false,
    );
    const panTex = tex(backdropKey) ?? panoramaTex(PANORAMA_FALLBACK);
    const hasPanorama = !!panTex && panTex.width > 1 && panTex.height > 0;

    if (hasPanorama) {
      const panorama = new Sprite(panTex);
      const aspect = panTex!.width / panTex!.height;
      panorama.height = h;
      panorama.width = h * aspect;
      if (panorama.width < w) {
        panorama.width = w;
        panorama.height = w / aspect;
      }
      panorama.y = (h - panorama.height) / 2;
      panorama.x = clampPanoramaX((w - panorama.width) / 2, panorama.width, w);
      panorama.tint = planetBackdropTint(this.planet?.id ?? "", backdropKey);
      panorama.eventMode = "static";
      panorama.cursor = "grab";
      panorama.on("pointerdown", (e: FederatedPointerEvent) => {
        this.isPanningPanorama = true;
        this.lastPanoramaPointerX = e.global.x;
      });
      this.panoramaSprite = panorama;
      this.panoramaWidth = panorama.width;
      this.panoramaBaseX = panorama.x;
      this.panoramaTargetX = panorama.x;
      this.renderer.gameLayer.addChild(panorama);
    } else {
      this.panoramaSprite = null;
      const bands = skyGradientColors(factionColor, 10);
      const bandH = h / bands.length;
      const bg = new Graphics();
      for (let i = 0; i < bands.length; i++) {
        bg.rect(0, i * bandH, w, bandH + 1);
        bg.fill({ color: bands[i] });
      }
      bg.eventMode = "none";
      this.renderer.gameLayer.addChild(bg);
    }

    const overlay = new Graphics();
    overlay.rect(0, 0, w, h);
    overlay.fill({ color: 0x000011, alpha: PLANET_BACKDROP_OVERLAY_ALPHA });
    overlay.eventMode = "none";
    this.renderer.gameLayer.addChild(overlay);

    const planetCY = Math.min(h * 0.2, PLANET_VISUAL_RADIUS + 10);

    const bannerX = 16;
    const bannerY = 16;
    const bannerW = 230;
    const bannerH = 28;
    const factionBg = new Graphics();
    factionBg.rect(bannerX, bannerY, bannerW, bannerH);
    factionBg.fill({ color: factionColor, alpha: 0.85 });
    factionBg.eventMode = "none";
    ui.addChild(factionBg);

    const factionLabel = new Text({
      text: factionName,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    factionLabel.x = bannerX + 8;
    factionLabel.y = bannerY + 7;
    factionLabel.eventMode = "none";
    ui.addChild(factionLabel);

    const rep = this.gameEngine?.player?.reputation[faction] ?? 0;
    const repLevel =
      rep >= 50 ? 4 : rep >= 10 ? 3 : rep >= -20 ? 2 : rep >= -50 ? 1 : 0;
    const dotColors = [0xff2222, 0xff8888, 0xaaaaaa, 0x88ff88, 0x00ff88];
    for (let i = 0; i < 5; i++) {
      const dot = new Graphics();
      dot.circle(bannerX + 10 + i * 16, bannerY + bannerH + 8, 5);
      dot.fill({ color: i <= repLevel ? dotColors[i] : 0x333344 });
      dot.eventMode = "none";
      ui.addChild(dot);
    }

    const captureName = capturedSystemOccupierName(
      this.gameEngine?.galaxy,
      system?.id,
    );
    if (captureName) {
      const captureBg = new Graphics();
      captureBg.rect(bannerX, bannerY + bannerH + 22, bannerW + 40, 24);
      captureBg.fill({ color: 0xff0000, alpha: 0.85 });
      captureBg.eventMode = "none";
      ui.addChild(captureBg);

      const captureLabel = new Text({
        text: `⚠ ЗАХВАЧЕНА: ${captureName}`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(12),
          fill: 0xffffff,
          fontWeight: "bold",
        },
      });
      captureLabel.x = bannerX + 6;
      captureLabel.y = bannerY + bannerH + 27;
      captureLabel.eventMode = "none";
      ui.addChild(captureLabel);
    }

    if (this.gameEngine?.player) {
      const creditsHud = new Text({
        text: `${this.gameEngine.player.credits.toLocaleString("ru")} ₡`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(14),
          fill: 0xffdd44,
          fontWeight: "bold",
        },
      });
      const creditsAnchor = creditsHudAnchor(w);
      creditsHud.anchor.set(1, 0);
      creditsHud.x = creditsAnchor.x;
      creditsHud.y = creditsAnchor.y;
      creditsHud.eventMode = "none";
      ui.addChild(creditsHud);
      this.creditsHudText = creditsHud;
    } else {
      this.creditsHudText = null;
    }

    const nameY = planetCY + PLANET_VISUAL_RADIUS + 16;
    const subtitleY = nameY + 24;
    const infoY = nameY + 46;
    const statY = infoY + 84;

    const title = new Text({
      text: this.planet.name,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(30),
        fill: factionColor,
        fontWeight: "bold",
        align: "center",
      },
    });
    title.anchor.set(0.5);
    title.x = w / 2;
    title.y = nameY;
    title.eventMode = "none";
    ui.addChild(title);

    const subtitle = new Text({
      text: planetInfoPanelLines({
        planetType: this.planet.type,
        isHabitable: this.planet.isHabitable,
        factionName: "",
        populationSeed: this.planet.id,
      }).subtitle,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: 0x99bbcc,
        align: "center",
      },
    });
    subtitle.anchor.set(0.5);
    subtitle.x = w / 2;
    subtitle.y = subtitleY;
    subtitle.eventMode = "none";
    ui.addChild(subtitle);

    this.addInfoPanel(ui, w, infoY);

    if (this.gameEngine?.player) {
      const ship = this.gameEngine.player.ship;
      const hullPct = hullStatus(
        ship.hullHP,
        ship.maxHull,
        this.gameEngine.playerLoadout?.derivedStats().maxHull,
      ).percent;
      const fuelPct = Math.round(
        (ship.energy / Math.max(1, ship.maxEnergy)) * 100,
      );
      const bars = (pct: number): string => {
        const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
        return "█".repeat(filled) + "░".repeat(10 - filled);
      };
      const statLine = new Text({
        text: `Корпус: ${bars(hullPct)} ${hullPct}%   Топливо: ${bars(fuelPct)} ${fuelPct}%`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0x88aacc,
          align: "center",
        },
      });
      statLine.anchor.set(0.5);
      statLine.x = w / 2;
      statLine.y = statY;
      statLine.eventMode = "none";
      ui.addChild(statLine);
    }

    const buttons: ServiceButtonDef[] = [
      {
        icon: "📋",
        label: "Губернатор",
        accent: "success",
        action: () => this.openGovernor(),
      },
      {
        icon: "≡",
        label: "Задания",
        accent: "primary",
        action: () => this.openJobBoard(),
      },
      {
        icon: "🔍",
        label: "Инфоцентр",
        accent: "primary",
        action: () => this.openInfoCenter(),
      },
      {
        icon: "⚔",
        label: "Снаряжение",
        accent: "primary",
        action: () => this.openEquipmentShop(),
      },
      {
        icon: "⚙",
        label: "Верфь",
        accent: "primary",
        action: () => this.openGarage(),
      },
      {
        icon: "📦",
        label: "Маркет",
        accent: "neutral",
        action: () => this.openMarket(),
      },
      {
        icon: "⛁",
        label: "Банк",
        accent: "primary",
        action: () => this.openBank(),
      },
      {
        icon: "✦",
        label: "Исследования",
        accent: "neutral",
        action: () => this.openResearch(),
      },
      {
        icon: "🗺",
        label: "Карты",
        accent: "neutral",
        action: () => this.openStarMap(),
      },
      {
        icon: "🚀",
        label: "Взлёт",
        accent: "danger",
        action: () => this.takeOff(),
      },
    ];

    const player = this.gameEngine?.player;
    const isHostile = !this.bribed && (player?.isHostileTo(faction) ?? false);

    const visible = visiblePlanetServices(this.planet.isHabitable, buttons);
    const showBribe = isHostile && this.planet.isHabitable;
    const dangerRows = 1 + (showBribe ? 1 : 0);
    const { btnStartY, btnStep, btnH, dangerGap } = computePlanetMenuLayout(
      h,
      statY,
      visible.length + (showBribe ? 1 : 0),
      dangerRows,
    );
    const btnW = 280;

    const makeServiceBtn = (
      b: ServiceButtonDef,
      yPos: number,
      blocked: boolean,
    ): void => {
      if (blocked) {
        const btn = new Container();
        btn.x = w / 2 - btnW / 2;
        btn.y = yPos;
        const bg = new Graphics();
        bg.roundRect(0, 0, btnW, btnH, 4).fill({ color: 0x1a1a2e, alpha: 0.9 });
        bg.roundRect(0, 0, btnW, btnH, 4).stroke({ color: 0x334455, width: 1 });
        bg.eventMode = "none";
        btn.addChild(bg);
        const lbl = new Text({
          text: `${b.icon} ${b.label}`,
          style: {
            fontFamily: "Courier New",
            fontSize: scaledFont(13),
            fill: 0x8899aa,
            fontWeight: "bold",
          },
        });
        lbl.anchor.set(0.5);
        lbl.x = btnW / 2;
        lbl.y = btnH / 2;
        lbl.eventMode = "none";
        btn.addChild(lbl);
        btn.eventMode = "none";
        ui.addChild(btn);
        return;
      }
      const btn = new UiButton(
        b.icon,
        b.label,
        b.accent,
        (e) => {
          e.stopPropagation();
          b.action();
        },
        btnW,
        btnH,
      );
      btn.x = w / 2 - btnW / 2;
      btn.y = yPos;
      ui.addChild(btn.container);
    };

    const systemHostile = !!(
      system && this.gameEngine?.galaxy?.isHostileSystem?.(system.id)
    );

    let y = btnStartY;
    for (const b of visible) {
      if (b.accent === "danger") y += dangerGap;
      const blocked =
        (isHostile && b.label !== "Взлёт") ||
        (b.label === "Карты" && systemHostile);
      makeServiceBtn(b, y, blocked);
      y += btnStep;
    }

    if (showBribe) {
      y += dangerGap;
      makeServiceBtn(
        {
          icon: "💰",
          label: `Взятка (${BRIBE_COST} ₡)`,
          accent: 0xffaa44,
          action: () => this.payBribe(faction),
        },
        y,
        false,
      );
      y += btnStep;
      const isPirateControlled = !!(
        system && this.gameEngine?.galaxy?.isPirateSystem?.(system.id)
      );
      const hint = new Text({
        text: standingRecoveryHint(isPirateControlled),
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(11),
          fill: 0xffcc66,
          align: "center",
          wordWrap: true,
          wordWrapWidth: btnW + 60,
        },
      });
      hint.anchor.set(0.5, 0);
      hint.x = w / 2;
      hint.y = y;
      hint.eventMode = "none";
      ui.addChild(hint);
    }

    this.renderer.uiLayer.addChild(ui);
  }

  private addInfoPanel(ui: Container, w: number, topY: number): void {
    if (!this.planet || !this.gameEngine) return;

    const system = this.gameEngine.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );

    const faction = system?.ownerFaction ?? "INDEPENDENT";
    const factionName = factionDisplayLabel(faction);
    const factionColor = resolveFactionColor(faction as Faction);

    const rep = this.gameEngine.player?.reputation[faction] ?? 0;
    const repLabel = getRepLabel(rep);
    const repColor = getRepColor(rep);

    const goods = this.planet.market.availableResources
      .slice(0, 4)
      .map((r) => RESOURCE_RU[r as string] ?? String(r))
      .join(", ");

    const lines = planetInfoPanelLines({
      planetType: this.planet.type,
      isHabitable: this.planet.isHabitable,
      factionName,
      economyType: system?.economyType,
      politicalSystem: system?.politicalSystem,
      population: this.planet.population,
      populationSeed: this.planet.id,
    });

    const factionText = new Text({
      text: lines.faction,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: factionColor,
        fontWeight: "bold",
      },
    });
    factionText.eventMode = "none";
    factionText.anchor.set(0.5, 0);
    factionText.x = w / 2;
    factionText.y = topY;
    ui.addChild(factionText);

    const repYOffset = this.planet.isHabitable ? 20 : 0;
    if (this.planet.isHabitable) {
      const repLine = new Text({
        text: `Отношение: `,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0x889aaa,
        },
      });
      repLine.eventMode = "none";
      repLine.anchor.set(0.5, 0);
      repLine.x = w / 2 - 30;
      repLine.y = topY + 20;
      ui.addChild(repLine);

      const repText = new Text({
        text: `${repLabel} (${rep >= 0 ? "+" : ""}${rep})`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: repColor,
          fontWeight: "bold",
        },
      });
      repText.eventMode = "none";
      repText.anchor.set(0, 0);
      repText.x = w / 2 - 30 + repLine.width;
      repText.y = topY + 20;
      ui.addChild(repText);
    }

    const profileYOffset = this.planet.isHabitable ? 20 : 0;
    if (this.planet.isHabitable && lines.profile) {
      const profileText = new Text({
        text: lines.profile,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(12),
          fill: 0x7799bb,
          align: "center",
        },
      });
      profileText.eventMode = "none";
      profileText.anchor.set(0.5, 0);
      profileText.x = w / 2;
      profileText.y = topY + 20 + repYOffset;
      ui.addChild(profileText);
    }

    const goodsLine = this.planet.isHabitable
      ? `Рынок: ${goods || "нет данных"}`
      : `Дроны: ${this.planet.drones}  •  Необитаемая`;
    const goodsText = new Text({
      text: goodsLine,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(12),
        fill: 0x6688aa,
        align: "center",
      },
    });
    goodsText.eventMode = "none";
    goodsText.anchor.set(0.5, 0);
    goodsText.x = w / 2;
    goodsText.y = topY + 20 + repYOffset + profileYOffset;
    ui.addChild(goodsText);
  }

  private payBribe(faction: string): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    if (player.credits < BRIBE_COST) {
      this.showMessage(
        `Нужно ${BRIBE_COST} ₡ — недостаточно средств`,
        0xff5544,
      );
      return;
    }
    adjustPlayerCredits(
      this.gameEngine?.bank,
      player,
      -BRIBE_COST,
      GL_COUNTERPARTY.BRIBES,
      "Взятка таможне",
    );
    this.bribed = true;
    logger.info(
      `PlanetScene: bribed customs at ${this.planet?.name} (faction ${faction})`,
    );
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.createUI();
    this.showMessage("Взятка принята. Добро пожаловать.", 0xffaa44);
  }

  private async openGovernor(): Promise<void> {
    if (!this.planet || !this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.GOVERNMENT, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private async openBank(): Promise<void> {
    if (!this.planet || !this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.BANK, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private openJobBoard(): void {
    if (!this.gameEngine || !this.planet) return;
    this.closeJobBoard();
    const quests = this.gameEngine.getQuestBoard(this.planet.id);
    const { width, height } = this.renderer.app.screen;
    const activeQuests = this.gameEngine.questManager.getActiveQuests();
    const activeCount = activeQuests.length;
    const currentDay = this.gameEngine.galaxy?.gameDays ?? 0;
    const acceptedIds = new Set<string>([
      ...activeQuests.map((q) => q.id),
      ...this.gameEngine.questManager.getCompletedQuestIds(),
      ...this.gameEngine.questManager.getPendingReturnQuests().map((q) => q.id),
    ]);
    this.jobBoardPanel = new JobBoardPanel(
      quests,
      width,
      height,
      {
        onAccept: (q) => this.acceptJob(q),
        onClose: () => this.closeJobBoard(),
      },
      activeCount,
      acceptedIds,
      activeQuests,
      currentDay,
      this.gameEngine.player?.rank ?? 0,
    );
    this.renderer.uiLayer.addChild(this.jobBoardPanel.container);
  }

  private acceptJob(q: GeneratedQuest): void {
    if (!this.gameEngine || !this.planet) return;
    const accepted = this.gameEngine.acceptBoardQuest(q, this.planet.id);
    if (!accepted) {
      this.showMessage("Не удалось принять задание", 0xffaa00);
      return;
    }
    if (q.template.type === QuestType.TEXT_ADVENTURE) {
      const scriptId = q.template.targetObjectId ?? q.template.id;
      this.closeJobBoard();
      this.gameEngine
        .startTextQuest(
          scriptId,
          undefined,
          SceneType.PLANET,
          { gameEngine: this.gameEngine, planet: this.planet },
          accepted.id,
        )
        .catch((e) =>
          logger.error("PlanetScene: text quest transition failed", e),
        );
      return;
    }
    this.showMessage(`Задание принято: ${q.template.title}`, 0x00ff88);
    this.openJobBoard(); // refresh — the accepted quest drops off the board
  }

  private closeJobBoard(): void {
    const panel = this.jobBoardPanel;
    this.jobBoardPanel = null;
    if (panel) {
      this.renderer?.uiLayer?.removeChild(panel.container);
      panel.destroy();
    }
  }

  e2eOpenJobBoard(): void {
    if (!__DEBUG__) return;
    this.openJobBoard();
  }

  e2eAcceptBoardQuest(quest: GeneratedQuest): boolean {
    if (!__DEBUG__) return false;
    this.acceptJob(quest);
    return true;
  }

  e2eCloseJobBoard(): void {
    if (!__DEBUG__) return;
    this.closeJobBoard();
  }

  private openGarage(): void {
    if (!this.gameEngine?.player) return;
    const ship = this.gameEngine.player.ship;
    const loadout = this.gameEngine.playerLoadout;
    if (loadout) applyLoadoutHullToShip(ship, loadout);
    const status = hullStatus(
      ship.hullHP,
      ship.maxHull,
      loadout?.derivedStats().maxHull,
    );

    if (status.isPerfect) {
      this.showMessage("Корпус уже в идеальном состоянии", 0x00ff88);
      return;
    }

    const missing = status.missing;
    const cost = Math.ceil(missing * 2);
    if (this.gameEngine.player.credits < cost) {
      this.showMessage(
        `Недостаточно кредитов на ремонт (нужно ${cost})`,
        0xff5555,
      );
      return;
    }

    adjustPlayerCredits(
      this.gameEngine.bank,
      this.gameEngine.player,
      -cost,
      GL_COUNTERPARTY.SERVICES,
      "Ремонт корпуса",
    );
    ship.repair();
    this.refreshCreditsHud();
    logger.info(`Repaired for ${cost}`);
    this.showMessage(
      `Корпус восстановлен (+${missing}) за ${cost} кр.`,
      0x00ff88,
    );
  }

  private async openInfoCenter(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.INFO_CENTER, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private async openEquipmentShop(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.EQUIPMENT_SHOP, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private async openMarket(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.TRADE, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private openResearch(): void {
    this.showMessage("Исследовательская станция пока в разработке", 0xffaa00);
  }

  private openStarMap(): void {
    if (!this.gameEngine?.player || !this.planet) return;
    const galaxy = this.gameEngine.galaxy;
    if (!galaxy) return;
    const system = galaxy.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
    if (!system) return;
    const player = this.gameEngine.player;

    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const modal = new Container();

    const backdrop = new Graphics();
    backdrop.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.75 });
    backdrop.eventMode = "static";
    backdrop.on("pointerdown", (e) => e.stopPropagation());
    modal.addChild(backdrop);

    const boxW = 460;
    const boxH = 320;
    const boxX = (w - boxW) / 2;
    const boxY = (h - boxH) / 2;
    const box = new Graphics();
    box.rect(boxX, boxY, boxW, boxH).fill({ color: 0x0d0d1a, alpha: 0.98 });
    box.rect(boxX, boxY, boxW, boxH).stroke({ color: 0x44aaff, width: 2 });
    modal.addChild(box);

    const addLabel = (
      text: string,
      x: number,
      y: number,
      size: number,
      color: number,
      bold = false,
    ): void => {
      const t = new Text({
        text,
        style: {
          fontFamily: "Courier New",
          fontSize: size,
          fill: color,
          fontWeight: bold ? "bold" : "normal",
          align: "center",
        },
      });
      t.anchor.set(0.5, 0);
      t.x = x;
      t.y = y;
      t.eventMode = "none";
      modal.addChild(t);
    };

    addLabel(
      "🗺 КАРТЫ ЗВЁЗДНЫХ СИСТЕМ",
      w / 2,
      boxY + 18,
      scaledFont(16),
      0x44aaff,
      true,
    );
    addLabel(
      `Кредиты: ${player.credits.toLocaleString("ru")} ₡`,
      w / 2,
      boxY + 46,
      scaledFont(12),
      0xffdd44,
    );

    const close = (): void => {
      if (!modal.destroyed) modal.destroy({ children: true });
    };

    const makeBtn = (
      label: string,
      yOffset: number,
      color: number,
      enabled: boolean,
      onClick: () => void,
    ): void => {
      const btnW = 380;
      const btn = new Container();
      btn.x = (w - btnW) / 2;
      btn.y = boxY + yOffset;
      const bg = new Graphics();
      bg.rect(0, 0, btnW, 40).fill({
        color: enabled ? color : 0x1a1a2e,
        alpha: enabled ? 0.85 : 0.9,
      });
      bg.rect(0, 0, btnW, 40).stroke({
        color: enabled ? 0x888888 : 0x334455,
        width: 1,
      });
      bg.eventMode = "none";
      btn.addChild(bg);
      const lbl = new Text({
        text: label,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: enabled ? 0xffffff : 0x8899aa,
          fontWeight: "bold",
        },
      });
      lbl.anchor.set(0.5);
      lbl.x = btnW / 2;
      lbl.y = 20;
      lbl.eventMode = "none";
      btn.addChild(lbl);
      if (enabled) {
        btn.eventMode = "static";
        btn.cursor = "pointer";
        btn.hitArea = new Rectangle(0, 0, btnW, 40);
        btn.on("pointerdown", (e) => {
          e.stopPropagation();
          onClick();
        });
        btn.on("pointerover", () => {
          bg.clear();
          bg.rect(0, 0, btnW, 40).fill({ color, alpha: 1.0 });
          bg.rect(0, 0, btnW, 40).stroke({ color: 0xffffff, width: 1 });
        });
        btn.on("pointerout", () => {
          bg.clear();
          bg.rect(0, 0, btnW, 40).fill({ color, alpha: 0.85 });
          bg.rect(0, 0, btnW, 40).stroke({ color: 0x888888, width: 1 });
        });
      } else {
        btn.eventMode = "none";
      }
      modal.addChild(btn);
    };

    const cheapest = Math.min(...STAR_MAP_TIERS.map((t) => t.cost));
    if (player.credits < cheapest) {
      makeBtn("Нет кредитов", 90, 0x331111, false, () => {});
    } else {
      let yOff = 86;
      for (const tier of STAR_MAP_TIERS) {
        const affordable = player.credits >= tier.cost;
        makeBtn(
          `${tier.label} — ${tier.cost.toLocaleString("ru")} ₡`,
          yOff,
          0x224466,
          affordable,
          () => {
            if (player.credits < tier.cost) return;
            adjustPlayerCredits(
              this.gameEngine?.bank,
              player,
              -tier.cost,
              GL_COUNTERPARTY.SERVICES,
              "Покупка звёздной карты",
            );
            const revealed = galaxy.revealSystemsWithinHops(
              system.id,
              tier.hops,
            );
            this.refreshCreditsHud();
            logger.info(
              `Star map purchased: ${tier.hops} hops, ${tier.cost} cr, revealed ${revealed} systems`,
            );
            close();
            this.showMessage(
              revealed > 0
                ? t("planet.starMapPurchased", {
                    price: tier.cost.toLocaleString("ru"),
                    revealed,
                  })
                : t("planet.starMapPurchasedNoneNew", {
                    price: tier.cost.toLocaleString("ru"),
                  }),
              0x44ddff,
            );
          },
        );
        yOff += 52;
      }
    }

    makeBtn("Закрыть", 250, 0x333344, true, close);

    this.renderer.uiLayer.addChild(modal);
  }

  private async takeOff(): Promise<void> {
    if (!this.gameEngine) return;
    const loadoutStats = this.gameEngine.playerLoadout?.derivedStats();
    if (loadoutStats && !loadoutStats.canTakeOff) {
      this.showMessage(
        launchDenialReason(loadoutStats) === "fuel"
          ? "Нет топливного бака — взлёт невозможен"
          : "Нет двигателя — взлёт невозможен",
        0xff4444,
      );
      return;
    }
    await this.gameEngine.saveGame("auto").catch((e) => {
      logger.error("PlanetScene: take-off autosave failed", e);
    });
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      fromPlanetId: this.planet?.id,
    });
  }

  e2eTakeOff(): Promise<void> {
    if (!__DEBUG__) return Promise.resolve();
    return this.takeOff();
  }

  private refreshCreditsHud(): void {
    if (!this.creditsHudText || !this.gameEngine?.player) return;
    this.creditsHudText.text = `${this.gameEngine.player.credits.toLocaleString("ru")} ₡`;
  }

  private showMessage(text: string, color: number): void {
    if (!this.uiContainer) return;

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    const existing = this.uiContainer.getChildByLabel?.("planet-toast");
    if (existing) existing.destroy();

    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const toast = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(16),
        fill: color,
        fontWeight: "bold",
        align: "center",
      },
    });
    toast.label = "planet-toast";
    toast.anchor.set(0.5);
    toast.x = w / 2;
    toast.y = h - 40;
    toast.eventMode = "none";
    this.uiContainer.addChild(toast);

    this.toastTimeout = setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
      this.toastTimeout = null;
    }, 3000);
  }
}
