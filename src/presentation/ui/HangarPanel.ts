import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  type FederatedPointerEvent,
} from "pixi.js";
import { scaledText } from "./scaledText";
import { lineStepFor } from "./questCardLayout";
import { attachWheelScroll } from "./WheelScroll";
import { scaledFont } from "@/utils/fontScale";
import { pickVariant } from "../textures";
import { resolveHullArtKey } from "../flight/hullArtAlias";
import { gearIconKey, mountGearIcon } from "./gearIcon";
import type { Renderer } from "../Renderer";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import type {
  MicroModule,
  LoadoutPreset,
  LoadoutPresetName,
  ModuleCategory,
} from "@/types";
import type { SfxKey } from "@/systems/AudioManager";
import {
  GearKind,
  EquipmentClass,
  gearById,
  microModuleById,
  hullMicroModuleById,
  slotCategoryFor,
  type SlotCategory,
  type Gear,
  type EquipmentSpec,
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
  jettisonOwnedGear,
  applyLoadoutHullToShip,
  captureLoadoutPreset,
  upsertLoadoutPreset,
  removeLoadoutPreset,
  applyLoadoutPreset,
  type MicromoduleDropTarget,
} from "@/systems/equipment/GearBridge";
import {
  sellGearPrice,
  sellUninstalledGear,
} from "@/systems/equipment/sellGear";
import { hullStatus, repairCost } from "@/systems/equipment/hullStatus";
import { diagnosticVoiceLine } from "@/systems/equipment/serviceVoice";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";
import type { EquipmentSystem } from "@/systems/EquipmentSystem";
import type { ResourceType } from "@/types";
import { logger } from "@/utils/logger";

export const CATEGORY_LABEL: Record<SlotCategory, string> = {
  weapon: "ОРУЖИЕ",
  engine: "ДВИГАТЕЛЬ",
  radar: "РАДАР",
  equipment: "ОБОРУДОВАНИЕ",
};

export { gearIconKey };

const FITTED_SLOT_MIN_H = 34;

function fittedSlotHeight(): number {
  const nameStep = lineStepFor(scaledFont(11));
  const mmStep = lineStepFor(scaledFont(10));
  return Math.max(FITTED_SLOT_MIN_H, 4 + nameStep + mmStep + 4);
}

