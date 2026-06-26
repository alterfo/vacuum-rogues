import { Container, Graphics } from "pixi.js";
import { scaledText } from "./scaledText";
import {
  getFontKey,
  getSpeed,
  isNeuralEnabled,
  setFontKey,
  setNeuralEnabled,
  setSpeed,
  type SettingsStore,
  type SpeedTarget,
} from "@/systems/settings/gameSettings";
import type { FontSizeKey } from "@/utils/fontScale";

/**
 * The unified in-flight settings panel surfaced by the ⚙ HUD button
 * (`docs/plans/20260625-settings-interface-speed-font-neural.md`): one screen
 * with three controls — **СКОРОСТЬ** (game speed), **ШРИФТ** (S/M/L font), and a
 * **НЕЙРОСЕТЬ (ИИ)** on/off toggle (experimental, off by default).
 *
 * Each control writes through the shared {@link gameSettings} store (no new
 * save-state field) and fans the *live* effect out to the host via the
 * {@link SettingsPanelDeps} callbacks:
 *   • a font pick calls {@link SettingsPanelDeps.applyFont} (the scene restyles
 *     in place) and then {@link SettingsPanelDeps.onRequestClose} — a font change
 *     rebuilds the whole HUD, so the panel closes (preserving the historical
 *     ⚙-panel contract / playtest4 A);
 *   • a speed pick calls {@link SettingsPanelDeps.applySpeed} (HUD label +
 *     physics `timeScale`) and re-renders so the active step updates;
 *   • the neural toggle flips `setNeuralEnabled` and calls
 *     {@link SettingsPanelDeps.onNeuralToggle} (the gate Task 2 consults) then
 *     re-renders so the ВКЛ/ВЫКЛ label flips.
 *
 * The component is self-contained (builds into {@link container}); the host only
 * mounts/tears down the container and positions it. The control actions are
 * public methods ({@link selectFont}/{@link selectSpeed}/{@link toggleNeural}) so
 * the behaviour is unit-testable without driving PixiJS pointer events.
 */
export interface SettingsPanelDeps {
  /** The game-speed sink (carries `gameSpeedMultiplier`) — the GameEngine satisfies it. */
  speedTarget: SpeedTarget;
  /** Selectable speed steps (`GAME_BALANCE.gameSpeedMultipliers`). */
  speedSteps: readonly number[];
  /** Apply a chosen speed live: the HUD label + physics `timeScale`. */
  applySpeed: (scale: number) => void;
  /** Apply a font change live: the scene restyles its text-bearing modules. */
  applyFont: () => void;
  /** Fired when the neural flag flips (the gate hook; no heavy runtime — pure-TS MLP). */
  onNeuralToggle?: (on: boolean) => void;
  /**
   * Ask the host to close the panel. Called after a font pick (a font change
   * rebuilds the HUD, so the panel can't stay meaningfully open).
   */
  onRequestClose?: () => void;
  /** Injectable feature-flag store (defaults to live `localStorage`). */
  store?: SettingsStore;
}

/** Fixed panel geometry (the host positions the whole panel by these). */
export const SETTINGS_PANEL_WIDTH = 220;
export const SETTINGS_PANEL_HEIGHT = 250;

const PAD = 12;
const ROW_W = SETTINGS_PANEL_WIDTH - PAD * 2;
const BTN_GAP = 8;
const TRIO_BTN_W = (ROW_W - BTN_GAP * 2) / 3;

const ACCENT = 0x00ccff;
const ACTIVE_BG = 0x1a3048;
const IDLE_BG = 0x0e1e2c;
const TITLE_COLOR = 0x00ccff;
const LABEL_COLOR = 0x88aacc;
const HINT_COLOR = 0x99a8ba;
const ON_COLOR = 0x44ff88;
const OFF_COLOR = 0x99a8ba;

const FONT_KEYS: readonly FontSizeKey[] = ["S", "M", "L"];
// The three "A" glyphs grow S→M→L so the size control reads at a glance.
const FONT_GLYPH_PX: Readonly<Record<FontSizeKey, number>> = {
  S: 12,
  M: 16,
  L: 20,
};

export class SettingsPanel {
  /** The mounted panel container (stable across re-renders). */
  readonly container: Container;
  private content: Container | null = null;

  constructor(private readonly deps: SettingsPanelDeps) {
    this.container = new Container();
    this.container.eventMode = "static";
    // Swallow clicks so the scene's outside-click handler doesn't close the
    // panel from under the player while they interact with it.
    this.container.on("pointerdown", (e) => e.stopPropagation());
    this.render();
  }

  /** Tear down the panel container (children included). */
  destroy(): void {
    this.container.destroy({ children: true });
  }

  // -------------------------------------------------------------------------
  // Control actions (public so the behaviour is testable without PixiJS events)
  // -------------------------------------------------------------------------

