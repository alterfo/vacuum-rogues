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

/**
 * The Accessibility settings group (accessibility pass,
 * `docs/plans/20260625-accessibility-pass.md`, Task 4): the player-facing UI for
 * the three pure seams built in Tasks 1–3 —
 *   • **ПАЛИТРА** (palette mode): a cycle button stepping through
 *     {@link PALETTE_MODES} (default + three dichromat-friendly remaps), read via
 *     {@link currentPaletteMode}/{@link setPaletteMode};
 *   • **МЕНЬШЕ ДВИЖЕНИЯ** (reduced motion): a ВКЛ/ВЫКЛ toggle over the explicit
 *     player setting (`isReducedMotionSet`/`setReducedMotion`); the OS-level
 *     `prefers-reduced-motion` is honoured independently by `reducedMotion()`; and
 *   • **УПРАВЛЕНИЕ** (key remap): a row per {@link FlightAction} showing its bound
 *     key; tapping a row captures the next keypress and rebinds it through the
 *     pure {@link rebind} (conflicts are surfaced, not silently double-bound), plus
 *     a «Сбросить клавиши» reset.
 *
 * It is a **separate panel** from {@link SettingsPanel} (the unified ⚙ panel) on
 * purpose: the settings panel's hit-area layout is pinned by locked tests, so the
 * accessibility group lives in its own ♿ surface mounted alongside it by the HUD.
 *
 * Every control writes through its existing browser-level `localStorage` pref (no
 * new save-state field) and fans the live effect out via {@link
 * AccessibilityPanelDeps}. Control actions are public methods
 * ({@link cyclePalette}/{@link toggleReducedMotion}/{@link beginRebind}/
 * {@link captureRebind}/{@link resetKeymapToDefaults}) so the behaviour is
 * unit-testable without driving PixiJS pointer events or the DOM.
 */
export interface AccessibilityPanelDeps {
  /** Live-apply a palette change. Optional — colours otherwise apply on the next rebuild. */
  onPaletteChange?: (mode: PaletteMode) => void;
  /** Live-apply a reduced-motion change. Optional — most consumers read the flag per-frame. */
  onReducedMotionChange?: (on: boolean) => void;
  /** Notify the host a key binding changed (so anything caching the map can refresh). */
  onKeymapChange?: (map: FlightKeymap) => void;
  /** Ask the host to close the panel (the «Закрыть» button). */
  onRequestClose?: () => void;
  /**
   * Install a keyboard capture while rebinding, returning a disposer. Defaults to
   * a capture-phase `window` listener that swallows the key (so it neither
   * scrolls the page nor reaches the flight key router). Injectable so the rebind
   * flow is unit-testable without the DOM.
   */
  installKeyCapture?: (
    handler: (e: { key: string; code?: string }) => void,
  ) => () => void;
}

/** Fixed panel geometry (the host positions the whole panel by these). */
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

// Vertical layout — fixed row positions (a y per section keeps the panel legible
// and the hit areas stable for the tests).
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
  /** The mounted panel container (stable across re-renders). */
  readonly container: Container;
  private content: Container | null = null;

  /** The action currently awaiting a key (null when not rebinding). */
  private rebinding: FlightAction | null = null;
  /** The action a rejected rebind collided with (cleared on success/cancel). */
  private conflictWith: FlightAction | null = null;
  /** Disposer for the active rebind key capture. */
  private captureDispose: (() => void) | null = null;

  constructor(private readonly deps: AccessibilityPanelDeps = {}) {
    this.container = new Container();
    this.container.eventMode = "static";
    // Swallow clicks so the scene's outside-click handler doesn't close the
    // panel from under the player while they interact with it.
    this.container.on("pointerdown", (e) => e.stopPropagation());
    this.render();
  }

  /** Tear down the panel container (children included) + any pending capture. */
  destroy(): void {
    this.disposeCapture();
    this.container.destroy({ children: true });
  }

  // -------------------------------------------------------------------------
  // Control actions (public so the behaviour is testable without PixiJS events)
  // -------------------------------------------------------------------------

  /** The active palette mode (reads the live `localStorage` store). */
  currentPalette(): PaletteMode {
    return currentPaletteMode();
  }

  /** Step to the next palette mode (wrapping), persist, apply live, re-render. */
  cyclePalette(): void {
    const modes = PALETTE_MODES;
    const idx = Math.max(0, modes.indexOf(this.currentPalette()));
    const next = modes[(idx + 1) % modes.length];
    setPaletteMode(next);
    this.deps.onPaletteChange?.(next);
    this.render();
  }

  /** True while the explicit reduced-motion setting is on. */
  isReducedMotionOn(): boolean {
    return isReducedMotionSet();
  }

  /** Flip the explicit reduced-motion setting, notify the host, re-render. */
  toggleReducedMotion(): void {
    const next = !this.isReducedMotionOn();
    setReducedMotion(next);
    this.deps.onReducedMotionChange?.(next);
    this.render();
  }

  /** The active action→key bindings (reads the live `localStorage` store). */
  keymap(): FlightKeymap {
    return currentKeymap();
  }

  /** True while `action`'s row is awaiting a key to bind. */
  isRebinding(action: FlightAction): boolean {
    return this.rebinding === action;
  }

  /** The action a rejected rebind last collided with, or null. */
  rebindConflict(): FlightAction | null {
    return this.conflictWith;
  }

  /**
   * Start rebinding `action`: install a one-shot key capture and re-render so the
   * row prompts for a key. Any in-progress rebind is cancelled first.
   */
  beginRebind(action: FlightAction): void {
    if (this.rebinding) this.disposeCapture();
    this.rebinding = action;
    this.conflictWith = null;
    const install = this.deps.installKeyCapture ?? liveKeyCapture;
    this.captureDispose = install((e) => this.captureRebind(e));
    this.render();
  }

  /**
   * Apply a captured key to the action being rebound. Escape aborts; a key
   * already held by another action is rejected (the conflict is surfaced and the
   * capture stays open so the player can pick a different key); a free key is
   * bound, persisted, and the capture closes.
   */
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

  /** Abort an in-progress rebind without changing any binding. */
  cancelRebind(): void {
    this.rebinding = null;
    this.conflictWith = null;
    this.disposeCapture();
    this.render();
  }

  /** Restore the default key bindings, notify the host, re-render. */
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

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Rebuild the panel content to reflect the current settings. */
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

  /** Section label above a control row. */
  private addSectionLabel(parent: Container, text: string, y: number): void {
    const lbl = scaledText(text, 12, LABEL_COLOR);
    lbl.x = PAD;
    lbl.y = y;
    lbl.eventMode = "none";
    parent.addChild(lbl);
  }

  /** ПАЛИТРА: a full-width cycle button showing the active mode's name. */
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

  /** МЕНЬШЕ ДВИЖЕНИЯ: a full-width ВКЛ/ВЫКЛ toggle. */
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

  /** УПРАВЛЕНИЕ: one row per flight action (name + rebindable key) + reset. */
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

  /** A full-width «Закрыть» button (the deliberate close affordance). */
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

  /**
   * A single highlightable cell button: rounded background (accent-bordered when
   * active), a centred label, and a transparent `static` hit area that runs
   * `onTap`. The label/background are `eventMode:"none"` so the hit area owns the
   * click (PixiJS-8 layered-hit pattern, mirroring {@link SettingsPanel}).
   */
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

/**
 * The default rebind key capture: a capture-phase `window` keydown listener that
 * swallows the event (so the rebind key neither scrolls the page nor reaches the
 * flight key router) and forwards it to `handler`. No-op when `window` is absent.
 */
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
