import { Container, Graphics } from "pixi.js";
import { scaledText } from "./scaledText";
import { t } from "@/i18n/i18n";
import {
  PALETTE_MODES,
  currentPaletteMode,
  setPaletteMode,
  type PaletteMode,
} from "./palette";
import { isReducedMotionSet, setReducedMotion } from "./reducedMotion";
import {
  FLIGHT_ACTIONS,
  currentKeymap,
  keyLabel,
  rebind,
  resetKeymap,
  setKeymap,
  type FlightAction,
  type FlightKeymap,
} from "@/presentation/input/keymap";

export interface AccessibilityPanelDeps {
  onPaletteChange?: (mode: PaletteMode) => void;
  onReducedMotionChange?: (on: boolean) => void;
  onKeymapChange?: (map: FlightKeymap) => void;
  onRequestClose?: () => void;
  installKeyCapture?: (
    handler: (e: { key: string; code?: string }) => void,
  ) => () => void;
}

export const ACCESSIBILITY_PANEL_WIDTH = 240;
export const ACCESSIBILITY_PANEL_HEIGHT = 384;

const PAD = 12;
const ROW_W = ACCESSIBILITY_PANEL_WIDTH - PAD * 2;

const ACCENT = 0x00ccff;
const ACTIVE_BG = 0x1a3048;
const IDLE_BG = 0x0e1e2c;
const TITLE_COLOR = 0x00ccff;
const LABEL_COLOR = 0x88aacc;
const ON_COLOR = 0x44ff88;
const OFF_COLOR = 0x99a8ba;
const CONFLICT_COLOR = 0xff5566;

const PALETTE_LABEL_Y = 40;
const PALETTE_ROW_Y = 60;
const MOTION_LABEL_Y = 102;
const MOTION_ROW_Y = 122;
const CONTROLS_LABEL_Y = 164;
const CONTROLS_ROW_Y0 = 186;
const CONTROLS_ROW_STEP = 28;
const RESET_ROW_Y =
  CONTROLS_ROW_Y0 + CONTROLS_ROW_STEP * FLIGHT_ACTIONS.length + 6;
const CLOSE_ROW_Y = RESET_ROW_Y + 36;
const KEY_CELL_W = 92;

export class AccessibilityPanel {
  readonly container: Container;
  private content: Container | null = null;

  private rebinding: FlightAction | null = null;
  private conflictWith: FlightAction | null = null;
  private captureDispose: (() => void) | null = null;

  constructor(private readonly deps: AccessibilityPanelDeps = {}) {
    this.container = new Container();
    this.container.eventMode = "static";
    this.container.on("pointerdown", (e) => e.stopPropagation());
    this.render();
  }

  destroy(): void {
    this.disposeCapture();
    this.container.destroy({ children: true });
  }

  currentPalette(): PaletteMode {
    return currentPaletteMode();
  }

  cyclePalette(): void {
    const modes = PALETTE_MODES;
    const idx = Math.max(0, modes.indexOf(this.currentPalette()));
    const next = modes[(idx + 1) % modes.length];
    setPaletteMode(next);
    this.deps.onPaletteChange?.(next);
    this.render();
  }

  isReducedMotionOn(): boolean {
    return isReducedMotionSet();
  }

  toggleReducedMotion(): void {
    const next = !this.isReducedMotionOn();
    setReducedMotion(next);
    this.deps.onReducedMotionChange?.(next);
    this.render();
  }

  keymap(): FlightKeymap {
    return currentKeymap();
  }

  isRebinding(action: FlightAction): boolean {
    return this.rebinding === action;
  }

  rebindConflict(): FlightAction | null {
    return this.conflictWith;
  }

  beginRebind(action: FlightAction): void {
    if (this.rebinding) this.disposeCapture();
    this.rebinding = action;
    this.conflictWith = null;
    const install = this.deps.installKeyCapture ?? liveKeyCapture;
    this.captureDispose = install((e) => this.captureRebind(e));
    this.render();
  }

  captureRebind(event: { key: string; code?: string }): void {
    const action = this.rebinding;
    if (!action) return;
    if (event.key === "Escape") {
      this.cancelRebind();
      return;
    }
    const result = rebind(this.keymap(), action, event.key);
    if (result.ok) {
      setKeymap(result.map);
      this.deps.onKeymapChange?.(result.map);
      this.rebinding = null;
      this.conflictWith = null;
      this.disposeCapture();
      this.render();
    } else {
      this.conflictWith = result.conflict;
      this.render();
    }
  }

  cancelRebind(): void {
    this.rebinding = null;
    this.conflictWith = null;
    this.disposeCapture();
    this.render();
  }

  resetKeymapToDefaults(): void {
    if (this.rebinding) this.cancelRebind();
    resetKeymap();
    this.deps.onKeymapChange?.(currentKeymap());
    this.render();
  }

  private disposeCapture(): void {
    if (this.captureDispose) {
      this.captureDispose();
      this.captureDispose = null;
    }
  }

