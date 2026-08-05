import { GameScene } from "./GameScene";
import { Container, Graphics, Text } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { NPC } from "@/domain/NPC";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { bindModalKeys } from "./ui/bindModalKeys";

export interface DialogueNode {
  id: string;
  npcText: string;
  responses: DialogueResponse[];
  questOfferId?: string; // ID of quest to offer
}

export interface DialogueResponse {
  text: string;
  nextNodeId: string | null; // null means end dialogue
  acceptsQuest?: boolean; // If true, accepts the offered quest
  completesQuest?: string; // If set, completes the quest with this ID
}

export interface DialogueTree {
  npcId: string;
  npcName: string;
  startNodeId: string;
  nodes: Map<string, DialogueNode>;
}

export class DialogueScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private currentNPC: NPC | null = null;
  private dialogueTree: DialogueTree | null = null;
  private currentNode: DialogueNode | null = null;
  private returnScene: SceneType = SceneType.SPACE_FLIGHT;
  private returnPlanet: unknown = null;

  private dialogueContainer: Container | null = null;
  private npcPortrait: Graphics | null = null;
  private npcNameText: Text | null = null;
  private dialogueText: Text | null = null;
  private responseButtons: Container[] = [];
  private detachModalKeys: (() => void) | null = null;

  initialize(context?: object): void {
    const ctx = context as {
      gameEngine?: GameEngine;
      npc?: NPC;
      returnScene?: SceneType;
      returnPlanet?: unknown;
    };
    this.gameEngine = ctx?.gameEngine ?? null;
    this.currentNPC = ctx?.npc ?? null;
    this.returnScene = ctx?.returnScene ?? SceneType.SPACE_FLIGHT;
    this.returnPlanet = ctx?.returnPlanet ?? null;

    if (!this.currentNPC) {
      logger.error("DialogueScene initialized without NPC");
      return;
    }

    this.dialogueTree = this.loadDialogueTree(this.currentNPC.id);
    if (!this.dialogueTree) {
      logger.warn(
        `No dialogue tree for NPC: ${this.currentNPC.id} — showing fallback`,
      );
      const fallbackNodes = new Map<string, DialogueNode>();
      fallbackNodes.set("fallback", {
        id: "fallback",
        npcText: "Нет слов для разговора.",
        responses: [{ text: "Завершить", nextNodeId: null }],
      });
      this.dialogueTree = {
        npcId: this.currentNPC.id,
        npcName: this.currentNPC.name,
        startNodeId: "fallback",
        nodes: fallbackNodes,
      };
    }

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    this.createDialogueUI();
    this.displayNode(this.dialogueTree.startNodeId);

    this.detachModalKeys = bindModalKeys({
      onConfirm: () => this.confirmPrimaryResponse(),
      onCancel: () => void this.goBack(),
    });

    logger.info(`DialogueScene initialized with NPC: ${this.currentNPC.name}`);
  }

  private confirmPrimaryResponse(): void {
    const primary = this.currentNode?.responses[0];
    if (primary) this.onResponseSelected(primary);
  }

  update(_deltaTime: number): void {
    // No updates needed for static dialogue
  }

  destroy(): void {
    this.detachModalKeys?.();
    this.detachModalKeys = null;
    this.responseButtons = [];
    this.dialogueContainer = null;
    this.npcPortrait = null;
    this.npcNameText = null;
    this.dialogueText = null;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    logger.info("DialogueScene destroyed");
  }

  private loadDialogueTree(npcId: string): DialogueTree | null {
    if (npcId.includes("governor")) {
      const nodes = new Map<string, DialogueNode>();

      const completedQuests = this.gameEngine?.questManager
        .getActiveQuests()
        .filter((q) => q.isCompleted);

      const greetingResponses: DialogueResponse[] = [];

      if (completedQuests && completedQuests.length > 0) {
        greetingResponses.push({
          text: `Я выполнил задание: ${completedQuests[0].title}`,
          nextNodeId: "quest_complete",
          completesQuest: completedQuests[0].id,
        });
      }

      greetingResponses.push(
        { text: "Нужна ли помощь?", nextNodeId: "quest_offer" },
        { text: "Просто осматриваюсь", nextNodeId: "casual_chat" },
        { text: "Прощайте", nextNodeId: null },
      );

      nodes.set("greeting", {
        id: "greeting",
        npcText: "Приветствую, рейнджер. Что привело вас в нашу систему?",
        responses: greetingResponses,
      });

      nodes.set("quest_offer", {
        id: "quest_offer",
        npcText:
          "Да, у нас проблема. Нам нужна руда для строительства. Не могли бы вы доставить 10 единиц руды на станцию Омега? Мы заплатим 100 кредитов.",
        responses: [
          {
            text: "Принять квест",
            nextNodeId: "quest_accepted",
            acceptsQuest: true,
          },
          { text: "Отказаться", nextNodeId: "greeting" },
        ],
        questOfferId: "quest_delivery_ore",
      });

      nodes.set("quest_accepted", {
        id: "quest_accepted",
        npcText: "Отлично! Жду хороших новостей. Удачи, рейнджер!",
        responses: [{ text: "До связи", nextNodeId: null }],
      });

      let questCompleteText = "Отличная работа, рейнджер! Вот ваша награда:";
      if (completedQuests && completedQuests.length > 0) {
        const reward = completedQuests[0].reward;
        questCompleteText += `\n\n+ ${reward.credits} кредитов\n+ ${reward.experience} опыта`;
        if (reward.items.length > 0) {
          questCompleteText += `\n+ Предметы: ${reward.items.map((i) => i.amount + "x " + i.type).join(", ")}`;
        }
      }

      nodes.set("quest_complete", {
        id: "quest_complete",
        npcText: questCompleteText,
        responses: [{ text: "Спасибо!", nextNodeId: null }],
      });

      nodes.set("casual_chat", {
        id: "casual_chat",
        npcText:
          "Наша система богата ресурсами. Может, захотите здесь остаться?",
        responses: [
          { text: "Расскажите больше", nextNodeId: "system_info" },
          { text: "Пожалуй, нет", nextNodeId: "greeting" },
        ],
      });

      nodes.set("system_info", {
        id: "system_info",
        npcText:
          "У нас три планеты: промышленная, сельскохозяйственная и торговая. Каждая играет важную роль в экономике.",
        responses: [{ text: "Интересно", nextNodeId: "greeting" }],
      });

      return {
        npcId,
        npcName: "Губернатор",
        startNodeId: "greeting",
        nodes,
      };
    }

    return null;
  }

  private createDialogueUI(): void {
    this.dialogueContainer = new Container();

    const screenWidth = this.renderer.app.screen.width;
    const screenHeight = this.renderer.app.screen.height;

    const backdrop = new Graphics();
    backdrop.rect(0, 0, screenWidth, screenHeight);
    backdrop.fill({ color: 0x000000, alpha: 0.7 });
    this.dialogueContainer.addChild(backdrop);

    const panelWidth = 700;
    const panelHeight = 400;
    const panelX = (screenWidth - panelWidth) / 2;
    const panelY = (screenHeight - panelHeight) / 2;

    const panel = new Graphics();
    panel.rect(panelX, panelY, panelWidth, panelHeight);
    panel.fill({ color: 0x1a1a2e, alpha: 0.95 });
    panel.stroke({ color: 0x00ffff, width: 2 });
    this.dialogueContainer.addChild(panel);

    this.npcPortrait = new Graphics();
    this.npcPortrait.circle(panelX + 60, panelY + 60, 40);
    this.npcPortrait.fill({ color: 0x4488cc });
    this.dialogueContainer.addChild(this.npcPortrait);

    this.npcNameText = new Text({
      text: this.dialogueTree?.npcName ?? "NPC",
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0x00ffff,
        fontWeight: "bold",
      },
    });
    this.npcNameText.x = panelX + 120;
    this.npcNameText.y = panelY + 30;
    this.dialogueContainer.addChild(this.npcNameText);

    this.dialogueText = new Text({
      text: "",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffffff,
        wordWrap: true,
        wordWrapWidth: panelWidth - 40,
      },
    });
    this.dialogueText.x = panelX + 20;
    this.dialogueText.y = panelY + 100;
    this.dialogueContainer.addChild(this.dialogueText);

    this.renderer.uiLayer.addChild(this.dialogueContainer);
  }

  private displayNode(nodeId: string): void {
    if (!this.dialogueTree) return;

    const node = this.dialogueTree.nodes.get(nodeId);
    if (!node) {
      logger.error(`Dialogue node not found: ${nodeId}`);
      return;
    }

    this.currentNode = node;

    if (this.dialogueText) {
      this.dialogueText.text = node.npcText;
    }

    for (const btn of this.responseButtons) {
      btn.destroy({ children: true });
    }
    this.responseButtons = [];

    const panelX = (this.renderer.app.screen.width - 700) / 2;
    const panelY = (this.renderer.app.screen.height - 400) / 2;
    const buttonStartY = panelY + 250;

    for (let i = 0; i < node.responses.length; i++) {
      const response = node.responses[i];
      const button = this.createResponseButton(
        response.text,
        panelX + 20,
        buttonStartY + i * 50,
        () => this.onResponseSelected(response),
      );
      this.responseButtons.push(button);
      this.dialogueContainer?.addChild(button);
    }
  }

  private createResponseButton(
    text: string,
    x: number,
    y: number,
    onClick: () => void,
  ): Container {
    const container = new Container();
    container.x = x;
    container.y = y;

    const bg = new Graphics();
    bg.rect(0, 0, 660, 40);
    bg.fill({ color: 0x16213e, alpha: 0.9 });
    bg.stroke({ color: 0x00ffff, width: 1 });
    container.addChild(bg);

    const buttonText = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffffff,
      },
    });
    buttonText.x = 10;
    buttonText.y = 10;
    container.addChild(buttonText);

    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointerdown", onClick);
    container.on("pointerover", () => {
      bg.clear();
      bg.rect(0, 0, 660, 40);
      bg.fill({ color: 0x1f4068, alpha: 0.9 });
      bg.stroke({ color: 0x00ffff, width: 2 });
    });
    container.on("pointerout", () => {
      bg.clear();
      bg.rect(0, 0, 660, 40);
      bg.fill({ color: 0x16213e, alpha: 0.9 });
      bg.stroke({ color: 0x00ffff, width: 1 });
    });

    return container;
  }

  private onResponseSelected(response: DialogueResponse): void {
    logger.debug(`Response selected: ${response.text}`);

    if (
      response.acceptsQuest &&
      this.currentNode?.questOfferId &&
      this.gameEngine?.player
    ) {
      const questManager = this.gameEngine.questManager;
      const planetId = this.gameEngine.player.currentSystemId; // Use current system as planet ID for MVP
      const currentDay = this.gameEngine.galaxy?.gameDays ?? 0;
      const quest = questManager.acceptQuest(
        this.currentNode.questOfferId,
        planetId,
        currentDay,
      );
      if (quest) {
        logger.info(
          `Quest accepted: ${quest.title} (Deadline: ${quest.deadline === 0 ? "none" : `${quest.deadline} days`})`,
        );
      }
    }

    if (response.completesQuest && this.gameEngine?.player) {
      const questManager = this.gameEngine.questManager;
      const success = questManager.completeQuest(
        response.completesQuest,
        this.gameEngine.player,
      );
      if (success) {
        logger.info(`Quest completed: ${response.completesQuest}`);
      }
    }

    if (response.nextNodeId) {
      this.displayNode(response.nextNodeId);
    } else {
      this.closeDialogue();
    }
  }

  async goBack(): Promise<void> {
    await this.closeDialogue();
  }

  private async closeDialogue(): Promise<void> {
    logger.info("Closing dialogue");
    if (!this.gameEngine) return;

    if (this.returnScene === SceneType.PLANET && this.returnPlanet) {
      await this.gameEngine.transitionTo(SceneType.PLANET, {
        gameEngine: this.gameEngine,
        planet: this.returnPlanet,
      });
    } else {
      await this.gameEngine.transitionTo(this.returnScene, {
        gameEngine: this.gameEngine,
      });
    }
  }
}
