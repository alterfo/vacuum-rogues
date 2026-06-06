import { GameScene } from "./GameScene";
import { Container, Graphics, Text } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { JobBoardPanel } from "./JobBoardPanel";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import { TradeSystem } from "@/systems/TradeSystem";
import { QuestType } from "@/types";
import type { ResourceType } from "@/types";

interface PlanetContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

/** A planet-surface action button (governor, garage, market, …, take-off). */
export interface PlanetServiceButton {
  label: string;
  color: number;
  action: () => void;
}

/**
 * Which station services are offered on a planet. Uninhabited worlds have no
 * station services — only "Взлёт" (take-off); once drones exist, also "leave a
 * drone". Inhabited worlds show the full set (US-070 #12).
 */
export function visiblePlanetServices<T extends { label: string }>(
  isHabitable: boolean,
  buttons: T[],
): T[] {
  if (isHabitable) return buttons;
  return buttons.filter((b) => b.label === "Взлёт");
}

const BRIBE_COST = 500;

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

export class PlanetScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private uiContainer: Container | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private jobBoardPanel: JobBoardPanel | null = null;
  /** Bribe paid this landing — gates are lifted for the duration of the visit. */
  private bribed = false;

  initialize(context?: object): void {
    const ctx = context as PlanetContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;
    this.bribed = false;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.createUI();
    logger.info(`PlanetScene: ${this.planet?.name}`);
    this.checkCustoms();
    this.checkDeliveryQuestCompletion();
  }

  update(_deltaTime: number): void {}

  /**
   * Auto-complete DELIVERY quests whose targetSystemId matches the current
   * system. Checks that the player carries the required cargo, removes it from
   * inventory, then force-completes the quest and shows a success toast.
   */
  private checkDeliveryQuestCompletion(): void {
    if (!this.gameEngine?.player || !this.planet) return;
    const currentSystemId = this.gameEngine.player.currentSystemId;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.DELIVERY) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      if (quest.targetSystemId !== currentSystemId) continue;

      // Find the COLLECT_ITEM objective to know what cargo is expected
      const collectObj = quest.objectives.find(
        (o) => o.type === "COLLECT_ITEM" && !o.completed,
      );
      if (collectObj && collectObj.itemType) {
        const stack = player.inventory.resources.find(
          (r) => r.type === collectObj.itemType,
        );
        if (!stack || stack.amount < collectObj.targetAmount) continue;
        stack.amount -= collectObj.targetAmount;
        player.contrabandGoods = player.contrabandGoods.filter(
          (g) => g !== (collectObj.itemType as string),
        );
      }

      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        logger.info(
          `DELIVERY quest auto-completed on landing: ${quest.title} (reward: ${quest.reward?.credits ?? 0} cr)`,
        );
        this.showMessage(
          `Задание выполнено: ${quest.title} +${quest.reward?.credits ?? 0} ₡`,
          0x00ff88,
        );
      }
    }
  }

  /**
   * Customs check on landing: if any inventory goods are illegal at this planet,
   * roll a 30% chance of triggering an inspection. If triggered, show the modal.
   */
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

    // 30% chance of customs inspection
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

  private showCustomsModal(
    illegalGoods: { type: ResourceType; amount: number }[],
    goodNames: string,
    penalty: number,
    faction: string,
  ): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const modal = new Container();

    // Backdrop — blocks all underlying interaction
    const backdrop = new Graphics();
    backdrop.rect(0, 0, w, h);
    backdrop.fill({ color: 0x000000, alpha: 0.75 });
    backdrop.eventMode = "static";
    backdrop.on("pointerdown", (e) => e.stopPropagation());
    modal.addChild(backdrop);

    // Modal box
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

    addLabel("⚠ ТАМОЖЕННЫЙ ДОСМОТР", w / 2, boxY + 18, 16, 0xff4444, true);
    addLabel(`Нелегальный груз: ${goodNames}`, w / 2, boxY + 50, 12, 0xffaa66);

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
        style: { fontFamily: "Courier New", fontSize: 13, fill: 0xffffff },
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

    const player = this.gameEngine!.player!;

    makeBtn(
      `Заплатить штраф (${penalty} ₡) — репутация -20`,
      110,
      0x660000,
      () => {
        if (player.credits < penalty) {
          player.credits = 0;
        } else {
          player.credits -= penalty;
        }
        player.adjustReputation(faction, -20);
        logger.info(
          `Customs fine paid: ${penalty} cr, rep -20 with ${faction}`,
        );
        modal.destroy({ children: true });
        this.showMessage(
          `Штраф уплачен: −${penalty} ₡, репутация −20`,
          0xff8844,
        );
      },
    );

    makeBtn(
      `Дать взятку (${bribeCost} ₡) — без потери репутации`,
      155,
      0x664400,
      () => {
        if (player.credits < bribeCost) {
          player.credits = 0;
        } else {
          player.credits -= bribeCost;
        }
        logger.info(`Customs bribed: ${bribeCost} cr`);
        modal.destroy({ children: true });
        this.showMessage(`Взятка уплачена: −${bribeCost} ₡`, 0xffaa44);
      },
    );

    makeBtn("Выбросить груз — без штрафа", 200, 0x004400, () => {
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
      modal.destroy({ children: true });
      this.showMessage("Нелегальный груз выброшен", 0x66ff66);
    });

    addLabel(
      `Штраф: ${penalty} ₡  •  Взятка: ${bribeCost} ₡`,
      w / 2,
      boxY + 248,
      11,
      0x666666,
    );

    this.renderer.uiLayer.addChild(modal);
  }

  destroy(): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
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

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x000510, alpha: 0.95 });
    this.renderer.gameLayer.addChild(bg);

    const planetGfx = new Graphics();
    planetGfx.circle(w / 2, h / 3, 60);
    planetGfx.fill({ color: this.planet.isHabitable ? 0x22aa44 : 0x888888 });
    this.renderer.gameLayer.addChild(planetGfx);

    // Proportional layout so the screen doesn't look cramped at 768px height.
    const nameY = h * 0.38;
    const infoY = h * 0.46;
    const statY = h * 0.535;
    const btnStartY = h * 0.58;
    const btnStep = Math.max(34, h * 0.048);

    const title = new Text({
      text: this.planet.name,
      style: {
        fontFamily: "Courier New",
        fontSize: 28,
        fill: 0x00ffff,
        fontWeight: "bold",
        align: "center",
      },
    });
    title.anchor.set(0.5);
    title.x = w / 2;
    title.y = nameY;
    title.eventMode = "none";
    ui.addChild(title);

    // Planet info panel (US-060): faction, econ type, reputation, market goods.
    this.addInfoPanel(ui, w, infoY);

    // Hangar stat bar: hull / fuel / credits in one compact line.
    if (this.gameEngine?.player) {
      const ship = this.gameEngine.player.ship;
      const hullPct = Math.round((ship.hullHP / ship.maxHull) * 100);
      const fuelPct = Math.round(
        (ship.energy / Math.max(1, ship.maxEnergy)) * 100,
      );
      const bars = (pct: number): string =>
        "█".repeat(Math.round(pct / 10)) +
        "░".repeat(10 - Math.round(pct / 10));
      const statLine = new Text({
        text: `Корпус: ${bars(hullPct)} ${hullPct}%   Топливо: ${bars(fuelPct)} ${fuelPct}%   ${this.gameEngine.player.credits.toLocaleString("ru")} ₡`,
        style: {
          fontFamily: "Courier New",
          fontSize: 13,
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

    const buttons: { label: string; color: number; action: () => void }[] = [
      {
        label: "Губернатор",
        color: 0x00ff00,
        action: () => this.openGovernor(),
      },
      { label: "Задания", color: 0xffee66, action: () => this.openJobBoard() },
      {
        label: "Инфоцентр",
        color: 0x66bbff,
        action: () => this.openInfoCenter(),
      },
      {
        label: "Магазин снаряжения",
        color: 0x44ddff,
        action: () => this.openEquipmentShop(),
      },
      { label: "Гараж", color: 0x00aaff, action: () => this.openGarage() },
      { label: "Маркет", color: 0xffaa00, action: () => this.openMarket() },
      {
        label: "Исследования",
        color: 0xff00ff,
        action: () => this.openResearch(),
      },
      { label: "Взлёт", color: 0xff4444, action: () => this.takeOff() },
    ];

    // Reputation gate: hostile faction blocks all services except take-off.
    const system = this.gameEngine?.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
    const planetFaction = system?.ownerFaction ?? "INDEPENDENT";
    const player = this.gameEngine?.player;
    const isHostile =
      !this.bribed && (player?.isHostileTo(planetFaction) ?? false);

    const visible = visiblePlanetServices(this.planet.isHabitable, buttons);
    let y = btnStartY;
    for (const b of visible) {
      const blocked = isHostile && b.label !== "Взлёт";
      const t = new Text({
        text: `[ ${b.label} ]`,
        style: {
          fontFamily: "Courier New",
          fontSize: 18,
          fill: blocked ? 0x445566 : b.color,
          fontWeight: "bold",
        },
      });
      t.anchor.set(0.5);
      t.x = w / 2;
      t.y = y;
      if (blocked) {
        t.eventMode = "none";
      } else {
        t.eventMode = "static";
        t.cursor = "pointer";
        t.on("pointerdown", (e) => {
          e.stopPropagation();
          b.action();
        });
        t.on("pointerover", () => {
          t.alpha = 0.7;
        });
        t.on("pointerout", () => {
          t.alpha = 1;
        });
      }
      ui.addChild(t);
      y += btnStep;
    }

    // Show bribe button when hostile to the controlling faction.
    if (isHostile && this.planet.isHabitable) {
      const brLabel = new Text({
        text: `[ Дать взятку (${BRIBE_COST} ₡) ]`,
        style: {
          fontFamily: "Courier New",
          fontSize: 16,
          fill: 0xffaa44,
          fontWeight: "bold",
        },
      });
      brLabel.anchor.set(0.5);
      brLabel.x = w / 2;
      brLabel.y = y;
      brLabel.eventMode = "static";
      brLabel.cursor = "pointer";
      brLabel.on("pointerdown", (e) => {
        e.stopPropagation();
        this.payBribe(planetFaction);
      });
      brLabel.on("pointerover", () => {
        brLabel.alpha = 0.7;
      });
      brLabel.on("pointerout", () => {
        brLabel.alpha = 1;
      });
      ui.addChild(brLabel);
    }

    this.renderer.uiLayer.addChild(ui);
  }

  /**
   * Planet information card (US-060): faction, economic type, player reputation
   * with the controlling faction, and a short market goods summary.
   */
  private addInfoPanel(ui: Container, w: number, topY: number): void {
    if (!this.planet || !this.gameEngine) return;

    const system = this.gameEngine.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );

    const FACTION_RU: Record<string, string> = {
      OUTLANDERS: "Окраинники",
      BASTIONS: "Бастион",
      SYNDICATE: "Синдикат",
      PARADOXES: "Парадокс",
      PROGRESSORS: "Прогрессоры",
      INDEPENDENT: "Независимая",
      OVERMIND: "Сверхразум",
    };

    const FACTION_COLOR: Record<string, number> = {
      OUTLANDERS: 0xff6600,
      BASTIONS: 0xcc2222,
      SYNDICATE: 0x22cc22,
      PARADOXES: 0xaa22cc,
      PROGRESSORS: 0x2266ff,
      INDEPENDENT: 0x999999,
      OVERMIND: 0xff22cc,
    };

    const faction = system?.ownerFaction ?? "INDEPENDENT";
    const factionName = FACTION_RU[faction] ?? faction;
    const factionColor = FACTION_COLOR[faction] ?? 0x999999;

    const rep = this.gameEngine.player?.reputation[faction] ?? 0;
    const repLabel =
      rep >= 50
        ? "Союзник"
        : rep >= 20
          ? "Дружелюбный"
          : rep >= -20
            ? "Нейтральный"
            : rep >= -50
              ? "Враждебный"
              : "Война";
    const repColor =
      rep >= 50
        ? 0x00ff88
        : rep >= 20
          ? 0x88ff88
          : rep >= -20
            ? 0xaaaaaa
            : rep >= -50
              ? 0xff8888
              : 0xff2222;

    const goods = this.planet.market.availableResources
      .slice(0, 4)
      .map((r) => RESOURCE_RU[r as string] ?? String(r))
      .join(", ");

    // Line 1: type • faction (coloured)
    const typeText = new Text({
      text: `${this.getType(this.planet.type)} • `,
      style: { fontFamily: "Courier New", fontSize: 13, fill: 0x889aaa },
    });
    typeText.eventMode = "none";
    typeText.anchor.set(0.5, 0);
    typeText.x = w / 2 - 40;
    typeText.y = topY;
    ui.addChild(typeText);

    const factionText = new Text({
      text: factionName,
      style: {
        fontFamily: "Courier New",
        fontSize: 13,
        fill: factionColor,
        fontWeight: "bold",
      },
    });
    factionText.eventMode = "none";
    factionText.anchor.set(0, 0);
    factionText.x = w / 2 - 40 + typeText.width;
    factionText.y = topY;
    ui.addChild(factionText);

    // Line 2: reputation status
    const repLine = new Text({
      text: `Отношение: `,
      style: { fontFamily: "Courier New", fontSize: 13, fill: 0x889aaa },
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
        fontSize: 13,
        fill: repColor,
        fontWeight: "bold",
      },
    });
    repText.eventMode = "none";
    repText.anchor.set(0, 0);
    repText.x = w / 2 - 30 + repLine.width;
    repText.y = topY + 20;
    ui.addChild(repText);

    // Line 3: market goods (or inhabitation status)
    const goodsLine = this.planet.isHabitable
      ? `Рынок: ${goods || "нет данных"}`
      : `Дроны: ${this.planet.drones}  •  Необитаемая`;
    const goodsText = new Text({
      text: goodsLine,
      style: {
        fontFamily: "Courier New",
        fontSize: 12,
        fill: 0x6688aa,
        align: "center",
      },
    });
    goodsText.eventMode = "none";
    goodsText.anchor.set(0.5, 0);
    goodsText.x = w / 2;
    goodsText.y = topY + 40;
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
    player.credits -= BRIBE_COST;
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

  /** Open the planet job board (EPIC-008): the quests this planet offers now. */
  private openJobBoard(): void {
    if (!this.gameEngine || !this.planet) return;
    this.closeJobBoard();
    const quests = this.gameEngine.getQuestBoard(this.planet.id);
    const { width, height } = this.renderer.app.screen;
    const activeCount = this.gameEngine.questManager.getActiveQuests().length;
    const acceptedIds = new Set<string>([
      ...this.gameEngine.questManager.getActiveQuests().map((q) => q.id),
      ...this.gameEngine.questManager.getCompletedQuestIds(),
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
    );
    this.renderer.uiLayer.addChild(this.jobBoardPanel.container);
  }

  private acceptJob(q: GeneratedQuest): void {
    if (!this.gameEngine || !this.planet) return;
    const accepted = this.gameEngine.acceptBoardQuest(q, this.planet.id);
    if (accepted) {
      this.showMessage(`Задание принято: ${q.template.title}`, 0x00ff88);
      this.openJobBoard(); // refresh — the accepted quest drops off the board
    } else {
      this.showMessage("Не удалось принять задание", 0xffaa00);
    }
  }

  private closeJobBoard(): void {
    const panel = this.jobBoardPanel;
    this.jobBoardPanel = null;
    if (panel) {
      this.renderer?.uiLayer?.removeChild(panel.container);
      panel.destroy();
    }
  }

  private openGarage(): void {
    if (!this.gameEngine?.player) return;
    const ship = this.gameEngine.player.ship;
    const missing = ship.maxHull - ship.hullHP;

    if (missing <= 0) {
      this.showMessage("Корпус уже в идеальном состоянии", 0x00ff88);
      return;
    }

    const cost = Math.ceil(missing * 2);
    if (this.gameEngine.player.credits < cost) {
      this.showMessage(
        `Недостаточно кредитов на ремонт (нужно ${cost})`,
        0xff5555,
      );
      return;
    }

    this.gameEngine.player.credits -= cost;
    ship.repair();
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
    // Research station is not implemented yet; give honest feedback instead of
    // silently swallowing the click.
    this.showMessage("Исследовательская станция пока в разработке", 0xffaa00);
  }

  private async takeOff(): Promise<void> {
    if (!this.gameEngine) return;
    const loadoutStats = this.gameEngine.playerLoadout?.derivedStats();
    if (loadoutStats && !loadoutStats.canTakeOff) {
      this.showMessage("Нет двигателя — взлёт невозможен", 0xff4444);
      return;
    }
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      // Spawn the ship next to this planet, not at the distant system edge.
      fromPlanetId: this.planet?.id,
    });
  }

  /**
   * Show a transient feedback message near the bottom of the planet screen.
   */
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
        fontSize: 16,
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

  private getType(type: string): string {
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
}
