import type { Container } from "pixi.js";
import { t } from "@/i18n/i18n";
import {
  isAutoCombatEnabled,
  setAutoCombatEnabled,
} from "@/systems/settings/gameSettings";
import { currentFontScale } from "@/utils/fontScale";
import { UiButton } from "../ui/UiButton";

const BTN_W = 170;
const BTN_H = 26;
const PANEL_W = 240;
const PANEL_H = 60;
const PANEL_MARGIN = 20;

export interface CombatAutoToggleDeps {
  getUiLayer(): Container;
  getScreenSize(): { width: number; height: number };
  onToggle?(on: boolean): void;
}

export function autoCombatLabel(): string {
  return isAutoCombatEnabled() ? t("combat.auto.on") : t("combat.auto.off");
}

export class CombatAutoToggle {
  private readonly deps: CombatAutoToggleDeps;
  private button: UiButton | null = null;

  constructor(deps: CombatAutoToggleDeps) {
    this.deps = deps;
  }

  get mounted(): boolean {
    return this.button !== null;
  }

  sync(combatActive: boolean): void {
    if (combatActive && !this.button) this.mount();
    else if (!combatActive && this.button) this.unmount();
  }

  toggle(): void {
    const next = !isAutoCombatEnabled();
    setAutoCombatEnabled(next);
    this.button?.setLabel(autoCombatLabel());
    this.deps.onToggle?.(next);
  }

  destroy(): void {
    this.unmount();
  }

  private mount(): void {
    const { width } = this.deps.getScreenSize();
    const scale = currentFontScale();
    const button = new UiButton(
      "⚔",
      autoCombatLabel(),
      0x66ccff,
      () => this.toggle(),
      Math.round(BTN_W * scale),
      Math.round(BTN_H * scale),
    );
    button.container.label = "combat-auto-toggle";
    button.x = Math.max(20, width - PANEL_W - PANEL_MARGIN);
    button.y = PANEL_MARGIN + PANEL_H + 8;
    this.deps.getUiLayer().addChild(button.container);
    this.button = button;
  }

  private unmount(): void {
    if (!this.button) return;
    this.button.container.parent?.removeChild(this.button.container);
    this.button.container.destroy({ children: true });
    this.button = null;
  }
}
