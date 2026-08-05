import { Container, Graphics } from "pixi.js";
import { scaledText } from "./scaledText";
import { getLanguage, setLanguage, t, type Language } from "@/i18n/i18n";
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

export interface SettingsPanelDeps {
  speedTarget: SpeedTarget;
  speedSteps: readonly number[];
  applySpeed: (scale: number) => void;
  applyFont: () => void;
  applyLanguage?: () => void;
  onNeuralToggle?: (on: boolean) => void;
  showNeural?: boolean;
  onRequestClose?: () => void;
  store?: SettingsStore;
}

export const SETTINGS_PANEL_WIDTH = 220;
export const SETTINGS_PANEL_HEIGHT_FULL = 320;
export const SETTINGS_PANEL_HEIGHT_COMPACT = 248;

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
const FONT_GLYPH_PX: Readonly<Record<FontSizeKey, number>> = {
  S: 12,
  M: 16,
  L: 20,
};

const LANGUAGES: readonly Language[] = ["ru", "en"];
const LANGUAGE_LABEL_KEYS: Readonly<Record<Language, string>> = {
  ru: "lang.ru",
  en: "lang.en",
};

export class SettingsPanel {
  readonly container: Container;
  private content: Container | null = null;
  private readonly showNeural: boolean;

  get heightPx(): number {
    return this.showNeural
      ? SETTINGS_PANEL_HEIGHT_FULL
      : SETTINGS_PANEL_HEIGHT_COMPACT;
  }

  constructor(private readonly deps: SettingsPanelDeps) {
    this.showNeural = deps.showNeural ?? import.meta.env.DEV;
    this.container = new Container();
    this.container.eventMode = "static";
    this.container.on("pointerdown", (e) => e.stopPropagation());
    this.render();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  selectFont(key: FontSizeKey): void {
    setFontKey(key);
    this.deps.applyFont();
    this.deps.onRequestClose?.();
  }

  selectSpeed(scale: number): void {
    setSpeed(this.deps.speedTarget, scale);
    this.deps.applySpeed(scale);
    this.render();
  }

  selectLanguage(lang: Language): void {
    setLanguage(lang);
    this.deps.applyLanguage?.();
    this.deps.onRequestClose?.();
  }

  currentLanguage(): Language {
    return getLanguage();
  }

  toggleNeural(): void {
    const next = !isNeuralEnabled(this.deps.store);
    setNeuralEnabled(next, this.deps.store);
    this.deps.onNeuralToggle?.(next);
    this.render();
  }

  isNeuralOn(): boolean {
    return isNeuralEnabled(this.deps.store);
  }

  private render(): void {
    if (this.content) this.content.destroy({ children: true });
    const content = new Container();
    this.content = content;
    this.container.addChild(content);

    const panelH = this.heightPx;
    const bg = new Graphics();
    bg.roundRect(0, 0, SETTINGS_PANEL_WIDTH, panelH, 6).fill({
      color: 0x0a1520,
      alpha: 0.94,
    });
    bg.roundRect(0, 0, SETTINGS_PANEL_WIDTH, panelH, 6).stroke({
      color: 0x334455,
      width: 1,
    });
    content.addChild(bg);

    const title = scaledText(t("settings.title"), 14, TITLE_COLOR, {
      fontWeight: "bold",
    });
    title.anchor.set(0.5, 0);
    title.x = SETTINGS_PANEL_WIDTH / 2;
    title.y = PAD;
    title.eventMode = "none";
    content.addChild(title);

    this.renderFontRow(content, PAD + 30);
    this.renderSpeedRow(content, PAD + 96);
    this.renderLanguageRow(content, PAD + 162);
    if (this.showNeural) this.renderNeuralRow(content, PAD + 228);
  }

  private addSectionLabel(parent: Container, text: string, y: number): void {
    const lbl = scaledText(text, 12, LABEL_COLOR);
    lbl.x = PAD;
    lbl.y = y;
    lbl.eventMode = "none";
    parent.addChild(lbl);
  }

  private renderFontRow(parent: Container, y: number): void {
    this.addSectionLabel(parent, t("settings.font"), y);
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

  private renderSpeedRow(parent: Container, y: number): void {
    this.addSectionLabel(parent, t("settings.speed"), y);
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

  private renderLanguageRow(parent: Container, y: number): void {
    this.addSectionLabel(parent, t("settings.language"), y);
    const rowY = y + 22;
    const rowH = 30;
    const active = this.currentLanguage();
    const w = (ROW_W - BTN_GAP * (LANGUAGES.length - 1)) / LANGUAGES.length;
    LANGUAGES.forEach((lang, i) => {
      const x = PAD + i * (w + BTN_GAP);
      this.addCellButton(
        parent,
        x,
        rowY,
        w,
        rowH,
        t(LANGUAGE_LABEL_KEYS[lang]),
        13,
        lang === active,
        () => this.selectLanguage(lang),
      );
    });
  }

  private renderNeuralRow(parent: Container, y: number): void {
    this.addSectionLabel(parent, t("settings.neuralAi"), y);
    const rowY = y + 22;
    const rowH = 30;
    const on = this.isNeuralOn();
    this.addCellButton(
      parent,
      PAD,
      rowY,
      ROW_W,
      rowH,
      on ? t("settings.on") : t("settings.off"),
      14,
      on,
      () => this.toggleNeural(),
      on ? ON_COLOR : OFF_COLOR,
    );

    const hint = scaledText(t("settings.experimental"), 10, HINT_COLOR);
    hint.anchor.set(0.5, 0);
    hint.x = SETTINGS_PANEL_WIDTH / 2;
    hint.y = rowY + rowH + 4;
    hint.eventMode = "none";
    parent.addChild(hint);
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
