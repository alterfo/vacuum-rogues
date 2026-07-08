import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import { scaledText } from "./ui/scaledText";
import { lineStepFor } from "./ui/questCardLayout";
import { RESOURCE_LABEL, explainInstallBlock } from "./ui/HangarPanel";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById, type Gear } from "@/systems/equipment/GearCatalog";
import {
  KIND_LABEL,
  ownedUninstalledGear,
  installOwnedGear,
  uninstallToOwned,
  jettisonOwnedGear,
} from "@/systems/equipment/GearBridge";
import { logger } from "@/utils/logger";
import { SceneType, type ResourceType } from "@/types";
import { t } from "@/i18n/i18n";
import { scaledFont } from "@/utils/fontScale";

/** A jettison action awaiting its second confirmation click. */
interface PendingJettison {
  readonly kind: "gear" | "resource";
  readonly id: string;
}

/**
 * Inventory Scene — the ship's canonical GearCatalog loadout (hull + installed
 * gear + derived stats), the owned-but-uninstalled warehouse, and cargo.
 *
 * The `ShipLoadout` is the canonical fitting: shop purchases, combat loot and
 * micromodule crafting all install into `gameEngine.playerLoadout` (dual-hull
 * unification, 2026-06-16). The legacy `inventory.modules` bag only survives as
 * a residual store for unfitted gear and is deliberately NOT rendered here —
 * only the canonical `ownedGearIds` warehouse (Bug 2) is. Accessible via "I"
 * key from SpaceFlightScene or StarMapScene.
 *
 * Actions (install / uninstall-to-hold / jettison) route through the shared
 * `GearBridge`/`Inventory` mutation seams — never fork fit logic here. A
 * jettison is a two-step confirm (mirrors `SaveLoadScene`'s destructive-action
 * pattern) and grants no credits; selling stays in the equipment shop/hangar.
 */
