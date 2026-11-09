import { GameScene } from "./GameScene";
import { Graphics, Text, Container } from "pixi.js";
import { scaledText } from "./ui/scaledText";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import {
  listSlotRows,
  deleteSlot,
  setSlotName,
  defaultSlotName,
  type SlotRow,
} from "@/systems/saves/saveSlots";

interface SaveLoadContext {
  gameEngine?: GameEngine;
  returnTo?: SceneType;
}

interface PendingConfirm {
  readonly slotId: string;
  readonly action: "delete" | "overwrite";
}

export class SaveLoadScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private returnTo: SceneType = SceneType.MAIN_MENU;
  private rows: SlotRow[] = [];
  private background: Graphics | null = null;
  private listContainer: Container | null = null;
  private messageText: Text | null = null;
  private pendingConfirm: PendingConfirm | null = null;
  private flashMessage: { message: string; color: number } | null = null;

  initialize(context?: object): void {
    this.renderer.app.stage.eventMode = "static";
    const ctx = context as SaveLoadContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.returnTo = ctx?.returnTo ?? SceneType.MAIN_MENU;
    void this.refresh();
    logger.info("SaveLoadScene initialized");
  }

  update(): void {
    /* static screen — nothing to animate */
  }

  destroy(): void {
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.background = null;
    this.listContainer = null;
    this.messageText = null;
    this.gameEngine = null;
    this.rows = [];
    this.pendingConfirm = null;
    logger.info("SaveLoadScene destroyed");
  }

  private get saveManager() {
    return this.gameEngine?.saveManager ?? null;
  }

  canSave(): boolean {
    return !!(this.gameEngine?.player && this.gameEngine?.galaxy);
  }

  async refresh(): Promise<void> {
    const mgr = this.saveManager;
    this.rows = mgr ? await listSlotRows(mgr) : [];
    this.render();
  }

  getRows(): readonly SlotRow[] {
    return this.rows;
  }

  async loadSlot(slotId: string): Promise<void> {
    if (!this.gameEngine) return;
    try {
      const ok = await this.gameEngine.loadGame(slotId);
      if (!ok) this.showMessage("Сохранение не найдено", 0xffaa44);
    } catch (e) {
      logger.error("SaveLoadScene: load failed", e);
      this.showMessage("Не удалось загрузить сохранение");
    }
  }

  async saveSlot(slotId: string, name?: string): Promise<void> {
    if (!this.gameEngine || !this.canSave()) return;
    try {
      await this.gameEngine.saveGame(slotId);
      if (typeof name === "string" && name.trim().length > 0) {
        setSlotName(slotId, name);
      }
      await this.refresh();
      this.showMessage("Сохранено", 0x66ffaa);
    } catch (e) {
      logger.error("SaveLoadScene: save failed", e);
      this.showMessage("Не удалось сохранить");
    }
  }

  async removeSlot(slotId: string): Promise<void> {
    const mgr = this.saveManager;
    if (!mgr) return;
    try {
      await deleteSlot(mgr, slotId);
      await this.refresh();
    } catch (e) {
      logger.error("SaveLoadScene: delete failed", e);
      this.showMessage("Не удалось удалить");
    }
  }

  async createSave(slotId: string): Promise<void> {
    const name = this.promptName(defaultSlotName(slotId));
    await this.saveSlot(slotId, name);
  }

  requestConfirm(slotId: string, action: "delete" | "overwrite"): void {
    this.pendingConfirm = { slotId, action };
    this.render();
  }

  cancelConfirm(): void {
    this.pendingConfirm = null;
    this.render();
  }

  async confirmPending(): Promise<void> {
    const pending = this.pendingConfirm;
    this.pendingConfirm = null;
    if (!pending) return;
    if (pending.action === "delete") {
      await this.removeSlot(pending.slotId);
    } else {
      const existing =
        this.rows.find((r) => r.slotId === pending.slotId)?.name ??
        defaultSlotName(pending.slotId);
      const name = this.promptName(existing);
      await this.saveSlot(pending.slotId, name);
    }
  }

  goBack(): void {
    const engine = this.gameEngine;
    if (!engine) return;
    void engine.transitionTo(this.returnTo, { gameEngine: engine });
  }

  private promptName(current: string): string | undefined {
    try {
      if (
        typeof window !== "undefined" &&
        typeof window.prompt === "function"
      ) {
        const input = window.prompt("Название сохранения:", current);
        return input === null ? undefined : input;
      }
    } catch {
      /* prompt unavailable — keep current name */
    }
    return undefined;
  }

  private showMessage(message: string, color = 0xff5555): void {
    this.flashMessage = { message, color };
    this.render();
  }

  private render(): void {
    const app = this.renderer?.app;
    if (!app || !app.screen) return; // no real renderer (unit tests) — skip
    const width = app.screen.width;
    const height = app.screen.height;
    if (width === 0 || height === 0) return;

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    this.background = new Graphics();
    this.background.rect(0, 0, width, height);
    this.background.fill({ color: 0x05080f, alpha: 1 });
    this.renderer.gameLayer.addChild(this.background);

    const title = scaledText("СОХРАНЕНИЯ", 30, 0x00ffff, {
      rawColor: true,
      fontFamily: "Courier New",
      letterSpacing: 4,
      fontWeight: "bold",
    });
    title.anchor.set(0.5, 0);
    title.x = width / 2;
    title.y = 24;
    this.renderer.uiLayer.addChild(title);

    const backBtn = this.makeButton("‹ Назад", 0x88ccff, () => this.goBack());
    backBtn.x = 28;
    backBtn.y = 30;
    backBtn.anchor.set(0, 0);
    this.renderer.uiLayer.addChild(backBtn);

    this.listContainer = new Container();
    this.listContainer.x = width / 2;
    this.listContainer.y = 80;
    this.renderer.uiLayer.addChild(this.listContainer);

    const rowHeight = 48;
    const rowWidth = Math.min(640, width - 60);
    this.rows.forEach((row, i) => {
      const node = this.renderRow(row, rowWidth, rowHeight);
      node.x = -rowWidth / 2;
      node.y = i * (rowHeight + 6);
      this.listContainer!.addChild(node);
    });

    if (this.flashMessage) {
      this.messageText = scaledText(
        this.flashMessage.message,
        16,
        this.flashMessage.color,
        { rawColor: true, fontFamily: "Courier New" },
      );
      this.messageText.anchor.set(0.5, 1);
      this.messageText.x = width / 2;
      this.messageText.y = height - 16;
      this.renderer.uiLayer.addChild(this.messageText);
      this.flashMessage = null;
    }
  }

  private renderRow(row: SlotRow, w: number, h: number): Container {
    const node = new Container();

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 6);
    bg.fill({ color: row.occupied ? 0x14213a : 0x0c1320, alpha: 0.9 });
    bg.stroke({ color: row.isAuto ? 0x335577 : 0x223344, width: 1 });
    node.addChild(bg);

    const MAX_NAME_CHARS = 28;
    const displayName =
      row.name.length > MAX_NAME_CHARS
        ? `${row.name.slice(0, MAX_NAME_CHARS - 1)}…`
        : row.name;
    const nameText = scaledText(
      displayName,
      16,
      row.occupied ? 0xffffff : 0x778899,
      {
        rawColor: true,
        fontFamily: "Courier New",
        fontWeight: "bold",
      },
    );
    nameText.eventMode = "none";
    nameText.x = 12;
    nameText.y = 6;
    node.addChild(nameText);

    const detail = row.occupied
      ? `${row.dateLabel}   ${row.summary}`
      : "— пусто —";
    const detailText = scaledText(detail, 12, 0x99aabb, {
      rawColor: true,
      fontFamily: "Courier New",
    });
    detailText.eventMode = "none";
    detailText.x = 12;
    detailText.y = 28;
    node.addChild(detailText);

    let rightX = w - 12;
    const addAction = (label: string, color: number, cb: () => void): void => {
      const btn = this.makeButton(label, color, cb);
      btn.anchor.set(1, 0.5);
      btn.x = rightX;
      btn.y = h / 2;
      node.addChild(btn);
      rightX -= btn.width + 16;
    };

    const confirming =
      this.pendingConfirm && this.pendingConfirm.slotId === row.slotId;
    if (confirming) {
      addAction("Отмена", 0x99aabb, () => this.cancelConfirm());
      addAction(
        this.pendingConfirm!.action === "delete" ? "Удалить?" : "Перезаписать?",
        0xff7755,
        () => void this.confirmPending(),
      );
      return node;
    }

    if (row.occupied) {
      addAction("Удалить", 0xff6666, () =>
        this.requestConfirm(row.slotId, "delete"),
      );
      addAction("Загрузить", 0x66ddff, () => void this.loadSlot(row.slotId));
      if (this.canSave() && !row.isAuto) {
        addAction("Перезаписать", 0xffcc55, () =>
          this.requestConfirm(row.slotId, "overwrite"),
        );
      }
    } else if (this.canSave()) {
      addAction("Сохранить", 0x66ff99, () => void this.createSave(row.slotId));
    }

    return node;
  }

  private makeButton(text: string, color: number, cb: () => void): Text {
    const btn = scaledText(text, 14, color, {
      rawColor: true,
      fontFamily: "Courier New",
      fontWeight: "bold",
    });
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      cb();
    });
    btn.on("pointerover", () => {
      btn.alpha = 0.7;
    });
    btn.on("pointerout", () => {
      btn.alpha = 1;
    });
    return btn;
  }
}