export const RESOURCE_LABEL: Record<string, string> = {
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

interface HangarLayout {
  readonly leftX: number;
  readonly leftW: number;
  readonly rightX: number;
  readonly rightW: number;
  readonly contentTop: number;
  readonly contentBottom: number;
}

interface FittedEntry {
  readonly slot: { gearId: string; micromoduleId?: string; upgrades: number };
  readonly idx: number;
  readonly gear: Gear;
}

export function explainInstallBlock(
  loadout: ShipLoadout,
  gearId: string,
): string | null {
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

export function micromoduleSlotControl(
  mmCategory: ModuleCategory | null,
  hasMatchingMm: boolean,
): { label: string; actionable: boolean } {
  if (mmCategory === null)
    return { label: "[микромодуль не ставится]", actionable: false };
  if (!hasMatchingMm) return { label: "[нет микромодулей]", actionable: false };
  return { label: "[установить микромодуль]", actionable: true };
}

export interface HangarPanelContext {
  readonly container: Container;
  readonly player: Player;
  readonly loadout: ShipLoadout | null;
  readonly bank?: BankAccess | null;
  readonly equipment: EquipmentSystem;
  readonly presets: readonly LoadoutPreset[];
  mutatePresets(next: LoadoutPreset[]): void;
  showToast(msg: string, color: number): void;
  playSfx?(key: SfxKey): void;
  addToastSlot(px: number, py: number, pw: number, ph: number): void;
  rerender(): void;
  back(): void;
  openMicromoduleApply(slotIndex: number, gearId: string): void;
  readonly repairRatePerHp?: number;
}

export class HangarPanel {
  private dropZones: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    target: MicromoduleDropTarget;
  }> = [];
  private dragMicromodule: {
    mm: MicroModule;
    ghost: Container;
    bg: Graphics;
    w: number;
    h: number;
  } | null = null;
  private dragMoveHandler: ((e: FederatedPointerEvent) => void) | null = null;
  private dragEndHandler: ((e: FederatedPointerEvent) => void) | null = null;
  private chipRects: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];
  private ctx: HangarPanelContext | null = null;

  private pendingJettison: { kind: "gear" | "resource"; id: string } | null =
    null;

  private leftContent: Container | null = null;
  private rightContent: Container | null = null;
  private leftScroll = { offset: 0, max: 0 };
  private rightScroll = { offset: 0, max: 0 };
  private detachLeftWheel: (() => void) | null = null;
  private detachRightWheel: (() => void) | null = null;

  constructor(private readonly renderer: Renderer) {}

  private sfx(key: SfxKey): void {
    this.ctx?.playSfx?.(key);
  }

  getScrollInfo(): {
    left: { offset: number; max: number };
    right: { offset: number; max: number };
  } {
    return { left: { ...this.leftScroll }, right: { ...this.rightScroll } };
  }

  getDropZones(): ReadonlyArray<{
    x: number;
    y: number;
    w: number;
    h: number;
    target: MicromoduleDropTarget;
  }> {
    return this.dropZones;
  }

  getChipRects(): ReadonlyArray<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> {
    return this.chipRects;
  }

  dispose(): void {
    this.cancelMicromoduleDrag();
    this.detachScrollListeners();
    this.dropZones = [];
    this.pendingJettison = null;
    this.ctx = null;
  }

  private detachScrollListeners(): void {
    this.detachLeftWheel?.();
    this.detachLeftWheel = null;
    this.detachRightWheel?.();
    this.detachRightWheel = null;
  }

  render(ctx: HangarPanelContext): void {
    this.ctx = ctx;
    this.detachScrollListeners();
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

    this.renderPresetTabs(loadout, player, ctx.presets, PX, PY);
    this.renderHangarStats(loadout, PX, PY, PW);

    this.dropZones = [];
    this.chipRects = [];

    const CW = PW - 36;
    const gap = 18;
    const leftW = Math.round((CW - gap) * 0.55);
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

    this.leftContent = new Container();
    this.rightContent = new Container();
    ctx.container.addChild(this.leftContent);
    ctx.container.addChild(this.rightContent);

    const banksTop = this.renderHullMicromoduleBank(layout, loadout);
    const leftBottomY = this.renderFittingRing(
      { ...layout, contentTop: banksTop },
      loadout,
      player,
    );
    const cargoBottomY = this.renderWarehouseAndCargo(layout, loadout, player);
    const rightBottomY = this.renderServiceCenter(
      layout,
      loadout,
      player,
      cargoBottomY,
    );
    this.renderMicromoduleTray(PX + 18, trayY, PW - 36, trayH, player, loadout);

    this.detachLeftWheel = this.wireScrollRegion(
      this.leftContent,
      this.leftScroll,
      layout.leftX,
      layout.contentTop,
      layout.contentBottom,
      layout.leftW,
      leftBottomY - layout.contentTop,
    );
    this.detachRightWheel = this.wireScrollRegion(
      this.rightContent,
      this.rightScroll,
      layout.rightX,
      layout.contentTop,
      layout.contentBottom,
      layout.rightW,
      rightBottomY - layout.contentTop,
    );

    ctx.addToastSlot(PX, PY, PW, PH);

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

  private wireScrollRegion(
    content: Container,
    state: { offset: number; max: number },
    x: number,
    contentTop: number,
    contentBottom: number,
    w: number,
    contentHeight: number,
  ): (() => void) | null {
    const viewportH = Math.max(0, contentBottom - contentTop);
    state.max = Math.max(0, contentHeight - viewportH);
    state.offset = 0;

    const mask = new Graphics();
    mask.rect(x, contentTop, w, viewportH).fill({ color: 0xffffff });
    mask.eventMode = "none";
    this.ctx!.container.addChild(mask);
    content.mask = mask;

    const hitArea = new Rectangle(x, contentTop, w, viewportH);
    content.eventMode = "static";
    content.hitArea = hitArea;

    const apply = (): void => {
      content.y = -state.offset || 0;
      hitArea.y = contentTop + state.offset;
    };
    const scrollBy = (delta: number): void => {
      state.offset = Math.max(0, Math.min(state.max, state.offset + delta));
      apply();
    };

    let dragging = false;
    let dragStartY = 0;
    let dragStartOffset = 0;
    content.on("pointerdown", (e: FederatedPointerEvent) => {
      dragging = true;
      dragStartY = e.global.y;
      dragStartOffset = state.offset;
    });
    const endDrag = (): void => {
      dragging = false;
    };
    content.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (!dragging) return;
      state.offset = Math.max(
        0,
        Math.min(state.max, dragStartOffset - (e.global.y - dragStartY)),
      );
      apply();
    });
    content.on("pointerup", endDrag);
    content.on("pointerupoutside", endDrag);

    if (state.max <= 0) return null;
    const WHEEL_STEP = 40;
    return attachWheelScroll((dir) => scrollBy(dir * WHEEL_STEP));
  }

  private renderPresetTabs(
    loadout: ShipLoadout | null,
    player: Player,
    presets: readonly LoadoutPreset[],
    PX: number,
    PY: number,
  ): void {
    const container = this.ctx!.container;
    const y = PY + 32;
    let x = PX + 20;
    const names: LoadoutPresetName[] = ["1", "2", "3"];
    for (const name of names) {
      const preset = presets.find((p) => p.name === name);

      const label = scaledText(`К${name}:`, 10, 0x88aabb, {
        rawColor: true,
        fontFamily: "monospace",
      });
      label.x = x;
      label.y = y;
      label.eventMode = "none";
      container.addChild(label);
      x += label.width + 4;

      const saveBtn = scaledText("[Сохр]", 10, loadout ? 0x66bbff : 0x556677, {
        rawColor: true,
        fontFamily: "monospace",
      });
      saveBtn.x = x;
      saveBtn.y = y;
      if (loadout) {
        saveBtn.eventMode = "static";
        saveBtn.cursor = "pointer";
        saveBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          const captured = captureLoadoutPreset(name, loadout);
          this.ctx!.mutatePresets(
            upsertLoadoutPreset(this.ctx!.presets, captured),
          );
          this.sfx("ui_click");
          this.ctx!.showToast(`Комплектация ${name} сохранена`, 0x66ddaa);
          this.ctx!.rerender();
        });
      }
      container.addChild(saveBtn);
      x += saveBtn.width + 6;

      const canApply = !!preset && !!loadout;
      const applyBtn = scaledText(
        "[Прим]",
        10,
        canApply ? 0xffcc44 : 0x556677,
        {
          rawColor: true,
          fontFamily: "monospace",
        },
      );
      applyBtn.x = x;
      applyBtn.y = y;
      if (canApply && loadout && preset) {
        applyBtn.eventMode = "static";
        applyBtn.cursor = "pointer";
        applyBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          const result = applyLoadoutPreset(player, loadout, preset);
          this.sfx("ui_click");
          const msg =
            result.skipped.length > 0
              ? `Комплектация ${name} применена (пропущено: ${result.skipped.length})`
              : `Комплектация ${name} применена`;
          this.ctx!.showToast(
            msg,
            result.skipped.length > 0 ? 0xffaa44 : 0x66ddaa,
          );
          this.ctx!.rerender();
        });
      }
      container.addChild(applyBtn);
      x += applyBtn.width + 6;

      const clearBtn = scaledText("[X]", 10, preset ? 0xff8866 : 0x556677, {
        rawColor: true,
        fontFamily: "monospace",
      });
      clearBtn.x = x;
      clearBtn.y = y;
      if (preset) {
        clearBtn.eventMode = "static";
        clearBtn.cursor = "pointer";
        clearBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.ctx!.mutatePresets(removeLoadoutPreset(this.ctx!.presets, name));
          this.sfx("ui_click");
          this.ctx!.showToast(`Комплектация ${name} очищена`, 0xaaaaaa);
          this.ctx!.rerender();
        });
      }
      container.addChild(clearBtn);
      x += clearBtn.width + 16;
    }
  }

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
    const chipH = 22;
    const chipY = PY + 50;
    segs.forEach((s, i) => {
      const cx = PX + 20 + i * colW;
      const chipW = colW - 8;
      const chip = new Graphics();
      chip.rect(cx, chipY, chipW, chipH).fill({ color: 0x0d1822, alpha: 1 });
      chip.rect(cx, chipY, chipW, chipH).stroke({ color: 0x2a4a5a, width: 1 });
      chip.eventMode = "none";
      container.addChild(chip);

      const t = scaledText(s.text, 12, s.fill, {
        rawColor: true,
        fontFamily: "monospace",
      });
      t.x = cx + 6;
      t.y = chipY + 4;
      t.eventMode = "none";
      container.addChild(t);
    });
  }

  private renderFittingRing(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
    player: Player,
  ): number {
    const { leftX, leftW, contentTop } = layout;
    const stats = loadout?.derivedStats() ?? null;
    const installed = loadout?.installedSlots() ?? [];
    const entries: FittedEntry[] = installed
      .map((slot, idx) => ({ slot, idx, gear: gearById(slot.gearId) }))
      .filter((e): e is FittedEntry => !!e.gear);

    const byCat = (cat: SlotCategory) =>
      entries.filter((e) => slotCategoryFor(e.gear) === cat);
    const weaponEntries = byCat("weapon");
    const engineEntries = byCat("engine");
    const radarEntries = byCat("radar");
    const equipEntries = byCat("equipment");
    const isClass = (e: FittedEntry, cls: EquipmentClass) =>
      (e.gear as EquipmentSpec).equipmentClass === cls;
    const fuelEntries = equipEntries.filter((e) =>
      isClass(e, EquipmentClass.FUEL_TANK),
    );
    const scannerEntries = equipEntries.filter((e) =>
      isClass(e, EquipmentClass.SCANNER),
    );
    const miscEquipEntries = equipEntries.filter(
      (e) => !fuelEntries.includes(e) && !scannerEntries.includes(e),
    );

    const zeroCount = { used: 0, total: 0 };
    let y = contentTop;

    const wc = stats?.categories.weapon ?? zeroCount;
    y = this.renderRingZone(
      "ВООРУЖЕНИЕ",
      "weapon",
      weaponEntries,
      Math.max(0, wc.total - weaponEntries.length),
      leftX,
      leftW,
      y,
      loadout,
      player,
    );
    y += 6;

    const zoneW = Math.round(leftW * 0.3);
    const hullX = leftX + zoneW + 8;
    const hullW = leftW - zoneW * 2 - 16;
    const rowTop = y;

    const ec = stats?.categories.engine ?? zeroCount;
    const leftBottom = this.renderRingZone(
      "СИСТЕМА ДВИЖЕНИЯ",
      "engine",
      [...engineEntries, ...fuelEntries],
      Math.max(0, ec.total - engineEntries.length),
      leftX,
      zoneW,
      rowTop,
      loadout,
      player,
    );

    const hullBottom = this.renderHullArtBox(loadout, hullX, rowTop, hullW);

    const rc = stats?.categories.radar ?? zeroCount;
    const rightBottom = this.renderRingZone(
      "СИСТЕМА ОТСЛЕЖИВАНИЯ",
      "radar",
      [...radarEntries, ...scannerEntries],
      Math.max(0, rc.total - radarEntries.length),
      hullX + hullW + 8,
      zoneW,
      rowTop,
      loadout,
      player,
    );

    y = Math.max(leftBottom, hullBottom, rightBottom) + 6;

    const qc = stats?.categories.equipment ?? zeroCount;
    y = this.renderRingZone(
      "ДОПОЛНИТЕЛЬНОЕ ОБОРУДОВАНИЕ",
      "equipment",
      miscEquipEntries,
      Math.max(0, qc.total - equipEntries.length),
      leftX,
      leftW,
      y,
      loadout,
      player,
    );

    return y;
  }

  private renderRingZone(
    groupTitle: string,
    cat: SlotCategory,
    entries: FittedEntry[],
    emptyCount: number,
    x: number,
    w: number,
    y: number,
    loadout: ShipLoadout | null,
    player: Player,
  ): number {
    const container = this.leftContent!;

    const title = scaledText(groupTitle, 10, 0x5f9ac0, {
      rawColor: true,
      fontFamily: "monospace",
    });
    title.x = x;
    title.y = y;
    title.eventMode = "none";
    container.addChild(title);
    y += 14;

    const shownUsed = entries.length;
    const shownTotal = entries.length + emptyCount;
    const header = scaledText(
      `${CATEGORY_LABEL[cat]}  ${shownUsed}/${shownTotal}`,
      12,
      shownUsed < shownTotal ? 0x88ccaa : 0xddaa66,
      { rawColor: true, fontFamily: "monospace" },
    );
    header.x = x;
    header.y = y;
    header.eventMode = "none";
    container.addChild(header);
    y += 22;

    const slotH = fittedSlotHeight();
    for (const e of entries) {
      this.renderFilledSlot(x, w, loadout!, player, e, y, slotH);
      y += slotH + 4;
    }

    for (let k = 0; k < emptyCount; k++) {
      const slotBg = new Graphics();
      slotBg.rect(x, y, w, 24).fill({ color: 0x0a1218, alpha: 1 });
      slotBg.rect(x, y, w, 24).stroke({ color: 0x1a2a3a, width: 1 });
      slotBg.eventMode = "none";
      container.addChild(slotBg);
      const txt = scaledText("— свободно —", 11, 0xb4bcc4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      txt.x = x + 8;
      txt.y = y + 6;
      txt.eventMode = "none";
      container.addChild(txt);
      y += 28;
    }
    return y + 8;
  }

  private renderHullArtBox(
    loadout: ShipLoadout | null,
    x: number,
    y: number,
    w: number,
  ): number {
    const container = this.leftContent!;
    const h = 96;

    const frame = new Graphics();
    frame.rect(x, y, w, h).fill({ color: 0x081018, alpha: 1 });
    frame.rect(x, y, w, h).stroke({ color: 0x2a4a5a, width: 1 });
    frame.eventMode = "none";
    container.addChild(frame);

    if (!loadout) {
      const dash = scaledText("—", 12, 0x5a7a8a, {
        rawColor: true,
        fontFamily: "monospace",
      });
      dash.anchor.set(0.5, 0.5);
      dash.x = x + w / 2;
      dash.y = y + h / 2;
      dash.eventMode = "none";
      container.addChild(dash);
      return y + h;
    }

    const cx = x + w / 2;
    const artCy = y + h / 2 - 8;
    const shipTex =
      pickVariant(
        "player_ships",
        resolveHullArtKey(loadout.hull.hullClass.toLowerCase()),
        loadout.hull.id,
      ) ?? pickVariant("ships", "ranger", loadout.hull.id);
    if (shipTex) {
      const sp = new Sprite(shipTex);
      sp.anchor.set(0.5, 0.5);
      const size = Math.min(w, h) * 0.7;
      sp.width = size;
      sp.height = size;
      sp.x = cx;
      sp.y = artCy;
      sp.eventMode = "none";
      container.addChild(sp);
    } else {
      const s = Math.min(w, h) * 0.34;
      const mark = new Graphics();
      mark
        .rect(cx - s / 2, artCy - s / 2, s, s)
        .fill({ color: 0x4a7a9a, alpha: 0.85 });
      mark.eventMode = "none";
      container.addChild(mark);
    }

    const name = scaledText(loadout.hull.name, 10, 0x9fc4d8, {
      rawColor: true,
      fontFamily: "monospace",
    });
    name.anchor.set(0.5, 1);
    name.x = cx;
    name.y = y + h - 4;
    name.eventMode = "none";
    container.addChild(name);

    return y + h;
  }

  private renderFilledSlot(
    x: number,
    w: number,
    loadout: ShipLoadout,
    player: Player,
    entry: FittedEntry,
    y: number,
    slotH: number,
  ): void {
    const container = this.leftContent!;
    const gear = entry.gear;
    const slot = entry.slot;
    const idx = entry.idx;
    const nameStep = lineStepFor(scaledFont(11));
    const mmStep = lineStepFor(scaledFont(10));

    const slotBg = new Graphics();
    slotBg.rect(x, y, w, slotH).fill({ color: 0x0d2030, alpha: 1 });
    slotBg.rect(x, y, w, slotH).stroke({ color: 0x336655, width: 1 });
    slotBg.eventMode = "none";
    container.addChild(slotBg);

    this.dropZones.push({
      x,
      y,
      w,
      h: slotH,
      target: { kind: "gear", slotIndex: idx },
    });

    const iconSize = Math.min(18, slotH - 8);
    const iconOffset = mountGearIcon(
      container,
      gear,
      x + 6,
      y + slotH / 2,
      iconSize,
    );

    const name = scaledText(`${gear.name} (T${gear.techLevel})`, 11, 0xb8e6c8, {
      rawColor: true,
      fontFamily: "monospace",
    });
    name.x = x + 8 + iconOffset;
    name.y = y + 4;
    name.eventMode = "none";
    container.addChild(name);

    const unBtn = scaledText("[снять]", 11, 0xff8844, {
      rawColor: true,
      fontFamily: "monospace",
    });
    unBtn.anchor.set(1, 0.5);
    unBtn.x = x + w - 8;
    unBtn.y = y + 4 + nameStep / 2;
    unBtn.eventMode = "static";
    unBtn.cursor = "pointer";
    unBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      if (loadout.removeAt(idx)) {
        player.inventory.addItem(slotToBagModule(gear, slot));
      }
      this.ctx!.rerender();
    });
    container.addChild(unBtn);

    const mmCategory = gearMicromoduleCategory(gear);
    const mmRowY = y + 4 + nameStep;
    if (slot.micromoduleId) {
      const mmLabel =
        microModuleById(slot.micromoduleId)?.name ?? slot.micromoduleId;
      const mmTag = scaledText(`мм: ${mmLabel}`, 10, 0xffcc44, {
        rawColor: true,
        fontFamily: "monospace",
      });
      mmTag.x = x + 8 + iconOffset;
      mmTag.y = mmRowY;
      mmTag.eventMode = "none";
      container.addChild(mmTag);
    } else {
      const hasMatchingMm =
        mmCategory !== null &&
        player.inventory.micromodules.some(
          (mm) => mm.targetCategory === mmCategory,
        );
      const control = micromoduleSlotControl(mmCategory, hasMatchingMm);
      const mmBtn = scaledText(
        control.label,
        10,
        control.actionable ? 0xffaa22 : 0xb4bcc4,
        { rawColor: true, fontFamily: "monospace" },
      );
      mmBtn.anchor.set(1, 0.5);
      mmBtn.x = x + w - 8;
      mmBtn.y = mmRowY + mmStep / 2;
      if (control.actionable) {
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

  private renderHullMicromoduleBank(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
  ): number {
    const container = this.leftContent!;
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

    this.dropZones.push({
      x: leftX,
      y: rowY,
      w: leftW,
      h: chipH,
      target: { kind: "hull" },
    });

    return rowY + chipH + 12;
  }

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
    chip.hitArea = new Rectangle(0, 0, w, h);
    chip.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.beginMicromoduleDrag(mm, e);
    });
    container.addChild(chip);
    this.chipRects.push({ id: mm.id, x, y, w, h });
  }

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
      ctx?.rerender();
      return;
    }

    const outcome = applyMicromoduleDrop(loadout, zone.target, drag.mm.id);
    if (outcome === "ok") {
      const idx = player.inventory.micromodules.indexOf(drag.mm);
      if (idx >= 0) player.inventory.micromodules.splice(idx, 1);
      this.sfx("ui_click");
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

  private dropZoneAt(
    gx: number,
    gy: number,
  ): { target: MicromoduleDropTarget } | null {
    const adjGy = gy + this.leftScroll.offset;
    for (const z of this.dropZones) {
      if (gx >= z.x && gx <= z.x + z.w && adjGy >= z.y && adjGy <= z.y + z.h) {
        return z;
      }
    }
    return null;
  }

  private renderWarehouseAndCargo(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
    player: Player,
  ): number {
    const container = this.rightContent!;
    const { rightX, rightW, contentTop, contentBottom } = layout;
    const nominalSplitY = Math.round(
      contentTop + (contentBottom - contentTop) * 0.6,
    );

    const sklLabel = scaledText("СКЛАД (снаряжение):", 12, 0x88aa44, {
      rawColor: true,
      fontFamily: "monospace",
    });
    sklLabel.x = rightX;
    sklLabel.y = contentTop;
    sklLabel.eventMode = "none";
    container.addChild(sklLabel);

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
    const btnGap = Math.max(20, lineStepFor(scaledFont(11)) + 4);
    const warehouseRowH = 12 + btnGap * 2 + 8;
    for (const row of rows) {
      const gearId =
        row.kind === "owned" ? row.gearId : (legacy[row.index]?.id ?? "");
      const gear = gearById(gearId);
      const name =
        row.kind === "owned"
          ? (gear?.name ?? gearId)
          : (legacy[row.index]?.name ?? gearId);

      const rowBg = new Graphics();
      rowBg
        .rect(rightX, y, rightW, warehouseRowH)
        .fill({ color: 0x14160a, alpha: 1 });
      rowBg
        .rect(rightX, y, rightW, warehouseRowH)
        .stroke({ color: 0x30401a, width: 1 });
      rowBg.eventMode = "none";
      container.addChild(rowBg);

      const rowIconOffset = gear
        ? mountGearIcon(
            container,
            gear,
            rightX + 6,
            y + warehouseRowH / 2,
            Math.min(18, warehouseRowH - 8),
          )
        : 0;
      const rowText = scaledText(
        gear ? `${name} (T${gear.techLevel})` : name,
        11,
        0xccddaa,
        { rawColor: true, fontFamily: "monospace" },
      );
      rowText.x = rightX + 8 + rowIconOffset;
      rowText.y = y + 4;
      rowText.eventMode = "none";
      container.addChild(rowText);

      const btnRight = rightX + rightW - 8;
      const ownedGearId = row.kind === "owned" ? row.gearId : null;
      const confirmingJettison =
        ownedGearId !== null &&
        this.pendingJettison?.kind === "gear" &&
        this.pendingJettison.id === ownedGearId;

      if (confirmingJettison && ownedGearId) {
        const cancelBtn = scaledText("[Отмена]", 11, 0x99aabb, {
          rawColor: true,
          fontFamily: "monospace",
        });
        cancelBtn.anchor.set(1, 0.5);
        cancelBtn.x = btnRight;
        cancelBtn.y = y + 12;
        cancelBtn.eventMode = "static";
        cancelBtn.cursor = "pointer";
        cancelBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.cancelJettisonConfirm();
        });
        container.addChild(cancelBtn);

        const confirmBtn = scaledText("[Выбросить]", 11, 0xff7755, {
          rawColor: true,
          fontFamily: "monospace",
        });
        confirmBtn.anchor.set(1, 0.5);
        confirmBtn.x = btnRight;
        confirmBtn.y = y + 12 + btnGap;
        confirmBtn.eventMode = "static";
        confirmBtn.cursor = "pointer";
        confirmBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          this.confirmJettison();
        });
        container.addChild(confirmBtn);
      } else {
        if (row.kind === "owned" && gear) {
          const sellBtn = scaledText(
            `[Продать ${sellGearPrice(gear)}₡]`,
            11,
            0x44ff88,
            { rawColor: true, fontFamily: "monospace" },
          );
          sellBtn.anchor.set(1, 0.5);
          sellBtn.x = btnRight;
          sellBtn.y = y + 12 + btnGap;
          sellBtn.eventMode = "static";
          sellBtn.cursor = "pointer";
          sellBtn.on("pointerdown", (e) => {
            e.stopPropagation();
            const refund = sellUninstalledGear(player, gearId, this.ctx!.bank);
            if (refund > 0) {
              this.sfx("sell");
              this.ctx!.showToast(
                `Продано: ${gear.name} (+${refund} ₡)`,
                0x44ff88,
              );
            }
            this.ctx!.rerender();
          });
          container.addChild(sellBtn);
        }

        const installable = !!gear && gear.kind !== GearKind.HULL && !!loadout;
        if (installable && loadout) {
          const eqBtn = scaledText("[Установить]", 11, 0x44ddaa, {
            rawColor: true,
            fontFamily: "monospace",
          });
          eqBtn.anchor.set(1, 0.5);
          eqBtn.x = btnRight;
          eqBtn.y = y + 12;
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

        if (ownedGearId) {
          const jettisonBtn = scaledText("[Выброс]", 11, 0xff8844, {
            rawColor: true,
            fontFamily: "monospace",
          });
          jettisonBtn.anchor.set(1, 0.5);
          jettisonBtn.x = btnRight;
          jettisonBtn.y = y + 12 + btnGap * 2;
          jettisonBtn.eventMode = "static";
          jettisonBtn.cursor = "pointer";
          jettisonBtn.on("pointerdown", (e) => {
            e.stopPropagation();
            this.requestJettisonConfirm("gear", ownedGearId);
          });
          container.addChild(jettisonBtn);
        }
      }
      y += warehouseRowH + 8;
    }

    const splitY = Math.max(nominalSplitY, y + 12);
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
      cy += 18;
    } else {
      const btnRight = rightX + rightW - 8;
      for (const r of resources) {
        const confirmingResource =
          this.pendingJettison?.kind === "resource" &&
          this.pendingJettison.id === r.type;
        const rowH = confirmingResource ? 8 + btnGap * 2 : 18;

        const label = RESOURCE_LABEL[r.type] ?? r.type;
        const line = scaledText(`${label} ×${r.amount}`, 11, 0xb4c4d4, {
          rawColor: true,
          fontFamily: "monospace",
        });
        line.x = rightX + 6;
        line.y = cy;
        line.eventMode = "none";
        container.addChild(line);

        if (confirmingResource) {
          const cancelBtn = scaledText("[Отмена]", 10, 0x99aabb, {
            rawColor: true,
            fontFamily: "monospace",
          });
          cancelBtn.anchor.set(1, 0.5);
          cancelBtn.x = btnRight;
          cancelBtn.y = cy + 4;
          cancelBtn.eventMode = "static";
          cancelBtn.cursor = "pointer";
          cancelBtn.on("pointerdown", (e) => {
            e.stopPropagation();
            this.cancelJettisonConfirm();
          });
          container.addChild(cancelBtn);

          const confirmBtn = scaledText("[Выбросить]", 10, 0xff7755, {
            rawColor: true,
            fontFamily: "monospace",
          });
          confirmBtn.anchor.set(1, 0.5);
          confirmBtn.x = btnRight;
          confirmBtn.y = cy + 4 + btnGap;
          confirmBtn.eventMode = "static";
          confirmBtn.cursor = "pointer";
          confirmBtn.on("pointerdown", (e) => {
            e.stopPropagation();
            this.confirmJettison();
          });
          container.addChild(confirmBtn);
        } else {
          const jettisonBtn = scaledText("[Выброс]", 10, 0xff8844, {
            rawColor: true,
            fontFamily: "monospace",
          });
          jettisonBtn.anchor.set(1, 0.5);
          jettisonBtn.x = btnRight;
          jettisonBtn.y = cy + 6;
          jettisonBtn.eventMode = "static";
          jettisonBtn.cursor = "pointer";
          jettisonBtn.on("pointerdown", (e) => {
            e.stopPropagation();
            this.requestJettisonConfirm("resource", r.type);
          });
          container.addChild(jettisonBtn);
        }
        cy += rowH;
      }
    }
    return cy;
  }

  private renderServiceCenter(
    layout: HangarLayout,
    loadout: ShipLoadout | null,
    player: Player,
    y: number,
  ): number {
    const container = this.rightContent!;
    const { rightX } = layout;
    const ship = player.ship;
    if (loadout) applyLoadoutHullToShip(ship, loadout);
    const status = hullStatus(
      ship.hullHP,
      ship.maxHull,
      loadout?.derivedStats().maxHull,
    );

    y += 12;
    const title = scaledText("СЕРВИСНЫЙ ЦЕНТР", 12, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
    });
    title.x = rightX;
    title.y = y;
    title.eventMode = "none";
    container.addChild(title);
    y += 22;

    const hullLine = scaledText(
      `Корпус: ${status.percent}% (${status.maxHull - status.missing}/${status.maxHull})`,
      11,
      0xb4c4d4,
      { rawColor: true, fontFamily: "monospace" },
    );
    hullLine.x = rightX;
    hullLine.y = y;
    hullLine.eventMode = "none";
    container.addChild(hullLine);
    y += 20;

    const cost = repairCost(status, this.ctx!.repairRatePerHp);
    if (cost == null) {
      const label = scaledText("Ремонт не требуется", 11, 0x66dd88, {
        rawColor: true,
        fontFamily: "monospace",
      });
      label.x = rightX;
      label.y = y;
      label.eventMode = "none";
      container.addChild(label);
      return y + 20;
    }

    const repairBtn = scaledText(`[Полный ремонт ${cost}₡]`, 11, 0xffcc44, {
      rawColor: true,
      fontFamily: "monospace",
    });
    repairBtn.x = rightX;
    repairBtn.y = y;
    repairBtn.eventMode = "static";
    repairBtn.cursor = "pointer";
    repairBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      if (player.credits < cost) {
        this.ctx!.showToast(`Нужно ${cost} ₡ — недостаточно средств`, 0xff5544);
        return;
      }
      adjustPlayerCredits(
        this.ctx!.bank,
        player,
        -cost,
        GL_COUNTERPARTY.SERVICES,
        "Ремонт корпуса",
      );
      ship.repair();
      this.sfx("buy");
      this.ctx!.showToast(diagnosticVoiceLine(cost), 0x44ff88);
      this.ctx!.rerender();
    });
    container.addChild(repairBtn);
    return y + 20;
  }

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
      const displaced = loadout.displacedBy(mod.id);
      if (this.ctx!.equipment.installGear(loadout, mod.id)) {
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
    this.sfx("ui_click");
    this.ctx!.rerender();
  }

  private requestJettisonConfirm(kind: "gear" | "resource", id: string): void {
    this.pendingJettison = { kind, id };
    this.ctx!.rerender();
  }

  private cancelJettisonConfirm(): void {
    this.pendingJettison = null;
    this.ctx!.rerender();
  }

  private confirmJettison(): void {
    const pending = this.pendingJettison;
    this.pendingJettison = null;
    const ctx = this.ctx!;
    const player = ctx.player;
    if (!pending) {
      ctx.rerender();
      return;
    }
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
    this.sfx("ui_click");
    ctx.rerender();
  }
}