export class InventoryScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private mainContainer: Container | null = null;

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  /** Teardown for the contextual-help layer (first-time hint + «?» button). */
  private helpTeardown: (() => void) | null = null;
  /** Jettison action armed and awaiting its second confirmation click. */
  private pendingJettison: PendingJettison | null = null;
  /** Auto-dismiss handle for the blocked-install toast; mounted on `renderer.stage`
   * (not `mainContainer`) so it survives the `refresh()` teardown/rebuild cycle. */
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  /**
   * Wire contextual help (first-time auto-hint + always-available «?» reopen).
   * Mounted on `renderer.stage` so it sits above the panel and survives the
   * scene's `render()` UI rebuilds.
   */
  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "INVENTORY",
    );
  }

  initialize(context?: { gameEngine: GameEngine }): void {
    if (!context?.gameEngine) {
      throw new Error("InventoryScene requires gameEngine in context");
    }

    this.gameEngine = context.gameEngine;
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.render();

    // Add keyboard listener for closing inventory
    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);

    this.mountHelp();

    logger.info("InventoryScene initialized");
  }

  update(_deltaTime: number): void {
    // Inventory is static, no updates needed
  }

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    // Remove keyboard listener
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }

    // Destroy containers
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }

    this.gameEngine = null;

    logger.info("InventoryScene destroyed");
  }

  /**
   * Render the entire inventory UI
   */
  private render(): void {
    if (!this.mainContainer || !this.gameEngine) return;

    const screenWidth = this.renderer.app.screen.width;
    const screenHeight = this.renderer.app.screen.height;

    // Semi-transparent backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, screenWidth, screenHeight);
    backdrop.fill({ color: 0x000000, alpha: 0.8 });
    backdrop.eventMode = "static"; // Block clicks behind
    this.mainContainer.addChild(backdrop);

    // Main panel — grown from 600 to fit the warehouse/cargo action rows (Bug 2).
    const panelWidth = 900;
    const panelHeight = 700;
    const panelX = (screenWidth - panelWidth) / 2;
    const panelY = (screenHeight - panelHeight) / 2;

    const panel = new Graphics();
    panel.rect(panelX, panelY, panelWidth, panelHeight);
    panel.fill({ color: 0x1a1a2e, alpha: 0.98 });
    panel.stroke({ color: 0x00ffff, width: 3 });
    this.mainContainer.addChild(panel);

    // Title
    const title = new Text({
      text: "ИНВЕНТАРЬ И ОБОРУДОВАНИЕ",
      style: {
        fontFamily: "Courier New",
        fontSize: 20,
        fill: 0x00ffff,
        fontWeight: "bold",
      },
    });
    title.x = panelX + 20;
    title.y = panelY + 15;
    this.mainContainer.addChild(title);

    // Close button
    this.createCloseButton(panelX + panelWidth - 40, panelY + 15);

    // Ship stats panel (left side)
    this.renderShipStats(panelX + 20, panelY + 60);

    // Installed gear from the canonical loadout, with a [В трюм] uninstall
    // action per fitted item (right side)
    this.renderLoadoutGear(panelX + 330, panelY + 60);

    // Warehouse: owned-but-uninstalled gear, [Установить]/[Выбросить] (left,
    // below ship stats)
    this.renderWarehouse(panelX + 20, panelY + 300);

    // Resources display with per-stack [Выбросить] (bottom, full width)
    this.renderResources(panelX + 20, panelY + panelHeight - 140);
  }

  /**
   * Render ship statistics. Hull capacity, shields, speed and slot usage come
   * from the canonical loadout's derived stats; live values (current HP,
   * shields, energy, evasion) come from the ship state. GameEngine initializes
   * a loadout on both new game and load, so it is always present here.
   */
  private renderShipStats(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player)
      return;
    const stats = this.gameEngine.playerLoadout?.derivedStats();
    if (!stats) return;

    const ship = this.gameEngine.player.ship;

    const statsTitle = new Text({
      text: "КОРАБЛЬ",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xffaa00,
        fontWeight: "bold",
      },
    });
    statsTitle.x = x;
    statsTitle.y = y;
    this.mainContainer.addChild(statsTitle);

    const lines = [
      `Название: ${ship.name}`,
      ``,
      // Live HP/shields can't exceed the loadout-derived capacities (the
      // legacy ship fields may carry stale values from before the gear was
      // canonical).
      `Корпус: ${Math.min(ship.hullHP, stats.maxHull)}/${stats.maxHull}`,
      `Щиты: ${Math.min(ship.shields, stats.shields)}/${stats.shields}`,
      `Энергия: ${ship.energy}/${ship.maxEnergy}`,
      // px/ms, same unit and format as the NPC contact panel
      `Скорость: ${stats.speed.toFixed(2)}`,
      `Уворот: ${ship.evasion}`,
      `Слоты: ${stats.slotsUsed}/${stats.slotsTotal}`,
      `Трюм: ${stats.cargo}`,
    ];

    let yOffset = y + 30;
    for (const line of lines) {
      const statText = new Text({
        text: line,
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: 0xaaaaaa,
        },
      });
      statText.x = x;
      statText.y = yOffset;
      this.mainContainer.addChild(statText);
      yOffset += 18;
    }
  }

  /**
   * Render the hull and installed gear from the canonical GearCatalog loadout
   * (read-only — gear is managed in the equipment shop).
   */
  private renderLoadoutGear(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer) return;

    const sectionTitle = new Text({
      text: "УСТАНОВЛЕННОЕ ОБОРУДОВАНИЕ",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xffaa00,
        fontWeight: "bold",
      },
    });
    sectionTitle.x = x;
    sectionTitle.y = y;
    this.mainContainer.addChild(sectionTitle);

    const loadout = this.gameEngine.playerLoadout;
    if (!loadout) return; // unreachable: GameEngine always initializes a loadout

    // Hull card first (not uninstallable — slotIndex null), then each
    // installed gear item at its loadout slot index (installedGearIds() and
    // installedSlots() share the same order, so the index doubles as the
    // uninstallToOwned slot argument).
    const items: { gear: Gear; slotIndex: number | null }[] = [
      { gear: loadout.hull, slotIndex: null },
    ];
    loadout.installedGearIds().forEach((id, slotIndex) => {
      const gear = gearById(id);
      if (gear) items.push({ gear, slotIndex });
    });

    // At most 5 cards fit between the section title and the resources row at
    // the panel bottom (cards are 60px on a 70px step); large hulls hold up to
    // 9 items, so show an explicit overflow count instead of silent truncation.
    const MAX_CARDS = 5;
    let yOffset = y + 35;
    for (const { gear, slotIndex } of items.slice(0, MAX_CARDS)) {
      this.renderGearCard(x, yOffset, gear, slotIndex);
      yOffset += 70;
    }
    if (items.length > MAX_CARDS) {
      const more = new Text({
        text: `…и ещё ${items.length - MAX_CARDS} — полный список в магазине оборудования`,
        style: {
          fontFamily: "Courier New",
          fontSize: 11,
          fill: 0x8888aa,
        },
      });
      more.x = x;
      more.y = yOffset;
      this.mainContainer.addChild(more);
      yOffset += 18;
    }

    const hint = new Text({
      text: "Покупка и установка — в магазине оборудования",
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        fill: 0x555577,
      },
    });
    hint.x = x;
    hint.y = yOffset + 5;
    this.mainContainer.addChild(hint);
  }

  /**
   * Render a single gear card (name, kind, tech level). Non-hull items
   * (`slotIndex` set) get a `[В трюм]` uninstall action back into the owned
   * warehouse (Bug 2); the hull (`slotIndex` null) stays read-only — it isn't
   * something you carry to the hold.
   */
  private renderGearCard(
    x: number,
    y: number,
    gear: Gear,
    slotIndex: number | null,
  ): void {
    if (!this.mainContainer) return;

    const card = new Container();
    card.x = x;
    card.y = y;

    const bg = new Graphics();
    bg.rect(0, 0, 540, 60);
    bg.fill({ color: 0x16213e, alpha: 0.8 });
    bg.stroke({ color: 0x555555, width: 1 });
    card.addChild(bg);

    const name = new Text({
      text: gear.name,
      style: {
        fontFamily: "Courier New",
        fontSize: 12,
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    name.eventMode = "none";
    name.x = 10;
    name.y = 10;
    card.addChild(name);

    const meta = new Text({
      text: `[${KIND_LABEL[gear.kind]}]  Тех. уровень: ${gear.techLevel}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        fill: 0xb4b4b4,
      },
    });
    meta.eventMode = "none";
    meta.x = 10;
    meta.y = 32;
    card.addChild(meta);

    if (slotIndex !== null) {
      const uninstallBtn = scaledText(t("inventory.uninstall"), 11, 0xff8844, {
        rawColor: true,
      });
      uninstallBtn.anchor.set(1, 0.5);
      uninstallBtn.x = 530;
      uninstallBtn.y = 30;
      uninstallBtn.eventMode = "static";
      uninstallBtn.cursor = "pointer";
      uninstallBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        this.uninstallGear(slotIndex);
      });
      card.addChild(uninstallBtn);
    }

    this.mainContainer.addChild(card);
  }

  /**
   * Render the owned-but-uninstalled gear warehouse (canonical
   * `Inventory.ownedGearIds`, read through `ownedUninstalledGear` — the same
   * accessor the station hangar/equipment-shop ТРЮМ views use). Each row gets
   * `[Установить]` (install into the loadout) and `[Выбросить]` (jettison,
   * two-step confirm, no refund — that's what selling in the shop is for).
   */
  private renderWarehouse(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player)
      return;
    const player = this.gameEngine.player;
    const loadout = this.gameEngine.playerLoadout;

    const title = scaledText(t("inventory.warehouseTitle"), 14, 0x88aa44, {
      rawColor: true,
      fontWeight: "bold",
    });
    title.x = x;
    title.y = y;
    this.mainContainer.addChild(title);

    const ownedIds = ownedUninstalledGear(player, loadout);
    let yOffset = y + 25;

    if (ownedIds.length === 0) {
      const empty = scaledText(t("inventory.warehouseEmpty"), 11, 0xb4bcc4, {
        rawColor: true,
      });
      empty.x = x;
      empty.y = yOffset;
      this.mainContainer.addChild(empty);
      return;
    }

    // At most 3 rows fit the ~230px column budget above the resources row.
    const MAX_ROWS = 3;
    for (const gearId of ownedIds.slice(0, MAX_ROWS)) {
      yOffset = this.renderWarehouseRow(x, yOffset, gearId, loadout);
    }
    if (ownedIds.length > MAX_ROWS) {
      const more = scaledText(
        t("inventory.overflowMore", { n: ownedIds.length - MAX_ROWS }),
        11,
        0x8888aa,
        { rawColor: true },
      );
      more.x = x;
      more.y = yOffset;
      this.mainContainer.addChild(more);
    }
  }

  /** One warehouse row: name + [Установить]/[Выбросить] (or the confirm pair). Returns the next row's y. */
  private renderWarehouseRow(
    x: number,
    y: number,
    gearId: string,
    loadout: ShipLoadout | null,
  ): number {
    if (!this.mainContainer) return y;
    const gear = gearById(gearId);
    const rowW = 280;
    // Vertical gap between the two stacked «Установить»/«Выбросить» (or
    // «Отмена»/подтверждение) actions — sized for the "M" line height (16 px
    // cleared the ~14 px text) but that margin shrinks to zero at "L"; grow it
    // with the font scale so the two buttons never overlap (Task 3, mirrors
    // HangarPanel.renderWarehouseAndCargo's `btnGap`).
    const btnGap = Math.max(16, lineStepFor(scaledFont(11)) + 4);
    const rowH = 12 + btnGap + 8;

    const bg = new Graphics();
    bg.rect(x, y, rowW, rowH);
    bg.fill({ color: 0x14160a, alpha: 1 });
    bg.stroke({ color: 0x30401a, width: 1 });
    this.mainContainer.addChild(bg);

    const label = scaledText(gear ? gear.name : gearId, 11, 0xccddaa, {
      rawColor: true,
    });
    label.eventMode = "none";
    label.x = x + 8;
    label.y = y + 4;
    this.mainContainer.addChild(label);

    const btnRight = x + rowW - 8;
    const confirming =
      this.pendingJettison?.kind === "gear" &&
      this.pendingJettison.id === gearId;

    if (confirming) {
      this.addRowButton(t("common.cancel"), 0x99aabb, btnRight, y + 12, () =>
        this.cancelJettisonConfirm(),
      );
      this.addRowButton(
        t("inventory.jettisonConfirm"),
        0xff7755,
        btnRight,
        y + 12 + btnGap,
        () => this.confirmJettison(),
      );
      return y + rowH + 8;
    }

    if (gear && loadout) {
      this.addRowButton(
        t("inventory.install"),
        0x44ddaa,
        btnRight,
        y + 12,
        () => this.installFromWarehouse(gearId),
      );
    }
    this.addRowButton(
      t("inventory.jettison"),
      0xff8844,
      btnRight,
      y + 12 + btnGap,
      () => this.requestJettisonConfirm("gear", gearId),
    );

    return y + rowH + 8;
  }

  /** One right-anchored text action button, appended directly to `mainContainer`. */
  private addRowButton(
    label: string,
    color: number,
    rightX: number,
    y: number,
    onClick: () => void,
  ): void {
    if (!this.mainContainer) return;
    const btn = scaledText(label, 11, color, { rawColor: true });
    btn.anchor.set(1, 0.5);
    btn.x = rightX;
    btn.y = y;
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      onClick();
    });
    this.mainContainer.addChild(btn);
  }

  /**
   * Render cargo (credits + per-stack resources), each stack with a
   * `[Выбросить]` jettison action (two-step confirm, no refund).
   */
  private renderResources(x: number, y: number): void {
    if (!this.gameEngine || !this.mainContainer || !this.gameEngine.player)
      return;

    const resourcesTitle = new Text({
      text: "РЕСУРСЫ",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: "bold",
      },
    });
    resourcesTitle.x = x;
    resourcesTitle.y = y;
    this.mainContainer.addChild(resourcesTitle);

    const resources = this.gameEngine.player.inventory.resources.filter(
      (r) => r.amount > 0,
    );
    const credits = this.gameEngine.player.credits;

    const creditsText = new Text({
      text: `Кредиты: ${credits}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    creditsText.x = x;
    creditsText.y = y + 25;
    this.mainContainer.addChild(creditsText);

    const MAX_ROWS = 3;
    let yOffset = y + 45;
    for (const r of resources.slice(0, MAX_ROWS)) {
      yOffset = this.renderResourceRow(x, yOffset, r.type, r.amount);
    }
    if (resources.length > MAX_ROWS) {
      const more = scaledText(
        t("inventory.overflowMore", { n: resources.length - MAX_ROWS }),
        11,
        0x8888aa,
        { rawColor: true },
      );
      more.x = x;
      more.y = yOffset;
      this.mainContainer.addChild(more);
    }
  }

  /** One cargo resource row: label ×amount + [Выбросить] (or the confirm pair). Returns the next row's y. */
  private renderResourceRow(
    x: number,
    y: number,
    type: ResourceType,
    amount: number,
  ): number {
    if (!this.mainContainer) return y;
    const rowH = 20;
    const label = scaledText(
      `${RESOURCE_LABEL[type] ?? type} ×${amount}`,
      11,
      0xb4c4d4,
      { rawColor: true },
    );
    label.eventMode = "none";
    label.x = x;
    label.y = y;
    this.mainContainer.addChild(label);

    const btnRight = x + 260;
    const confirming =
      this.pendingJettison?.kind === "resource" &&
      this.pendingJettison.id === type;

    if (confirming) {
      this.addRowButton(
        t("common.cancel"),
        0x99aabb,
        btnRight - 70,
        y + 7,
        () => this.cancelJettisonConfirm(),
      );
      this.addRowButton(
        t("inventory.jettisonConfirm"),
        0xff7755,
        btnRight,
        y + 7,
        () => this.confirmJettison(),
      );
    } else {
      this.addRowButton(
        t("inventory.jettison"),
        0xff8844,
        btnRight,
        y + 7,
        () => this.requestJettisonConfirm("resource", type),
      );
    }

    return y + rowH;
  }

  /**
   * Create close button
   */
  private createCloseButton(x: number, y: number): void {
    if (!this.mainContainer) return;

    const closeBtn = new Container();
    closeBtn.x = x;
    closeBtn.y = y;
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";

    const closeBg = new Graphics();
    closeBg.rect(0, 0, 25, 25);
    closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    closeBtn.addChild(closeBg);

    const closeText = new Text({
      text: "X",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    closeText.x = 7;
    closeText.y = 2;
    closeBtn.addChild(closeText);

    closeBtn.on("pointerdown", () => {
      this.closeInventory();
    });

    closeBtn.on("pointerover", () => {
      closeBg.clear();
      closeBg.rect(0, 0, 25, 25);
      closeBg.fill({ color: 0xff4444, alpha: 1.0 });
    });

    closeBtn.on("pointerout", () => {
      closeBg.clear();
      closeBg.rect(0, 0, 25, 25);
      closeBg.fill({ color: 0xff0000, alpha: 0.8 });
    });

    this.mainContainer.addChild(closeBtn);
  }

  /** Rebuild the panel after a mutating action (install/uninstall/jettison). */
  private refresh(): void {
    if (!this.mainContainer) return;
    this.mainContainer.destroy({ children: true });
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);
    this.render();
  }

  /** Install an owned warehouse item into the loadout (public: unit-testable without pointer events). */
  installFromWarehouse(gearId: string): void {
    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout;
    if (!player || !loadout) return;
    // Same fit check the HangarPanel's install row uses, so a full category or
    // an over-mass fit tells the player why instead of silently doing nothing.
    const blocked = explainInstallBlock(loadout, gearId);
    if (blocked) {
      this.showToast(blocked, 0xff6644);
      return;
    }
    installOwnedGear(player, loadout, gearId);
    this.refresh();
  }

  /** Transient bottom-of-screen message (e.g. a blocked install's reason). */
  private showToast(text: string, color: number): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
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
    toast.anchor.set(0.5);
    toast.x = w / 2;
    toast.y = h - 40;
    toast.eventMode = "none";
    this.renderer.stage.addChild(toast);

    this.toastTimeout = setTimeout(() => {
      toast.destroy();
      this.toastTimeout = null;
    }, 2200);
  }

  /** Uninstall a fitted loadout slot back into the owned warehouse. */
  uninstallGear(slotIndex: number): void {
    const player = this.gameEngine?.player;
    const loadout = this.gameEngine?.playerLoadout;
    if (!player || !loadout) return;
    uninstallToOwned(player, loadout, slotIndex);
    this.refresh();
  }

  /** Arm a two-step jettison confirmation for a gear id or resource type. */
  requestJettisonConfirm(kind: "gear" | "resource", id: string): void {
    this.pendingJettison = { kind, id };
    this.refresh();
  }

  /** Cancel an armed jettison confirmation. */
  cancelJettisonConfirm(): void {
    this.pendingJettison = null;
    this.refresh();
  }

  /** Carry out the armed jettison — no credit refund (selling is the paid path). */
  confirmJettison(): void {
    const pending = this.pendingJettison;
    this.pendingJettison = null;
    const player = this.gameEngine?.player;
    if (!pending || !player) return;
    if (pending.kind === "gear") {
      jettisonOwnedGear(player, pending.id);
    } else {
      const stack = player.inventory.resources.find(
        (r) => r.type === pending.id,
      );
      if (stack) {
        player.inventory.removeResource(
          pending.id as ResourceType,
          stack.amount,
        );
      }
    }
    this.refresh();
  }

  /**
   * Close inventory and return to previous scene
   */
  private async closeInventory(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info("Closing inventory");
    const shipPos = this.gameEngine.lastFlightShipPos ?? undefined;
    await this.gameEngine.transitionTo(
      SceneType.SPACE_FLIGHT,
      shipPos ? { preserveShipPos: shipPos } : undefined,
    );
  }

  /**
   * Handle keyboard input
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "i" || event.key === "I" || event.key === "Escape") {
      this.closeInventory();
    }
  }
}
