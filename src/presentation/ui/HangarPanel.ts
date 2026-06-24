import {
  Container,
  Graphics,
  Rectangle,
  type FederatedPointerEvent,
} from "pixi.js";
import { scaledText } from "./scaledText";
import type { Renderer } from "../Renderer";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type { MicroModule } from "@/types";
import {
  GearKind,
  gearById,
  microModuleById,
  hullMicroModuleById,
  slotCategoryFor,
  type SlotCategory,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import {
  slotToBagModule,
  gearToModule,
  gearMicromoduleCategory,
  ownedUninstalledGear,
  installOwnedGear,
  gearFit,
  evaluateMicromoduleDrop,
  applyMicromoduleDrop,
  micromoduleDropHint,
  type MicromoduleDropTarget,
} from "@/systems/equipment/GearBridge";
import {
  sellGearPrice,
  sellUninstalledGear,
} from "@/systems/equipment/sellGear";
import type { BankAccess } from "@/systems/banking/economy";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import { logger } from "@/utils/logger";

// ── Hangar (SR-canon categorized fitting) ────────────────────────────────────

/** Display label for each fitting bank (canon §11.3). */
export const CATEGORY_LABEL: Record<SlotCategory, string> = {
  weapon: "ОРУЖИЕ",
  engine: "ДВИГАТЕЛЬ",
  radar: "РАДАР",
  equipment: "ОБОРУДОВАНИЕ",
};

/** Order the four banks render in: weapons row, engine, radar, equipment. */
const HANGAR_BANKS: readonly SlotCategory[] = [
  "weapon",
  "engine",
  "radar",
  "equipment",
];

/** Russian goods names for the cargo hold (ТРЮМ) read-out. */
const RESOURCE_LABEL: Record<string, string> = {
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

/** Computed geometry shared across the hangar's column renderers. */
interface HangarLayout {
  readonly leftX: number;
  readonly leftW: number;
  readonly rightX: number;
  readonly rightW: number;
  readonly contentTop: number;
  readonly contentBottom: number;
}

/**
 * Why an install is blocked, or null when it would succeed. Engine/radar are
 * single slots that *replace* the current fitting, so they only fail on mass;
 * the weapon/equipment banks also fail when full.
 *
 * Shared by the hangar warehouse install path and the station's per-listing
 * install-block toast, so the message can never drift from {@link gearFit}.
 */
export function explainInstallBlock(
  loadout: ShipLoadout,
  gearId: string,
): string | null {
  // One source of truth for the fit decision — gearFit (also used by the
  // equipment-shop per-listing hint) — so the toast can never drift from it.
  const fit = gearFit(loadout, gearId);
  switch (fit.status) {
    case "fits":
      return null;
    case "n/a":
      return "Нельзя установить";
    case "no-slot":
      return `Нет слота: ${CATEGORY_LABEL[fit.category]} (${fit.used}/${fit.total})`;
    case "over-mass":
      return `Перегруз: масса ${fit.mass} > свободно ${fit.massFree}`;
  }
}

/**
 * The host scene context the hangar panel draws against. Player/loadout are the
 * canonical fitting model; the callbacks let the panel coordinate scene-owned
 * concerns (toast, navigation, re-render) without forking any logic.
 */
export interface HangarPanelContext {
  /** Container the panel draws into (the host scene's main container). */
  readonly container: Container;
  readonly player: Player;
  readonly loadout: ShipLoadout | null;
  /** Bank seam for selling owned gear (gameEngine.bank). */
  readonly bank?: BankAccess | null;
  readonly equipment: EquipmentSystem;
  /** Flash a status message in the panel's toast slot. */
  showToast(msg: string, color: number): void;
  /** Mount the host scene's toast at the given panel geometry. */
  addToastSlot(px: number, py: number, pw: number, ph: number): void;
  /** Re-render the host scene (refreshes the hangar in place). */
  rerender(): void;
  /** Leave the hangar back to the host scene's previous view. */
  back(): void;
  /** Open the micromodule-apply sub-panel for a fitted slot. */
  openMicromoduleApply(slotIndex: number, gearId: string): void;
}

/**
 * The shared slot-fitting hangar: the four categorized fitting banks (weapons /
 * engine / radar / equipment), the hull micromodule bank, the СКЛАД warehouse +
 * ТРЮМ cargo strip, and the drag-drop micromodule tray. Both `StationScene` and
 * `EquipmentShopScene` mount it so fitting looks and behaves identically.
 *
 * All mutations route through the canonical `ShipLoadout` + the shared gear
 * helpers (`installOwnedGear`, `sellUninstalledGear`, the GearBridge drag-drop
 * seam) — the panel is pure presentation over that model.
 */
export class HangarPanel {
  /**
   * Drop zones registered while the hangar renders (drag-drop fitting): each
   * fitted gear slot and each hull micromodule slot, in screen coords. A dropped
   * micromodule chip hit-tests against these to find its target.
   */
  private dropZones: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    target: MicromoduleDropTarget;
  }> = [];
  /** In-flight micromodule drag — the chip's module + the ghost following the pointer. */
  private dragMicromodule: {
    mm: MicroModule;
    ghost: Container;
    /** Ghost border/fill, re-tinted to signal a valid (green) / invalid (red) hover. */
    bg: Graphics;
    w: number;
    h: number;
  } | null = null;
  private dragMoveHandler: ((e: FederatedPointerEvent) => void) | null = null;
  private dragEndHandler: ((e: FederatedPointerEvent) => void) | null = null;
  /** Screen rects of the draggable tray chips (drag *source*), for E2E. */
  private chipRects: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];
  /** The host context from the most recent render — read by the drag handlers,
   *  which outlive a single render. Refreshed on every render. */
  private ctx: HangarPanelContext | null = null;

  constructor(private readonly renderer: Renderer) {}

  /** Screen-coord drop zones for the current hangar render (read-only, for E2E). */
  getDropZones(): ReadonlyArray<{
    x: number;
    y: number;
    w: number;
    h: number;
    target: MicromoduleDropTarget;
  }> {
    return this.dropZones;
  }

  /** Screen-coord drag-source chip rects for the current hangar render (E2E). */
  getChipRects(): ReadonlyArray<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> {
    return this.chipRects;
  }

  /** Tear down any in-flight drag + clear registered zones (host scene destroy). */
  dispose(): void {
    this.cancelMicromoduleDrag();
    this.dropZones = [];
    this.ctx = null;
  }

  /** Draw the full hangar board into the host container at panel geometry. */
  render(ctx: HangarPanelContext): void {
    this.ctx = ctx;
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const player = ctx.player;

    const PW = Math.min(900, sw - 60);
    const PH = Math.min(620, sh - 60);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.88 });
    bg.eventMode = "static";
    ctx.container.addChild(bg);

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH).fill({ color: 0x0a1420, alpha: 1 });
    panel.rect(PX, PY, PW, PH).stroke({ color: 0x223344, width: 1 });
    panel.eventMode = "none";
    ctx.container.addChild(panel);

    const loadout = ctx.loadout;

    const title = scaledText("АНГАР — ОСНАСТКА КОРАБЛЯ", 14, 0x88ddaa, {
      rawColor: true,
      fontFamily: "monospace",
    });
    title.x = PX + 20;
    title.y = PY + 14;
    title.eventMode = "none";
    ctx.container.addChild(title);

    // Hull is the ship itself (canon §11.3), shown as a centred banner rather
    // than occupying a slot.
    const hullBanner = scaledText(
      loadout ? `Корпус: ${loadout.hull.name}` : "Корпус: —",
      12,
      0xb4c4d4,
      { rawColor: true, fontFamily: "monospace" },
    );
    hullBanner.anchor.set(0.5, 0);
    hullBanner.x = PX + PW / 2;
    hullBanner.y = PY + 14;
    hullBanner.eventMode = "none";
    ctx.container.addChild(hullBanner);

    this.renderHangarStats(loadout, PX, PY, PW);

    // The drag-drop fitting board re-registers its drop zones + chip source
    // rects each render.
    this.dropZones = [];
    this.chipRects = [];

    const CW = PW - 36;
    const gap = 18;
    const leftW = Math.round((CW - gap) * 0.55);
    // Reserve a strip along the bottom for the draggable micromodule tray, above
    // the [Назад] button. The two columns clip to `contentBottom` as before.
    const trayH = 64;
    const trayY = PY + PH - 38 - trayH;
    const layout: HangarLayout = {
      leftX: PX + 18,
      leftW,
      rightX: PX + 18 + leftW + gap,
      rightW: CW - leftW - gap,
      contentTop: PY + 84,
      contentBottom: trayY - 8,
    };

    // Hull micromodule bank sits atop the left column; the fitting banks flow
    // below the y it consumes.
    const banksTop = this.renderHullMicromoduleBank(layout, loadout);
    this.renderFittingBanks(
      { ...layout, contentTop: banksTop },
      loadout,
      player,
    );
    this.renderWarehouseAndCargo(layout, loadout, player);
    this.renderMicromoduleTray(PX + 18, trayY, PW - 36, trayH, player, loadout);

    // Toast slot so drag-drop fit hints (and sell/unequip messages) show here.
    ctx.addToastSlot(PX, PY, PW, PH);

    // Back button
    const backBtn = scaledText("[ ← Назад ]", 14, 0xb4c4d4, {
      rawColor: true,
      fontFamily: "monospace",
    });
    backBtn.anchor.set(0.5, 1);
    backBtn.x = PX + PW / 2;
    backBtn.y = PY + PH - 14;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      ctx.back();
    });
    ctx.container.addChild(backBtn);
  }

  /** МАССА / СВОБОДНО / СКОРОСТЬ / ЗАЩИТА strip under the title. */
  private renderHangarStats(
    loadout: ShipLoadout | null,
    PX: number,
    PY: number,
    PW: number,
  ): void {
    const container = this.ctx!.container;
    const stats = loadout?.derivedStats() ?? null;
    const massUsed = stats?.massUsed ?? 0;
    const massCap = stats?.massCapacity ?? 0;
    const massFree = stats?.massFree ?? 0;
    const speed = stats ? stats.speed.toFixed(2) : "0.00";
    const shields = stats?.shields ?? 0;

    const segs: Array<{ text: string; fill: number }> = [
      { text: `МАССА ${massUsed}/${massCap}`, fill: 0xffcc66 },
      {
        text: `СВОБОДНО ${massFree}`,
        fill: massFree > 0 ? 0x66dd88 : 0xff6644,
      },
      { text: `СКОРОСТЬ ${speed}`, fill: 0x88ccff },
      { text: `ЗАЩИТА ${shields}`, fill: 0x88ffcc },
    ];
    const colW = (PW - 40) / segs.length;
    segs.forEach((s, i) => {
      const t = scaledText(s.text, 12, s.fill, {
        rawColor: true,
        fontFamily: "monospace",
      });
      t.x = PX + 20 + i * colW;
      t.y = PY + 54;
      t.eventMode = "none";
      container.addChild(t);
    });
  }

  /**
   * The four categorized fitting banks (weapons / engine / radar / equipment) in
   * the left column: a header per bank showing `used/total` from the hull, the
   * filled slots (with [снять] + micromodule controls), then the remaining empty
   * slots. Rendering clips to the column; an overflow row marks any spill-over.
   */
  private renderFittingBanks(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
    player: Player,
  ): void {
    const container = this.ctx!.container;
    const { leftX, leftW, contentTop, contentBottom } = layout;
    const stats = loadout?.derivedStats() ?? null;
    const installed = loadout?.installedSlots() ?? [];
    // Flat slot index of each installed item, grouped by category — the index is
    // needed so [снять]/micromodule target the exact clicked copy.
    const byCat = (cat: SlotCategory) =>
      installed
        .map((slot, idx) => ({ slot, idx, gear: gearById(slot.gearId) }))
        .filter((e) => e.gear && slotCategoryFor(e.gear) === cat);

    let y = contentTop;
    let clipped = false;
    for (const cat of HANGAR_BANKS) {
      if (clipped) break;
      const c = stats?.categories[cat] ?? { used: 0, total: 0 };

      const header = scaledText(
        `${CATEGORY_LABEL[cat]}  ${c.used}/${c.total}`,
        12,
        c.used < c.total ? 0x88ccaa : 0xddaa66,
        { rawColor: true, fontFamily: "monospace" },
      );
      header.x = leftX;
      header.y = y;
      header.eventMode = "none";
      container.addChild(header);
      y += 22;

      const entries = byCat(cat);
      for (const e of entries) {
        if (y + 34 > contentBottom) {
          clipped = true;
          break;
        }
        this.renderFilledSlot(layout, loadout!, player, e, y);
        y += 38;
      }
      if (clipped) break;

      const empties = Math.max(0, c.total - entries.length);
      for (let k = 0; k < empties; k++) {
        if (y + 26 > contentBottom) {
          clipped = true;
          break;
        }
        const slotBg = new Graphics();
        slotBg.rect(leftX, y, leftW, 24).fill({ color: 0x0a1218, alpha: 1 });
        slotBg.rect(leftX, y, leftW, 24).stroke({ color: 0x1a2a3a, width: 1 });
        slotBg.eventMode = "none";
        container.addChild(slotBg);
        const txt = scaledText("— свободно —", 11, 0xb4bcc4, {
          rawColor: true,
          fontFamily: "monospace",
        });
        txt.x = leftX + 8;
        txt.y = y + 6;
        txt.eventMode = "none";
        container.addChild(txt);
        y += 28;
      }
      y += 8;
    }
    if (clipped) {
      const more = scaledText("…ещё слоты ниже", 10, 0xb4bcc4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      more.x = leftX;
      more.y = contentBottom + 2;
      more.eventMode = "none";
      container.addChild(more);
    }
  }

  /** One occupied fitting slot: name, [снять], and micromodule control. */
  private renderFilledSlot(
    layout: HangarLayout,
    loadout: ShipLoadout,
    player: Player,
    entry: {
      slot: { gearId: string; micromoduleId?: string; upgrades: number };
      idx: number;
      gear: Gear | undefined;
    },
    y: number,
  ): void {
    const container = this.ctx!.container;
    const { leftX, leftW } = layout;
    const gear = entry.gear!;
    const slot = entry.slot;
    const idx = entry.idx;

    const slotBg = new Graphics();
    slotBg.rect(leftX, y, leftW, 34).fill({ color: 0x0d2030, alpha: 1 });
    slotBg.rect(leftX, y, leftW, 34).stroke({ color: 0x336655, width: 1 });
    slotBg.eventMode = "none";
    container.addChild(slotBg);

    // Drop target: a dragged micromodule released over this fitted item lands on
    // its exact slot index. Only empty slots accept one (one per item); a
    // filled-slot drop is rejected with a hint by applyMicromoduleDrop.
    this.dropZones.push({
      x: leftX,
      y,
      w: leftW,
      h: 34,
      target: { kind: "gear", slotIndex: idx },
    });

    const name = scaledText(`${gear.name} (T${gear.techLevel})`, 11, 0xb8e6c8, {
      rawColor: true,
      fontFamily: "monospace",
    });
    name.x = leftX + 8;
    name.y = y + 4;
    name.eventMode = "none";
    container.addChild(name);

    const unBtn = scaledText("[снять]", 11, 0xff8844, {
      rawColor: true,
      fontFamily: "monospace",
    });
    unBtn.anchor.set(1, 0.5);
    unBtn.x = leftX + leftW - 8;
    unBtn.y = y + 11;
    unBtn.eventMode = "static";
    unBtn.cursor = "pointer";
    unBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      // Remove the exact clicked slot by index (not first id-match) so the right
      // copy is removed with two identical items fitted. slotToBagModule carries
      // the applied micromodule AND artifact-upgrade count onto the bagged item
      // so re-installing restores both.
      if (loadout.removeAt(idx)) {
        player.inventory.addItem(slotToBagModule(gear, slot));
      }
      this.ctx!.rerender();
    });
    container.addChild(unBtn);

    // Micromodule control — one per item, never removed.
    const mmCategory = gearMicromoduleCategory(gear);
    if (slot.micromoduleId) {
      const mmLabel =
        microModuleById(slot.micromoduleId)?.name ?? slot.micromoduleId;
      const mmTag = scaledText(`мм: ${mmLabel}`, 10, 0xffcc44, {
        rawColor: true,
        fontFamily: "monospace",
      });
      mmTag.x = leftX + 8;
      mmTag.y = y + 20;
      mmTag.eventMode = "none";
      container.addChild(mmTag);
    } else {
      const hasMatchingMm =
        mmCategory !== null &&
        player.inventory.micromodules.some(
          (mm) => mm.targetCategory === mmCategory,
        );
      // Explicit label: spell out the action when a compatible micromodule is on
      // hand, and *why* it's disabled otherwise — the old "[+ микромодуль]" never
      // said it slots an upgrade chip nor that you needed to own a matching one.
      const mmBtn = scaledText(
        hasMatchingMm ? "[установить микромодуль]" : "[нет микромодулей]",
        10,
        hasMatchingMm ? 0xffaa22 : 0xb4bcc4,
        { rawColor: true, fontFamily: "monospace" },
      );
      mmBtn.anchor.set(1, 0.5);
      mmBtn.x = leftX + leftW - 8;
      mmBtn.y = y + 26;
      if (hasMatchingMm) {
        mmBtn.eventMode = "static";
        mmBtn.cursor = "pointer";
        mmBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.ctx!.openMicromoduleApply(idx, gear.id);
        });
        mmBtn.on("pointerover", () => {
          mmBtn.alpha = 0.7;
        });
        mmBtn.on("pointerout", () => {
          mmBtn.alpha = 1;
        });
      } else {
        mmBtn.eventMode = "none";
      }
      container.addChild(mmBtn);
    }
  }

  // ── micromodule drag-drop fitting ───────────────────────────────────────────

  /**
   * The hull's own micromodule bank, rendered atop the left column as the drop
   * target for hull micromodules (defense/cargo/energy-redirect). Shows each of
   * the hull's 1–4 slots — fitted module name or "— свободно —" — and registers
   * the whole bank as a single `{kind:"hull"}` drop zone. Returns the y below it
   * so the fitting banks flow underneath. A null loadout renders nothing.
   */
  private renderHullMicromoduleBank(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
  ): number {
    const container = this.ctx!.container;
    const { leftX, leftW, contentTop } = layout;
    if (!loadout) return contentTop;
    const slots = loadout.hullMicromoduleSlots();
    const fitted = loadout.hullMicromodules();

    const header = scaledText(
      `КОРПУС — МИКРОМОДУЛИ  ${fitted.length}/${slots}`,
      12,
      fitted.length < slots ? 0x88ccaa : 0xddaa66,
      { rawColor: true, fontFamily: "monospace" },
    );
    header.x = leftX;
    header.y = contentTop;
    header.eventMode = "none";
    container.addChild(header);

    const rowY = contentTop + 20;
    const chipH = 22;
    const gap = 6;
    const chipW = Math.floor((leftW - gap * (slots - 1)) / Math.max(1, slots));
    for (let i = 0; i < slots; i++) {
      const x = leftX + i * (chipW + gap);
      const id = fitted[i];
      const filled = !!id;
      const chip = new Graphics();
      chip
        .rect(x, rowY, chipW, chipH)
        .fill({ color: filled ? 0x1a2630 : 0x0a1218, alpha: 1 });
      chip
        .rect(x, rowY, chipW, chipH)
        .stroke({ color: filled ? 0xffaa22 : 0x33557a, width: 1 });
      chip.eventMode = "none";
      container.addChild(chip);

      const label = scaledText(
        filled
          ? (hullMicroModuleById(id)?.name ?? microModuleById(id)?.name ?? id)
          : "— свободно —",
        9,
        filled ? 0xffcc44 : 0x8aa0b4,
        { rawColor: true, fontFamily: "monospace" },
      );
      label.anchor.set(0.5, 0.5);
      label.x = x + chipW / 2;
      label.y = rowY + chipH / 2;
      label.eventMode = "none";
      container.addChild(label);
    }

    // One drop zone spanning the bank: applyMicromoduleDrop routes a HULL module
    // into the next free slot (or rejects with "hull-full" when all are taken).
    this.dropZones.push({
      x: leftX,
      y: rowY,
      w: leftW,
      h: chipH,
      target: { kind: "hull" },
    });

    return rowY + chipH + 12;
  }

  /**
   * The draggable owned-micromodule tray along the bottom of the hangar. Each
   * owned micromodule is a chip the player drags onto a fitted item or the hull
   * bank. Empty → a hint to buy them at a Центр крафта.
   */
  private renderMicromoduleTray(
    px: number,
    py: number,
    pw: number,
    ph: number,
    player: Player,
    loadout: ShipLoadout | null,
  ): void {
    const container = this.ctx!.container;
    const tray = new Graphics();
    tray.rect(px, py, pw, ph).fill({ color: 0x070d14, alpha: 1 });
    tray.rect(px, py, pw, ph).stroke({ color: 0x223344, width: 1 });
    tray.eventMode = "none";
    container.addChild(tray);

    const owned = player.inventory.micromodules;
    const label = scaledText(
      owned.length > 0
        ? "МИКРОМОДУЛИ — перетащите на модуль или корпус:"
        : "МИКРОМОДУЛИ — нет в наличии (купите в Центре крафта)",
      11,
      owned.length > 0 ? 0xffaa22 : 0x8aa0b4,
      { rawColor: true, fontFamily: "monospace" },
    );
    label.x = px + 8;
    label.y = py + 6;
    label.eventMode = "none";
    container.addChild(label);

    if (owned.length === 0 || !loadout) return;

    const chipY = py + 28;
    const chipH = 26;
    const gap = 8;
    let x = px + 8;
    for (let i = 0; i < owned.length; i++) {
      const mm = owned[i];
      const text = `${mm.name}`;
      const w = Math.min(220, 14 + text.length * 6.2);
      if (x + w > px + pw - 8) {
        // No more horizontal room — flag the overflow rather than clip silently.
        const more = scaledText(`…+${owned.length - i}`, 11, 0x8aa0b4, {
          rawColor: true,
          fontFamily: "monospace",
        });
        more.x = x;
        more.y = chipY + 6;
        more.eventMode = "none";
        container.addChild(more);
        break;
      }
      this.renderMicromoduleChip(mm, x, chipY, w, chipH);
      x += w + gap;
    }
  }

  /** One draggable micromodule chip in the tray. */
  private renderMicromoduleChip(
    mm: MicroModule,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const container = this.ctx!.container;
    const chip = new Container();
    chip.x = x;
    chip.y = y;
    const bg = new Graphics();
    bg.rect(0, 0, w, h).fill({ color: 0x14202c, alpha: 1 });
    bg.rect(0, 0, w, h).stroke({ color: 0xffaa22, width: 1 });
    chip.addChild(bg);
    const t = scaledText(mm.name, 10, 0xffcc44, {
      rawColor: true,
      fontFamily: "monospace",
    });
    t.anchor.set(0.5, 0.5);
    t.x = w / 2;
    t.y = h / 2;
    t.eventMode = "none";
    chip.addChild(t);

    chip.eventMode = "static";
    chip.cursor = "grab";
    // hitArea so the all-`none` children don't prune the event boundary.
    chip.hitArea = new Rectangle(0, 0, w, h);
    chip.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.beginMicromoduleDrag(mm, e);
    });
    container.addChild(chip);
    this.chipRects.push({ id: mm.id, x, y, w, h });
  }

  /** Begin dragging a micromodule chip: a ghost follows the pointer until release. */
  private beginMicromoduleDrag(
    mm: MicroModule,
    e: FederatedPointerEvent,
  ): void {
    if (this.dragMicromodule) return;

    const ghost = new Container();
    const gw = Math.min(220, 14 + mm.name.length * 6.2);
    const gh = 24;
    const gbg = new Graphics();
    gbg.rect(0, 0, gw, gh).fill({ color: 0x1a2a3a, alpha: 0.95 });
    gbg.rect(0, 0, gw, gh).stroke({ color: 0xffcc44, width: 1 });
    ghost.addChild(gbg);
    const gt = scaledText(mm.name, 10, 0xffdd66, {
      rawColor: true,
      fontFamily: "monospace",
    });
    gt.anchor.set(0.5, 0.5);
    gt.x = gw / 2;
    gt.y = gh / 2;
    ghost.addChild(gt);
    ghost.eventMode = "none";
    ghost.x = e.global.x - gw / 2;
    ghost.y = e.global.y - gh / 2;
    // The ghost lives on the uiLayer, above the host container, so it floats
    // over the board while dragging.
    this.renderer.uiLayer.addChild(ghost);

    this.dragMicromodule = { mm, ghost, bg: gbg, w: gw, h: gh };

    this.dragMoveHandler = (ev: FederatedPointerEvent) =>
      this.updateMicromoduleDrag(ev);
    this.dragEndHandler = (ev: FederatedPointerEvent) =>
      this.endMicromoduleDrag(ev);
    const stage = this.renderer.app.stage;
    stage.eventMode = "static";
    stage.on("globalpointermove", this.dragMoveHandler);
    stage.on("pointerup", this.dragEndHandler);
    stage.on("pointerupoutside", this.dragEndHandler);
  }

  /** Move the drag ghost; tint it by whether the hovered zone would accept the drop. */
  private updateMicromoduleDrag(e: FederatedPointerEvent): void {
    const drag = this.dragMicromodule;
    if (!drag) return;
    drag.ghost.x = e.global.x - drag.w / 2;
    drag.ghost.y = e.global.y - drag.h / 2;

    const loadout = this.ctx?.loadout ?? null;
    const zone = this.dropZoneAt(e.global.x, e.global.y);
    let tint = 0xffffff; // neutral (no multiply)
    if (zone && loadout) {
      tint =
        evaluateMicromoduleDrop(loadout, zone.target, drag.mm.id) === "ok"
          ? 0x44ff88
          : 0xff6644;
    }
    drag.bg.tint = tint;
  }

  /** Release the drag: apply onto the hovered zone (or no-op) and refresh. */
  private endMicromoduleDrag(e: FederatedPointerEvent): void {
    const drag = this.dragMicromodule;
    if (!drag) return;
    const dropX = e.global.x;
    const dropY = e.global.y;
    this.cancelMicromoduleDrag();

    const ctx = this.ctx;
    const player = ctx?.player;
    const loadout = ctx?.loadout ?? null;
    const zone = this.dropZoneAt(dropX, dropY);
    if (!ctx || !player || !loadout || !zone) {
      // Released over empty space — silently cancelled.
      ctx?.rerender();
      return;
    }

    const outcome = applyMicromoduleDrop(loadout, zone.target, drag.mm.id);
    if (outcome === "ok") {
      const idx = player.inventory.micromodules.indexOf(drag.mm);
      if (idx >= 0) player.inventory.micromodules.splice(idx, 1);
      logger.info(
        `Drag-applied micromodule ${drag.mm.id} → ${zone.target.kind}`,
      );
    }
    ctx.rerender();
    ctx.showToast(
      micromoduleDropHint(outcome),
      outcome === "ok" ? 0x44ff88 : 0xff8844,
    );
  }

  /** Tear down an in-flight drag: remove the ghost and detach stage listeners. */
  private cancelMicromoduleDrag(): void {
    if (this.dragMicromodule) {
      this.renderer.uiLayer.removeChild(this.dragMicromodule.ghost);
      this.dragMicromodule.ghost.destroy({ children: true });
      this.dragMicromodule = null;
    }
    const stage = this.renderer.app.stage;
    if (this.dragMoveHandler) {
      stage.off("globalpointermove", this.dragMoveHandler);
      this.dragMoveHandler = null;
    }
    if (this.dragEndHandler) {
      stage.off("pointerup", this.dragEndHandler);
      stage.off("pointerupoutside", this.dragEndHandler);
      this.dragEndHandler = null;
    }
  }

  /** The registered drop zone containing the screen point, if any. */
  private dropZoneAt(
    gx: number,
    gy: number,
  ): { target: MicromoduleDropTarget } | null {
    for (const z of this.dropZones) {
      if (gx >= z.x && gx <= z.x + z.w && gy >= z.y && gy <= z.y + z.h) {
        return z;
      }
    }
    return null;
  }

  /**
   * Right column: the СКЛАД warehouse (owned-but-uninstalled gear + the legacy
   * bag, each installable into its matching category or sellable) above the ТРЮМ
   * cargo hold (goods, read-only). Installing routes through the loadout's
   * category+mass rules; a blocked install shows a toast explaining why.
   */
  private renderWarehouseAndCargo(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
    player: Player,
  ): void {
    const container = this.ctx!.container;
    const { rightX, rightW, contentTop, contentBottom } = layout;
    // СКЛАД occupies the top ~60 % of the column; ТРЮМ the rest.
    const splitY = Math.round(contentTop + (contentBottom - contentTop) * 0.6);

    const sklLabel = scaledText("СКЛАД (снаряжение):", 12, 0x88aa44, {
      rawColor: true,
      fontFamily: "monospace",
    });
    sklLabel.x = rightX;
    sklLabel.y = contentTop;
    sklLabel.eventMode = "none";
    container.addChild(sklLabel);

    // Warehouse rows: canonical owned-uninstalled gear first (sellable), then the
    // legacy inventory bag (install-only until the bag is retired). Both install
    // into the matching category bank.
    const ownedIds = ownedUninstalledGear(player, loadout);
    const legacy = player.inventory.modules;
    type Row =
      | { kind: "owned"; gearId: string }
      | { kind: "legacy"; index: number };
    const rows: Row[] = [
      ...ownedIds.map((gearId) => ({ kind: "owned", gearId }) as Row),
      ...legacy.map((_, index) => ({ kind: "legacy", index }) as Row),
    ];

    let y = contentTop + 22;
    if (rows.length === 0) {
      const empty = scaledText("Склад пуст", 12, 0xb4bcc4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      empty.x = rightX;
      empty.y = y;
      empty.eventMode = "none";
      container.addChild(empty);
    }
    for (const row of rows) {
      if (y + 34 > splitY - 6) break; // clip to the СКЛАД region
      const gearId =
        row.kind === "owned" ? row.gearId : (legacy[row.index]?.id ?? "");
      const gear = gearById(gearId);
      const name =
        row.kind === "owned"
          ? (gear?.name ?? gearId)
          : (legacy[row.index]?.name ?? gearId);

      const rowBg = new Graphics();
      rowBg.rect(rightX, y, rightW, 30).fill({ color: 0x14160a, alpha: 1 });
      rowBg.rect(rightX, y, rightW, 30).stroke({ color: 0x30401a, width: 1 });
      rowBg.eventMode = "none";
      container.addChild(rowBg);

      const rowText = scaledText(
        gear ? `${name} (T${gear.techLevel})` : name,
        11,
        0xccddaa,
        { rawColor: true, fontFamily: "monospace" },
      );
      rowText.x = rightX + 8;
      rowText.y = y + 3;
      rowText.eventMode = "none";
      container.addChild(rowText);

      const btnRight = rightX + rightW - 8;

      // Sell — only the canonical owned store is sellable.
      if (row.kind === "owned" && gear) {
        const sellBtn = scaledText(
          `[Продать ${sellGearPrice(gear)}₡]`,
          11,
          0x44ff88,
          { rawColor: true, fontFamily: "monospace" },
        );
        sellBtn.anchor.set(1, 0.5);
        sellBtn.x = btnRight;
        sellBtn.y = y + 21;
        sellBtn.eventMode = "static";
        sellBtn.cursor = "pointer";
        sellBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          const refund = sellUninstalledGear(player, gearId, this.ctx!.bank);
          if (refund > 0) {
            this.ctx!.showToast(
              `Продано: ${gear.name} (+${refund} ₡)`,
              0x44ff88,
            );
          }
          this.ctx!.rerender();
        });
        container.addChild(sellBtn);
      }

      // Install into the matching category — catalog non-hull gear only.
      const installable = !!gear && gear.kind !== GearKind.HULL && !!loadout;
      if (installable && loadout) {
        const eqBtn = scaledText("[Установить]", 11, 0x44ddaa, {
          rawColor: true,
          fontFamily: "monospace",
        });
        eqBtn.anchor.set(1, 0.5);
        eqBtn.x = btnRight;
        eqBtn.y = y + 8;
        eqBtn.eventMode = "static";
        eqBtn.cursor = "pointer";
        eqBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.installFromWarehouse(loadout, player, row);
        });
        eqBtn.on("pointerover", () => {
          eqBtn.alpha = 0.7;
        });
        eqBtn.on("pointerout", () => {
          eqBtn.alpha = 1;
        });
        container.addChild(eqBtn);
      }
      y += 38;
    }

    // ── ТРЮМ — cargo hold (goods), separate read-only panel. ──
    const stats = loadout?.derivedStats() ?? null;
    const resources = player.inventory.resources.filter((r) => r.amount > 0);
    const usedCargo = resources.reduce((n, r) => n + r.amount, 0);
    const holdLabel = scaledText(
      `ТРЮМ ${usedCargo}/${stats?.cargo ?? 0}:`,
      12,
      0x88ccff,
      { rawColor: true, fontFamily: "monospace" },
    );
    holdLabel.x = rightX;
    holdLabel.y = splitY;
    holdLabel.eventMode = "none";
    container.addChild(holdLabel);

    let cy = splitY + 22;
    if (resources.length === 0) {
      const empty = scaledText("Трюм пуст", 12, 0xb4bcc4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      empty.x = rightX;
      empty.y = cy;
      empty.eventMode = "none";
      container.addChild(empty);
    } else {
      for (const r of resources) {
        if (cy + 18 > contentBottom) break;
        const label = RESOURCE_LABEL[r.type] ?? r.type;
        const line = scaledText(`${label} ×${r.amount}`, 11, 0xb4c4d4, {
          rawColor: true,
          fontFamily: "monospace",
        });
        line.x = rightX + 6;
        line.y = cy;
        line.eventMode = "none";
        container.addChild(line);
        cy += 18;
      }
    }
  }

  /**
   * Install a warehouse row into the loadout, routing it to its category bank.
   * Blocks with an explanatory toast when the category is full or the install
   * would exceed the hull's mass budget (even with a free slot elsewhere).
   */
  private installFromWarehouse(
    loadout: ShipLoadout,
    player: Player,
    row: { kind: "owned"; gearId: string } | { kind: "legacy"; index: number },
  ): void {
    const mod =
      row.kind === "legacy" ? player.inventory.modules[row.index] : null;
    const gearId = row.kind === "owned" ? row.gearId : (mod?.id ?? "");
    const blocked = explainInstallBlock(loadout, gearId);
    if (blocked) {
      this.ctx!.showToast(blocked, 0xff6644);
      return;
    }
    if (row.kind === "owned") {
      installOwnedGear(player, loadout, gearId);
    } else if (mod) {
      // An engine/radar install replaces the fitted single-slot part; capture it
      // first so the displaced item is re-bagged, not destroyed (the owned/buy/
      // loot paths all re-home it — this legacy path must too).
      const displaced = loadout.displacedBy(mod.id);
      if (this.ctx!.equipment.installGear(loadout, mod.id)) {
        // Restore the micromodule + artifact-upgrade count carried on a
        // previously-removed item onto the freshly-filled slot (install appends).
        const lastSlot = loadout.installedGearIds().length - 1;
        if (mod.micromoduleId) {
          loadout.applyMicromoduleAt(lastSlot, mod.micromoduleId);
        }
        if (mod.upgrades) {
          loadout.setSlotUpgrades(lastSlot, mod.upgrades);
        }
        player.inventory.modules.splice(row.index, 1);
        if (displaced) {
          const dg = gearById(displaced);
          if (dg) player.inventory.addItem(gearToModule(dg));
        }
      }
    }
    this.ctx!.rerender();
  }
}
