import { Container, Graphics, Text, Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
import { scaledText } from "./ui/scaledText";
import { lineStepFor } from "./ui/questCardLayout";
import { scaledFont } from "@/utils/fontScale";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import { pickVariantKey, tex, loadTextureAsync } from "./textures";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { TextQuest, QuestNode, QuestChoice, QuestOutcome } from "@/types";
import type { QuestScript } from "@/systems/quests/QuestScript";
import { SceneType } from "@/types";
import { TextQuestRuntime } from "@/systems/quests/TextQuestRuntime";
import { QuestVM } from "@/systems/quests/QuestVM";
import type { NarratorContext } from "@/ai/adapters/QuestNarrator";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import { logger } from "@/utils/logger";

/**
 * Derive a fresh, still-reproducible seed for a quest restart. Mixing in the
 * attempt counter means a failed run replays with different random rolls
 * (no foreknowledge exploit), while staying derivable from the original seed
 * + attempt for debugging/log reproduction. `attempt` 0 returns the base seed
 * unchanged so the very first run is unaffected.
 */
export function deriveRestartSeed(
  baseSeed: number | string,
  attempt: number,
): string {
  return attempt <= 0 ? String(baseSeed) : `${baseSeed}:${attempt}`;
}

export interface TextQuestContext {
  gameEngine?: GameEngine;
  quest?: TextQuest;
  questScript?: QuestScript;
  seed?: number | string;
  returnScene?: SceneType;
  returnContext?: object;
  questId?: string;
}

export class TextQuestScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private quest: TextQuest | null = null;
  private returnScene: SceneType = SceneType.PLANET;
  private returnContext: object = {};

  private runtime: TextQuestRuntime = new TextQuestRuntime();
  private currentNode: QuestNode | null = null;

  private uiContainer: Container | null = null;
  private narrationText: Text | null = null;
  private choiceContainer: Container | null = null;

  // QuestVM path
  private vm: QuestVM | null = null;
  private vmSeed: number | string = 0;
  /**
   * Restart counter mixed into the seed on «Начать заново» so a failed run
   * does not replay with full foreknowledge of every random roll. Kept
   * derivable from `vmSeed` + attempt so a specific retry stays reproducible.
   */
  private restartAttempt = 0;
  private questScript: QuestScript | null = null;
  private questId: string | null = null;
  private vmNarrationText: Text | null = null;
  private vmChoiceContainer: Container | null = null;
  private vmParamPanel: Container | null = null;
  private autoExecuteTimer: ReturnType<typeof setTimeout> | null = null;
  private successTimer: ReturnType<typeof setTimeout> | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  /** Teardown for the contextual-help layer (first-time hint + «?» button). */
  private helpTeardown: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  /**
   * Wire contextual help (first-time auto-hint + always-available «?» reopen).
   * Mounted on `renderer.stage` so it sits above the panel and survives the
   * scene's layout rebuilds.
   */
  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "TEXT_QUEST",
    );
  }

  initialize(context?: object): void {
    const ctx = context as TextQuestContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.quest = ctx?.quest ?? null;
    this.questScript = ctx?.questScript ?? null;
    this.vmSeed = ctx?.seed ?? Date.now();
    this.questId = ctx?.questId ?? null;
    this.returnScene = ctx?.returnScene ?? SceneType.PLANET;
    this.returnContext = ctx?.returnContext ?? {};

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    this.mountHelp();

    if (this.questScript) {
      this.vm = new QuestVM(this.questScript, this.vmSeed);
      this.boundKeyDown = this.onVmKeyDown.bind(this);
      window.addEventListener("keydown", this.boundKeyDown);
      this.buildVmLayout();
      this.renderVmLocation();
      logger.info(
        `TextQuestScene: started VM quest "${this.questScript.title}"`,
      );
      return;
    }

    if (!this.quest) {
      logger.warn("TextQuestScene: no quest in context — returning");
      this.doReturn();
      return;
    }

    const player = this.gameEngine?.player;
    if (!player) {
      logger.warn("TextQuestScene: no player — returning");
      this.doReturn();
      return;
    }

    this.runtime = this.gameEngine?.textQuestRuntime ?? new TextQuestRuntime();

    try {
      this.currentNode = this.runtime.start(this.quest, player);
    } catch (e) {
      logger.error("TextQuestScene: failed to start quest", e);
      this.doReturn();
      return;
    }

    this.buildLayout();
    this.loadNodeText(this.currentNode);
    logger.info(`TextQuestScene: started quest "${this.quest.title}"`);
  }

  update(_dt: number): void {}

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.autoExecuteTimer !== null) {
      clearTimeout(this.autoExecuteTimer);
      this.autoExecuteTimer = null;
    }
    if (this.successTimer !== null) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.uiContainer = null;
    this.narrationText = null;
    this.choiceContainer = null;
    this.vm = null;
    this.questScript = null;
    this.vmNarrationText = null;
    this.vmChoiceContainer = null;
    this.vmParamPanel = null;
    this.gameEngine = null;
    this.quest = null;
    this.questId = null;
    this.currentNode = null;
  }

  // ── QuestVM Layout & Rendering ───────────────────────────────────────────────

  private buildVmLayout(): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const RIGHT_W = 192;
    const CONTENT_W = w - RIGHT_W - 8;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x020510, alpha: 0.97 });
    this.renderer.gameLayer.addChild(bg);

    const ui = new Container();
    this.uiContainer = ui;
    this.renderer.uiLayer.addChild(ui);

    // Title
    const title = scaledText(this.questScript?.title ?? "", 18, 0xff99ff, {
      rawColor: true,
      fontWeight: "bold",
    });
    title.anchor.set(0, 0);
    title.x = 16;
    title.y = 12;
    title.eventMode = "none";
    ui.addChild(title);

    const sep = new Graphics();
    sep.rect(8, 40, CONTENT_W - 8, 1);
    sep.fill({ color: 0xff99ff, alpha: 0.3 });
    ui.addChild(sep);

    // Description panel (top 60% of content area, below title)
    const contentTop = 48;
    const contentH = h - contentTop - 8;
    const descH = Math.floor(contentH * 0.58);

    const descBg = new Graphics();
    descBg.rect(8, contentTop, CONTENT_W - 16, descH);
    descBg.fill({ color: 0x05101c, alpha: 0.85 });
    descBg.stroke({ color: 0xff99ff, width: 1, alpha: 0.2 });
    ui.addChild(descBg);

    this.mountQuestIllustration(ui, descBg, {
      x: 8,
      y: contentTop,
      w: CONTENT_W - 16,
      h: descH,
    });

    const narText = scaledText("...", 14, 0xddeeff, {
      rawColor: true,
      wordWrap: true,
      wordWrapWidth: CONTENT_W - 48,
      lineHeight: 22,
    });
    narText.x = 24;
    narText.y = contentTop + 12;
    narText.eventMode = "none";
    this.vmNarrationText = narText;
    ui.addChild(narText);

    // Button area (bottom 40%)
    const btnAreaY = contentTop + descH + 8;
    const choiceArea = new Container();
    choiceArea.x = 8;
    choiceArea.y = btnAreaY;
    this.vmChoiceContainer = choiceArea;
    ui.addChild(choiceArea);

    // Right panel — parameters
    const paramBg = new Graphics();
    paramBg.rect(w - RIGHT_W, 0, RIGHT_W, h);
    paramBg.fill({ color: 0x040c18, alpha: 0.92 });
    paramBg.stroke({ color: 0x334466, width: 1 });
    ui.addChild(paramBg);

    const paramTitle = scaledText("ПАРАМЕТРЫ", 11, 0x6688aa, {
      rawColor: true,
    });
    paramTitle.x = w - RIGHT_W + 8;
    paramTitle.y = 10;
    paramTitle.eventMode = "none";
    ui.addChild(paramTitle);

    const paramPanel = new Container();
    paramPanel.x = w - RIGHT_W + 8;
    paramPanel.y = 30;
    this.vmParamPanel = paramPanel;
    ui.addChild(paramPanel);

    this.refreshVmParamPanel();

    // Permanent action buttons at the bottom of the right panel
    const btnPanelW = RIGHT_W - 16;
    const restartBtn = this.makeRightPanelButton(
      "Начать заново",
      w - RIGHT_W + 8,
      h - 86,
      btnPanelW,
      30,
      () => this.restartVm(),
    );
    ui.addChild(restartBtn);

    const quitBtn = this.makeRightPanelButton(
      "Сдаться",
      w - RIGHT_W + 8,
      h - 48,
      btnPanelW,
      30,
      () => this.doReturn(),
    );
    ui.addChild(quitBtn);
  }

  /**
   * Lazy quest illustration behind the description panel (Task 18). One
   * image per `QuestScript` id (`quest_art/<id>` — no numeric suffix, always
   * exactly one variant). Graceful no-art fallback: with no matching manifest
   * key the panel renders exactly as before (opaque dark fill, no image).
   */
  private mountQuestIllustration(
    ui: Container,
    descBg: Graphics,
    rect: { x: number; y: number; w: number; h: number },
  ): void {
    const scriptId = this.questScript?.id;
    if (!scriptId) return;
    const key = pickVariantKey("quest_art", scriptId, scriptId);
    if (!key) return;

    const mount = (t: Texture): void => {
      if (ui.destroyed || this.questScript?.id !== scriptId) return;
      const sp = new Sprite(t);
      const cover = Math.max(rect.w / t.width, rect.h / t.height);
      sp.scale.set(cover);
      sp.anchor.set(0.5);
      sp.x = rect.x + rect.w / 2;
      sp.y = rect.y + rect.h / 2;
      sp.eventMode = "none";

      const mask = new Graphics();
      mask.rect(rect.x, rect.y, rect.w, rect.h);
      mask.fill({ color: 0xffffff });
      mask.eventMode = "none";
      sp.mask = mask;

      // Insert sp first, then mask at the same index: addChildAt shifts sp to
      // idx+1, so the final order is mask(idx) behind sp(idx+1) — the opaque
      // mask rect must render BEHIND the sprite it clips, not on top of it.
      const idx = ui.getChildIndex(descBg);
      ui.addChildAt(sp, idx);
      ui.addChildAt(mask, idx);

      // Lighten the scrim so the art reads through while text stays legible.
      descBg.clear();
      descBg.rect(rect.x, rect.y, rect.w, rect.h);
      descBg.fill({ color: 0x05101c, alpha: 0.6 });
      descBg.stroke({ color: 0xff99ff, width: 1, alpha: 0.2 });
    };

    const cached = tex(key);
    if (cached) mount(cached);
    else
      void loadTextureAsync(key).then((t) => {
        if (t) mount(t);
      });
  }

  private makeRightPanelButton(
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void,
  ): Container {
    const btn = new Container();
    btn.x = x;
    btn.y = y;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x050e1a, alpha: 0.9 });
    bg.stroke({ color: 0x6688aa, width: 1 });
    btn.addChild(bg);

    const lbl = scaledText(label, 11, 0x99bbcc, { rawColor: true });
    lbl.anchor.set(0.5);
    lbl.x = w / 2;
    lbl.y = h / 2;
    lbl.eventMode = "none";
    btn.addChild(lbl);

    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.hitArea = {
      contains: (px: number, py: number) =>
        px >= 0 && py >= 0 && px <= w && py <= h,
    };
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      onClick();
    });
    btn.on("pointerover", () => {
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: 0x0a1a2e, alpha: 1 });
      bg.stroke({ color: 0xaaccee, width: 1 });
    });
    btn.on("pointerout", () => {
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: 0x050e1a, alpha: 0.9 });
      bg.stroke({ color: 0x6688aa, width: 1 });
    });
    return btn;
  }

  private refreshVmParamPanel(): void {
    if (!this.vmParamPanel || !this.vm || !this.questScript) return;
    while (this.vmParamPanel.children.length > 0) {
      const c = this.vmParamPanel.children[0];
      this.vmParamPanel.removeChild(c);
      c.destroy({ children: true });
    }

    const RIGHT_W = 192;
    const panelW = RIGHT_W - 16;
    let yOff = 0;

    for (const param of this.questScript.params) {
      if (!param.showInUI) continue;
      const value = this.vm.getParam(param.id);

      const nameT = scaledText(param.name, 11, 0x99bbcc, { rawColor: true });
      nameT.x = 0;
      nameT.y = yOff;
      nameT.eventMode = "none";
      this.vmParamPanel.addChild(nameT);
      // Steps by the name line's own font-scale line height so the value line
      // below it never overlaps at "L" (Task 3: the fixed +16 offset assumed
      // the "M"-scale ~14 px name-line height).
      yOff += lineStepFor(scaledFont(11));

      const valT = scaledText(String(value), 13, 0xeeeeff, {
        rawColor: true,
        fontWeight: "bold",
      });
      valT.x = 0;
      valT.y = yOff;
      valT.eventMode = "none";
      this.vmParamPanel.addChild(valT);
      // Steps by the value line's own font-scale line height so the progress
      // bar / next param never overlaps at "L" (Task 3: the fixed +18 offset
      // assumed the "M"-scale ~16 px value-line height).
      yOff += lineStepFor(scaledFont(13));

      // Progress bar if min/max range is meaningful
      if (param.max > param.min) {
        const barW = panelW - 4;
        const barBg = new Graphics();
        barBg.rect(0, yOff, barW, 6);
        barBg.fill({ color: 0x112233 });
        this.vmParamPanel.addChild(barBg);

        const ratio = Math.max(
          0,
          Math.min(1, (value - param.min) / (param.max - param.min)),
        );
        if (ratio > 0) {
          const barFill = new Graphics();
          barFill.rect(0, yOff, Math.floor(barW * ratio), 6);
          barFill.fill({ color: 0x44aaff });
          this.vmParamPanel.addChild(barFill);
        }
        yOff += 12;
      }

      yOff += 6;
    }
  }

  private renderVmLocation(): void {
    if (!this.vm || !this.vmNarrationText || !this.vmChoiceContainer) return;

    const loc = this.vm.currentLocation();
    this.vmNarrationText.text = this.vm.interpolate(loc.text);
    this.refreshVmParamPanel();

    // Clear old buttons
    while (this.vmChoiceContainer.children.length > 0) {
      const c = this.vmChoiceContainer.children[0];
      this.vmChoiceContainer.removeChild(c);
      c.destroy({ children: true });
    }

    if (this.vm.isFinished()) {
      this.handleVmFinished();
      return;
    }

    const transitions = this.vm.availableTransitions();
    const w = this.renderer.app.screen.width;
    const RIGHT_W = 192;
    const CONTENT_W = w - RIGHT_W - 8;
    const btnW = CONTENT_W - 32;
    const btnH = 36;
    const gap = 8;

    // Auto-execute: all available transitions are auto (routing/branching nodes)
    const autoT = transitions.find((t) => t.autoExecute);
    if (autoT && transitions.every((t) => t.autoExecute)) {
      const ellipsis = scaledText("...", 16, 0x6688aa, { rawColor: true });
      ellipsis.x = 8;
      ellipsis.y = 8;
      ellipsis.eventMode = "none";
      this.vmChoiceContainer.addChild(ellipsis);

      this.autoExecuteTimer = setTimeout(() => {
        this.autoExecuteTimer = null;
        if (this.vm) {
          try {
            this.vm.execute(autoT.id);
          } catch (e) {
            logger.warn("TextQuestScene VM: auto-execute failed", e);
          }
          this.renderVmLocation();
        }
      }, 800);
      return;
    }

    const limit = Math.min(transitions.length, 8);
    // Switch to a 2-column grid when there are more buttons than fit single-column
    const useTwoCols = limit > 4;
    const colW = useTwoCols ? Math.floor((btnW - 8) / 2) : btnW;
    for (let i = 0; i < limit; i++) {
      const t = transitions[i];
      const col = useTwoCols ? i % 2 : 0;
      const row = useTwoCols ? Math.floor(i / 2) : i;
      this.addVmTransitionButton(
        this.vmChoiceContainer,
        t.label,
        8 + col * (colW + 8),
        row * (btnH + gap),
        colW,
        btnH,
        () => this.executeVmTransition(t.id),
      );
    }
  }

  private addVmTransitionButton(
    parent: Container,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void,
  ): void {
    const btn = new Container();
    btn.x = x;
    btn.y = y;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x0a1a2e, alpha: 0.9 });
    bg.stroke({ color: 0xff99ff, width: 1 });
    btn.addChild(bg);

    const lbl = scaledText(label, 13, 0xeeeeff, {
      rawColor: true,
      wordWrap: true,
      wordWrapWidth: w - 24,
    });
    lbl.x = 12;
    lbl.y = (h - lbl.height) / 2;
    lbl.eventMode = "none";
    btn.addChild(lbl);

    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      onClick();
    });
    btn.on("pointerover", () => {
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: 0x1a2a44, alpha: 1 });
      bg.stroke({ color: 0xff99ff, width: 1 });
    });
    btn.on("pointerout", () => {
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: 0x0a1a2e, alpha: 0.9 });
      bg.stroke({ color: 0xff99ff, width: 1 });
    });

    parent.addChild(btn);
  }

  private executeVmTransition(transitionId: string): void {
    if (!this.vm) return;
    if (this.autoExecuteTimer !== null) {
      clearTimeout(this.autoExecuteTimer);
      this.autoExecuteTimer = null;
    }
    try {
      this.vm.execute(transitionId);
    } catch (e) {
      logger.warn("TextQuestScene VM: transition failed", e);
      return;
    }
    this.renderVmLocation();
  }

  /**
   * Restart the current VM quest with a freshly-derived seed so a failed run
   * cannot be replayed with foreknowledge of every random outcome (Task 1).
   */
  private restartVm(): void {
    if (this.successTimer !== null) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    if (this.autoExecuteTimer !== null) {
      clearTimeout(this.autoExecuteTimer);
      this.autoExecuteTimer = null;
    }
    if (!this.questScript) return;
    this.restartAttempt += 1;
    const seed = deriveRestartSeed(this.vmSeed, this.restartAttempt);
    this.vm = new QuestVM(this.questScript, seed);
    this.renderVmLocation();
  }

  private handleVmFinished(): void {
    if (!this.vm) return;
    if (this.vm.isSuccess()) {
      if (this.questId && this.gameEngine?.player) {
        this.gameEngine.questManager.forceCompleteQuest(
          this.questId,
          this.gameEngine.player,
        );
      }
      this.showToast("Квест выполнен!", 0x44ff88);
      this.successTimer = setTimeout(() => {
        this.successTimer = null;
        this.doReturn();
      }, 2000);
    } else {
      this.showToast("Провал. Нажмите «Начать заново».", 0xff6644);
    }
  }

  private onVmKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.doReturn();
    }
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  private buildLayout(): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x020510, alpha: 0.97 });
    this.renderer.gameLayer.addChild(bg);

    const ui = new Container();
    this.uiContainer = ui;
    this.renderer.uiLayer.addChild(ui);

    // Title
    const title = scaledText(this.quest?.title ?? "", 20, 0xff99ff, {
      rawColor: true,
      fontWeight: "bold",
    });
    title.anchor.set(0.5, 0);
    title.x = w / 2;
    title.y = 16;
    title.eventMode = "none";
    ui.addChild(title);

    // Separator
    const sep = new Graphics();
    sep.rect(w * 0.05, 48, w * 0.9, 1);
    sep.fill({ color: 0xff99ff, alpha: 0.3 });
    ui.addChild(sep);

    // Narration area (top 60%)
    const narAreaH = Math.floor(h * 0.52);
    const narAreaBg = new Graphics();
    narAreaBg.rect(w * 0.05, 56, w * 0.9, narAreaH);
    narAreaBg.fill({ color: 0x05101c, alpha: 0.85 });
    narAreaBg.stroke({ color: 0xff99ff, width: 1, alpha: 0.2 });
    ui.addChild(narAreaBg);

    const narText = scaledText("...", 14, 0xddeeff, {
      rawColor: true,
      wordWrap: true,
      wordWrapWidth: w * 0.9 - 32,
      lineHeight: 22,
    });
    narText.x = w * 0.05 + 16;
    narText.y = 72;
    narText.eventMode = "none";
    this.narrationText = narText;
    ui.addChild(narText);

    // Choice container (bottom 40%)
    const choiceArea = new Container();
    choiceArea.y = Math.floor(h * 0.62);
    this.choiceContainer = choiceArea;
    ui.addChild(choiceArea);

    // Exit button
    const exitY = h - 36;
    this.addExitButton(ui, w / 2, exitY);
  }

  private addExitButton(parent: Container, cx: number, cy: number): void {
    const t = scaledText("[ Выйти ]", 15, 0xaaaaaa, {
      rawColor: true,
      fontWeight: "bold",
    });
    t.anchor.set(0.5);
    t.x = cx;
    t.y = cy;
    t.eventMode = "static";
    t.cursor = "pointer";
    t.on("pointerdown", (e) => {
      e.stopPropagation();
      this.doReturn();
    });
    t.on("pointerover", () => {
      t.alpha = 0.6;
    });
    t.on("pointerout", () => {
      t.alpha = 1;
    });
    parent.addChild(t);
  }

  // ── Narration loading ───────────────────────────────────────────────────────

  private loadNodeText(node: QuestNode): void {
    if (!this.narrationText) return;
    this.narrationText.text = "...";

    const ctx: NarratorContext = {
      role: this.getPlayerRole(),
      tone: "серьёзный",
      systemName: this.getCurrentSystemName(),
      daysSinceStart: this.gameEngine?.galaxy?.gameDays ?? 0,
    };

    const narrator = this.gameEngine?.questNarrator;
    if (narrator) {
      narrator
        .narrate(node.textKey, ctx)
        .then((text) => {
          if (this.narrationText && !this.narrationText.destroyed) {
            this.narrationText.text = text;
          }
          this.renderChoices(node);
        })
        .catch((err) => {
          logger.warn("TextQuestScene: narrator failed", err);
          if (this.narrationText && !this.narrationText.destroyed) {
            this.narrationText.text = node.textKey.replace(/[._]/g, " ");
          }
          this.renderChoices(node);
        });
    } else {
      this.narrationText.text = node.textKey.replace(/[._]/g, " ");
      this.renderChoices(node);
    }
  }

  // ── Choice rendering ────────────────────────────────────────────────────────

  private renderChoices(node: QuestNode): void {
    if (!this.choiceContainer) return;
    // Clear old choices
    while (this.choiceContainer.children.length > 0) {
      const child = this.choiceContainer.children[0];
      this.choiceContainer.removeChild(child);
      child.destroy({ children: true });
    }

    const w = this.renderer.app.screen.width;
    const player = this.gameEngine?.player;
    const btnW = w * 0.8;
    const btnH = 40;
    const gap = 10;
    let yOff = 0;

    for (let i = 0; i < node.choices.length; i++) {
      const choice = node.choices[i];
      const condFail = this.getConditionFailReason(choice, player);
      const disabled = condFail !== null;

      this.addChoiceButton(
        this.choiceContainer,
        choice.label,
        condFail,
        (w - btnW) / 2,
        yOff,
        btnW,
        btnH,
        disabled,
        () => this.onChoiceClick(node.id, i, node.choices),
      );
      yOff += btnH + gap;
    }
  }

  private addChoiceButton(
    parent: Container,
    label: string,
    tooltip: string | null,
    x: number,
    y: number,
    w: number,
    h: number,
    disabled: boolean,
    onClick: () => void,
  ): void {
    const btn = new Container();
    btn.x = x;
    btn.y = y;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    if (disabled) {
      bg.fill({ color: 0x111122, alpha: 0.7 });
      bg.stroke({ color: 0x334455, width: 1 });
    } else {
      bg.fill({ color: 0x0a1a2e, alpha: 0.9 });
      bg.stroke({ color: 0xff99ff, width: 1 });
    }
    btn.addChild(bg);

    const lbl = scaledText(
      disabled ? `${label}  ` : label,
      13,
      disabled ? 0x445566 : 0xeeeeff,
      { rawColor: true, wordWrap: true, wordWrapWidth: w - 24 },
    );
    lbl.x = 12;
    lbl.y = (h - lbl.height) / 2;
    lbl.eventMode = "none";
    btn.addChild(lbl);

    if (disabled && tooltip) {
      const hint = scaledText(`↳ ${tooltip}`, 11, 0xff6644, { rawColor: true });
      hint.x = 12;
      hint.y = h - 16;
      hint.eventMode = "none";
      btn.addChild(hint);
    }

    if (!disabled) {
      btn.eventMode = "static";
      btn.cursor = "pointer";
      btn.on("pointerdown", (e) => {
        e.stopPropagation();
        onClick();
      });
      btn.on("pointerover", () => {
        bg.clear();
        bg.rect(0, 0, w, h);
        bg.fill({ color: 0x1a2a44, alpha: 1 });
        bg.stroke({ color: 0xff99ff, width: 1 });
      });
      btn.on("pointerout", () => {
        bg.clear();
        bg.rect(0, 0, w, h);
        bg.fill({ color: 0x0a1a2e, alpha: 0.9 });
        bg.stroke({ color: 0xff99ff, width: 1 });
      });
    } else {
      btn.eventMode = "none";
    }

    parent.addChild(btn);
  }

  // ── Choice handling ─────────────────────────────────────────────────────────

  private onChoiceClick(
    nodeId: string,
    choiceIdx: number,
    choices: readonly QuestChoice[],
  ): void {
    const player = this.gameEngine?.player;
    if (!player || !this.quest) return;

    let nextNode: QuestNode | null;
    try {
      nextNode = this.runtime.choose(nodeId, choiceIdx, player);
    } catch (e) {
      if (e instanceof GameBusinessException) {
        this.showToast(e.message, 0xff6644);
      }
      return;
    }

    const choice = choices[choiceIdx];

    if (nextNode === null) {
      // Terminal node — apply outcome and show result
      const outcome = choice.outcome;
      if (outcome) {
        this.runtime.applyOutcome(outcome, player, this.gameEngine?.bank);
        this.showResultPanel(outcome);
      } else {
        this.doReturn();
      }
      return;
    }

    // Non-terminal: load next node
    this.currentNode = nextNode;
    this.loadNodeText(nextNode);
  }

  // ── Result panel ────────────────────────────────────────────────────────────

  private showResultPanel(outcome: QuestOutcome): void {
    if (!this.uiContainer) return;
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    // Dim overlay
    const overlay = new Container();
    const dimBg = new Graphics();
    dimBg.rect(0, 0, w, h);
    dimBg.fill({ color: 0x000000, alpha: 0.75 });
    dimBg.eventMode = "static";
    dimBg.on("pointerdown", (e) => e.stopPropagation());
    overlay.addChild(dimBg);

    // Result box
    const boxW = 420;
    const boxH = 220;
    const boxX = (w - boxW) / 2;
    const boxY = (h - boxH) / 2;
    const box = new Graphics();
    box.rect(boxX, boxY, boxW, boxH);
    box.fill({ color: 0x05101c, alpha: 0.98 });
    box.stroke({ color: 0xff99ff, width: 2 });
    overlay.addChild(box);

    const header = scaledText("✦ КВЕСТ ЗАВЕРШЁН", 18, 0xff99ff, {
      rawColor: true,
      fontWeight: "bold",
    });
    header.anchor.set(0.5, 0);
    header.x = w / 2;
    header.y = boxY + 16;
    header.eventMode = "none";
    overlay.addChild(header);

    const lines: string[] = [];
    if (outcome.creditsDelta > 0) lines.push(`+${outcome.creditsDelta} ₡`);
    if (outcome.creditsDelta < 0) lines.push(`${outcome.creditsDelta} ₡`);
    if (outcome.reputationDelta !== 0 && outcome.factionId) {
      const sign = outcome.reputationDelta > 0 ? "+" : "";
      lines.push(
        `${sign}${outcome.reputationDelta} репутация (${outcome.factionId})`,
      );
    }
    if (outcome.itemGained)
      lines.push(`Получен предмет: ${outcome.itemGained}`);
    if (outcome.journalEntry) lines.push(`Журнал: ${outcome.journalEntry}`);

    let lineY = boxY + 52;
    for (const line of lines) {
      const lt = scaledText(line, 13, 0xccddee, { rawColor: true });
      lt.anchor.set(0.5, 0);
      lt.x = w / 2;
      lt.y = lineY;
      lt.eventMode = "none";
      overlay.addChild(lt);
      lineY += 22;
    }

    // Continue button
    const continueBtnY = boxY + boxH - 46;
    const contBtnW = 260;
    const contBtn = new Container();
    contBtn.x = (w - contBtnW) / 2;
    contBtn.y = continueBtnY;
    contBtn.eventMode = "static";
    contBtn.cursor = "pointer";

    const contBg = new Graphics();
    contBg.rect(0, 0, contBtnW, 34);
    contBg.fill({ color: 0x1a0a2e, alpha: 0.9 });
    contBg.stroke({ color: 0xff99ff, width: 1 });
    contBtn.addChild(contBg);

    const contLbl = scaledText("[ Продолжить ]", 15, 0xff99ff, {
      rawColor: true,
      fontWeight: "bold",
    });
    contLbl.anchor.set(0.5);
    contLbl.x = contBtnW / 2;
    contLbl.y = 17;
    contLbl.eventMode = "none";
    contBtn.addChild(contLbl);

    contBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      if (!overlay.destroyed) overlay.destroy({ children: true });
      this.doReturn();
    });

    overlay.addChild(contBtn);
    this.uiContainer.addChild(overlay);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private getConditionFailReason(
    choice: QuestChoice,
    player:
      | {
          credits: number;
          getReputation: (id: string) => number;
          inventory: { resources: { type: string; amount: number }[] };
        }
      | null
      | undefined,
  ): string | null {
    if (!player) return null;
    for (const cond of choice.conditions) {
      if (cond.type === "credits" && cond.comparison === ">=") {
        if (player.credits < cond.value) {
          return `Нужно ${cond.value} ₡`;
        }
      } else if (cond.type === "reputation" && cond.comparison === ">=") {
        if ((player.getReputation(cond.factionId ?? "") ?? 0) < cond.value) {
          return `Нужна репутация ${cond.value}`;
        }
      } else if (cond.type === "item") {
        const stack = player.inventory.resources.find(
          (r) => r.type === (cond.itemId as string),
        );
        const qty = stack?.amount ?? 0;
        if (cond.comparison === ">=" && qty < cond.value) {
          return `Нужен предмет: ${cond.itemId}`;
        }
      }
    }
    return null;
  }

  private getPlayerRole(): string {
    const faction = this.gameEngine?.player?.faction;
    return faction ? String(faction) : "пилот";
  }

  private getCurrentSystemName(): string {
    const sysId = this.gameEngine?.player?.currentSystemId;
    if (!sysId || !this.gameEngine?.galaxy) return "неизвестная система";
    return (
      this.gameEngine.galaxy.systems.find((s) => s.id === sysId)?.name ??
      "неизвестная система"
    );
  }

  private showToast(text: string, color: number): void {
    if (!this.uiContainer) return;
    const w = this.renderer.app.screen.width;
    const toast = scaledText(text, 13, color, {
      rawColor: true,
      fontWeight: "bold",
      align: "center",
    });
    toast.anchor.set(0.5);
    toast.x = w / 2;
    toast.y = this.renderer.app.screen.height - 60;
    toast.eventMode = "none";
    this.uiContainer.addChild(toast);
    setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
    }, 2500);
  }

  private doReturn(): void {
    if (!this.gameEngine) return;
    this.gameEngine
      .transitionTo(this.returnScene, {
        gameEngine: this.gameEngine,
        ...this.returnContext,
        // Exiting the quest (win / «Сдаться» / «Выйти» / Esc) must NOT bounce
        // straight back in: tell the destination scene to skip its auto-resume
        // of the still-active TEXT_ADVENTURE quest for this one return. A genuine
        // fresh landing carries no flag and resumes as before.
        resumeTextQuest: false,
      })
      .catch((e) =>
        logger.error("TextQuestScene: return transition failed", e),
      );
  }
}