  private render(): void {
    if (this.content) this.content.destroy({ children: true });
    const content = new Container();
    this.content = content;
    this.container.addChild(content);

    const bg = new Graphics();
    bg.roundRect(
      0,
      0,
      ACCESSIBILITY_PANEL_WIDTH,
      ACCESSIBILITY_PANEL_HEIGHT,
      6,
    ).fill({
      color: 0x0a1520,
      alpha: 0.94,
    });
    bg.roundRect(
      0,
      0,
      ACCESSIBILITY_PANEL_WIDTH,
      ACCESSIBILITY_PANEL_HEIGHT,
      6,
    ).stroke({
      color: 0x334455,
      width: 1,
    });
    content.addChild(bg);

    const title = scaledText(t("a11y.title"), 14, TITLE_COLOR, {
      fontWeight: "bold",
    });
    title.anchor.set(0.5, 0);
    title.x = ACCESSIBILITY_PANEL_WIDTH / 2;
    title.y = PAD;
    title.eventMode = "none";
    content.addChild(title);

    this.renderPaletteRow(content);
    this.renderMotionRow(content);
    this.renderControlsRows(content);
    this.renderCloseRow(content);
  }

  private addSectionLabel(parent: Container, text: string, y: number): void {
    const lbl = scaledText(text, 12, LABEL_COLOR);
    lbl.x = PAD;
    lbl.y = y;
    lbl.eventMode = "none";
    parent.addChild(lbl);
  }

  private renderPaletteRow(parent: Container): void {
    this.addSectionLabel(parent, t("a11y.palette"), PALETTE_LABEL_Y);
    const mode = this.currentPalette();
    this.addCellButton(
      parent,
      PAD,
      PALETTE_ROW_Y,
      ROW_W,
      30,
      t(`palette.${mode}`),
      13,
      mode !== "default",
      () => this.cyclePalette(),
    );
  }

  private renderMotionRow(parent: Container): void {
    this.addSectionLabel(parent, t("a11y.reducedMotion"), MOTION_LABEL_Y);
    const on = this.isReducedMotionOn();
    this.addCellButton(
      parent,
      PAD,
      MOTION_ROW_Y,
      ROW_W,
      30,
      on ? t("settings.on") : t("settings.off"),
      14,
      on,
      () => this.toggleReducedMotion(),
      on ? ON_COLOR : OFF_COLOR,
    );
  }

  private renderControlsRows(parent: Container): void {
    this.addSectionLabel(parent, t("a11y.controls"), CONTROLS_LABEL_Y);
    const map = this.keymap();
    FLIGHT_ACTIONS.forEach((action, i) => {
      const rowY = CONTROLS_ROW_Y0 + i * CONTROLS_ROW_STEP;

      const name = scaledText(t(`action.${action}`), 12, LABEL_COLOR);
      name.x = PAD;
      name.y = rowY + 6;
      name.eventMode = "none";
      parent.addChild(name);

      const rebinding = this.isRebinding(action);
      const conflict = rebinding && this.conflictWith !== null;
      const label = rebinding
        ? conflict
          ? t("a11y.keyTaken")
          : t("a11y.pressKey")
        : keyLabel(map[action]);
      this.addCellButton(
        parent,
        ACCESSIBILITY_PANEL_WIDTH - PAD - KEY_CELL_W,
        rowY,
        KEY_CELL_W,
        24,
        label,
        12,
        rebinding,
        () => (rebinding ? this.cancelRebind() : this.beginRebind(action)),
        conflict ? CONFLICT_COLOR : ACCENT,
      );
    });

    this.addCellButton(
      parent,
      PAD,
      RESET_ROW_Y,
      ROW_W,
      28,
      t("a11y.reset"),
      12,
      false,
      () => this.resetKeymapToDefaults(),
    );
  }

  private renderCloseRow(parent: Container): void {
    this.addCellButton(
      parent,
      PAD,
      CLOSE_ROW_Y,
      ROW_W,
      30,
      t("common.close"),
      13,
      false,
      () => this.deps.onRequestClose?.(),
    );
  }

  private addCellButton(
    parent: Container,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    labelPx: number,
    active: boolean,
    onTap: () => void,
    activeLabelColor: number = ACCENT,
  ): void {
    const bg = new Graphics();
    bg.roundRect(x, y, w, h, 3).fill({
      color: active ? ACTIVE_BG : IDLE_BG,
      alpha: 1,
    });
    if (active) {
      bg.roundRect(x, y, w, h, 3).stroke({ color: ACCENT, width: 1 });
    }
    bg.eventMode = "none";
    parent.addChild(bg);

    const lbl = scaledText(
      label,
      labelPx,
      active ? activeLabelColor : LABEL_COLOR,
    );
    lbl.anchor.set(0.5);
    lbl.x = x + w / 2;
    lbl.y = y + h / 2;
    lbl.eventMode = "none";
    parent.addChild(lbl);

    const hit = new Graphics();
    hit.roundRect(x, y, w, h, 3).fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointerdown", (event) => {
      (event as { stopPropagation?: () => void }).stopPropagation?.();
      onTap();
    });
    parent.addChild(hit);
  }
}

function liveKeyCapture(
  handler: (e: { key: string; code?: string }) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
    handler(e);
  };
  window.addEventListener("keydown", listener, true);
  return () => window.removeEventListener("keydown", listener, true);
}