  /**
   * Pick a font size: persist it, restyle live, then ask the host to close (a
   * font change rebuilds the HUD — keeping the panel open would show a stale
   * copy). Created/wired first so it stays the historical ⚙-panel action.
   */
  selectFont(key: FontSizeKey): void {
    setFontKey(key);
    this.deps.applyFont();
    this.deps.onRequestClose?.();
  }

  /** Pick a game speed: persist it through the store, apply live, re-render. */
  selectSpeed(scale: number): void {
    setSpeed(this.deps.speedTarget, scale);
    this.deps.applySpeed(scale);
    this.render();
  }

  /** Flip the (experimental) neural-AI flag, notify the gate, re-render. */
  toggleNeural(): void {
    const next = !isNeuralEnabled(this.deps.store);
    setNeuralEnabled(next, this.deps.store);
    this.deps.onNeuralToggle?.(next);
    this.render();
  }

  /** True while the neural-AI flag is on (reads the live/injected store). */
  isNeuralOn(): boolean {
    return isNeuralEnabled(this.deps.store);
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
    bg.roundRect(0, 0, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT, 6).fill({
      color: 0x0a1520,
      alpha: 0.94,
    });
    bg.roundRect(0, 0, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT, 6).stroke({
      color: 0x334455,
      width: 1,
    });
    content.addChild(bg);

    const title = scaledText("НАСТРОЙКИ", 14, TITLE_COLOR, {
      fontWeight: "bold",
    });
    title.anchor.set(0.5, 0);
    title.x = SETTINGS_PANEL_WIDTH / 2;
    title.y = PAD;
    title.eventMode = "none";
    content.addChild(title);

    // The font control is built FIRST so its hit areas precede the others — the
    // historical ⚙-panel "first font button" contract (playtest4 A) relies on it.
    this.renderFontRow(content, PAD + 30);
    this.renderSpeedRow(content, PAD + 96);
    this.renderNeuralRow(content, PAD + 162);
  }

  /** Section label above a control row. */
  private addSectionLabel(parent: Container, text: string, y: number): void {
    const lbl = scaledText(text, 12, LABEL_COLOR);
    lbl.x = PAD;
    lbl.y = y;
    lbl.eventMode = "none";
    parent.addChild(lbl);
  }

  /** ШРИФТ: three "A" glyphs (S/M/L), the active one highlighted. */
  private renderFontRow(parent: Container, y: number): void {
    this.addSectionLabel(parent, "ШРИФТ", y);
    const rowY = y + 22;
    const rowH = 32;
    const active = getFontKey();
    FONT_KEYS.forEach((key, i) => {
      const x = PAD + i * (TRIO_BTN_W + BTN_GAP);
      this.addCellButton(
        parent,
        x,
        rowY,
        TRIO_BTN_W,
        rowH,
        "A",
        FONT_GLYPH_PX[key],
        key === active,
        () => this.selectFont(key),
      );
    });
  }

  /** СКОРОСТЬ: the speed steps (1×/2×/4×), the active one highlighted. */
  private renderSpeedRow(parent: Container, y: number): void {
    this.addSectionLabel(parent, "СКОРОСТЬ", y);
    const rowY = y + 22;
    const rowH = 30;
    const current = getSpeed(this.deps.speedTarget);
    const steps = this.deps.speedSteps;
    const w = (ROW_W - BTN_GAP * (steps.length - 1)) / steps.length;
    steps.forEach((scale, i) => {
      const x = PAD + i * (w + BTN_GAP);
      this.addCellButton(
        parent,
        x,
        rowY,
        w,
        rowH,
        `${scale}×`,
        13,
        scale === current,
        () => this.selectSpeed(scale),
      );
    });
  }

  /** НЕЙРОСЕТЬ (ИИ): a full-width ВКЛ/ВЫКЛ toggle + an "experimental" hint. */
  private renderNeuralRow(parent: Container, y: number): void {
    this.addSectionLabel(parent, "НЕЙРОСЕТЬ (ИИ)", y);
    const rowY = y + 22;
    const rowH = 30;
    const on = this.isNeuralOn();
    this.addCellButton(
      parent,
      PAD,
      rowY,
      ROW_W,
      rowH,
      on ? "ВКЛ" : "ВЫКЛ",
      14,
      on,
      () => this.toggleNeural(),
      on ? ON_COLOR : OFF_COLOR,
    );

    const hint = scaledText("экспериментально", 10, HINT_COLOR);
    hint.anchor.set(0.5, 0);
    hint.x = SETTINGS_PANEL_WIDTH / 2;
    hint.y = rowY + rowH + 4;
    hint.eventMode = "none";
    parent.addChild(hint);
  }

  /**
   * A single highlightable cell button: rounded background (accent-bordered when
   * active), a centred label, and a transparent `static` hit area that runs
   * `onTap`. The label/background are `eventMode:"none"` so the hit area owns the
   * click (PixiJS-8 layered-hit pattern).
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

    // No `rawColor`: the dim idle `LABEL_COLOR` must lift to the legible floor
    // (like `addSectionLabel`); the active accent/on colors are already above
    // the floor, so `readableFill` passes them through unchanged.
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
