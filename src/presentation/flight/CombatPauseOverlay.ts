import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { scaledFont } from "@/utils/fontScale";
import { UiButton } from "../ui/UiButton";
import type { PauseReason } from "./combatPause";

export interface PauseTargetOption<TTarget> {
  readonly value: TTarget;
  readonly label: string;
  readonly hpFraction: number;
}

export interface PauseWeaponOption<TWeapon> {
  readonly value: TWeapon;
  readonly label: string;
}

export interface CombatPauseOverlayDeps {
  getScreenSize(): { width: number; height: number };
}

export interface CombatPauseOverlayCallbacks<TTarget, TWeapon> {
  onSelectTarget(target: TTarget): void;
  onSelectWeapon(weapon: TWeapon): void;
  onConfirm(): void;
  onResume(): void;
}

const PANEL_W = 360;
const PANEL_BG = 0x0a1018;
const PANEL_BORDER = 0x00ffee;
const TITLE_COLOR = 0xffe066;
const SECTION_COLOR = 0xb4b4b4;
const MSG_COLOR = 0xff6644;

const SELECTED = 0x44ff88; // success — the chosen row
const TARGET_IDLE = 0xff5555; // danger — an unselected enemy
const WEAPON_IDLE = 0x00ffee; // primary — an unselected weapon

const PAD = 16;
const ROW_H = 30;
const ROW_GAP = 6;
const SECTION_GAP = 10;
const ROW_W = PANEL_W - PAD * 2;

export class CombatPauseOverlay<TTarget, TWeapon> {
  private readonly uiLayer: Container;
  private readonly deps: CombatPauseOverlayDeps;
  private readonly callbacks: CombatPauseOverlayCallbacks<TTarget, TWeapon>;

  private root: Container | null = null;
  private panel: Container | null = null;

  private readonly targetRows: { value: TTarget; button: UiButton }[] = [];
  private readonly weaponRows: { value: TWeapon; button: UiButton }[] = [];

  private selectedTarget: TTarget | null = null;
  private selectedWeapon: TWeapon | null = null;

  constructor(
    uiLayer: Container,
    deps: CombatPauseOverlayDeps,
    callbacks: CombatPauseOverlayCallbacks<TTarget, TWeapon>,
  ) {
    this.uiLayer = uiLayer;
    this.deps = deps;
    this.callbacks = callbacks;
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(args: {
    reason: PauseReason;
    targets: readonly PauseTargetOption<TTarget>[];
    weapons: readonly PauseWeaponOption<TWeapon>[];
    selectedTarget: TTarget | null;
    selectedWeapon: TWeapon | null;
  }): void {
    this.close();
    this.selectedTarget = args.selectedTarget;
    this.selectedWeapon = args.selectedWeapon;

    const root = new Container();
    root.label = "combat-pause-overlay"; // e2e/observability handle
    this.uiLayer.addChild(root);
    this.root = root;

    const scrim = new Graphics();
    const { width, height } = this.deps.getScreenSize();
    scrim.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.55 });
    scrim.eventMode = "static";
    scrim.hitArea = new Rectangle(0, 0, width, height);
    scrim.on("pointerdown", (e) => e.stopPropagation());
    root.addChild(scrim);

    const panel = new Container();
    root.addChild(panel);
    this.panel = panel;

    let y = PAD;
    y = this.addTitle(panel, args.reason, y);

    const hasWeapons = args.weapons.length > 0;
    const hasTargets = args.targets.length > 0;

    if (hasTargets) {
      y = this.addSectionLabel(panel, "ЦЕЛЬ:", y);
      y = this.addTargetRows(panel, args.targets, y);
    } else {
      y = this.addMessage(panel, "Нет целей", y);
    }

    if (hasWeapons) {
      y += SECTION_GAP;
      y = this.addSectionLabel(panel, "ОРУЖИЕ:", y);
      y = this.addWeaponRows(panel, args.weapons, y);
    } else {
      y += SECTION_GAP;
      y = this.addMessage(panel, "Нет оружия — отступайте!", y);
    }

    y += SECTION_GAP;
    y = this.addActions(panel, hasTargets && hasWeapons, y);

    this.drawPanelBg(panel, y + PAD);
    this.positionPanel(y + PAD);
    this.applyHighlight();
  }

  setSelection(target: TTarget | null, weapon: TWeapon | null): void {
    this.selectedTarget = target;
    this.selectedWeapon = weapon;
    this.applyHighlight();
  }

  close(): void {
    this.targetRows.length = 0;
    this.weaponRows.length = 0;
    this.selectedTarget = null;
    this.selectedWeapon = null;
    this.panel = null;
    if (this.root && !this.root.destroyed) {
      this.root.destroy({ children: true });
    }
    this.root = null;
  }

  private addTitle(panel: Container, reason: PauseReason, y: number): number {
    const text =
      reason === "target-lost"
        ? "Цель потеряна — выберите новую"
        : "⚠ Под обстрелом!";
    const title = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(16),
        fill: TITLE_COLOR,
        fontWeight: "bold",
      },
    });
    title.x = PAD;
    title.y = y;
    title.eventMode = "none";
    panel.addChild(title);
    return y + title.height + SECTION_GAP;
  }

  private addSectionLabel(panel: Container, text: string, y: number): number {
    const label = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(12),
        fill: SECTION_COLOR,
      },
    });
    label.x = PAD;
    label.y = y;
    label.eventMode = "none";
    panel.addChild(label);
    return y + label.height + ROW_GAP;
  }

  private addMessage(panel: Container, text: string, y: number): number {
    const msg = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: MSG_COLOR,
        fontWeight: "bold",
      },
    });
    msg.x = PAD;
    msg.y = y;
    msg.eventMode = "none";
    panel.addChild(msg);
    return y + msg.height + ROW_GAP;
  }

  private addTargetRows(
    panel: Container,
    targets: readonly PauseTargetOption<TTarget>[],
    y: number,
  ): number {
    for (const opt of targets) {
      const pct = Math.round(Math.max(0, Math.min(1, opt.hpFraction)) * 100);
      const btn = new UiButton(
        "",
        `${opt.label}  (${pct}%)`,
        TARGET_IDLE,
        (e) => {
          e.stopPropagation();
          this.callbacks.onSelectTarget(opt.value);
        },
        ROW_W,
        ROW_H,
      );
      btn.x = PAD;
      btn.y = y;
      panel.addChild(btn.container);
      this.targetRows.push({ value: opt.value, button: btn });
      y += ROW_H + ROW_GAP;
    }
    return y;
  }

  private addWeaponRows(
    panel: Container,
    weapons: readonly PauseWeaponOption<TWeapon>[],
    y: number,
  ): number {
    let i = 0;
    for (const opt of weapons) {
      const btn = new UiButton(
        "",
        opt.label,
        WEAPON_IDLE,
        (e) => {
          e.stopPropagation();
          this.callbacks.onSelectWeapon(opt.value);
        },
        ROW_W,
        ROW_H,
      );
      btn.container.label = `cp-weapon-${i++}`; // e2e handle
      btn.x = PAD;
      btn.y = y;
      panel.addChild(btn.container);
      this.weaponRows.push({ value: opt.value, button: btn });
      y += ROW_H + ROW_GAP;
    }
    return y;
  }

  private addActions(panel: Container, canFire: boolean, y: number): number {
    const half = (ROW_W - ROW_GAP) / 2;
    if (canFire) {
      const fire = new UiButton(
        "🔥",
        "Огонь!",
        "success",
        (e) => {
          e.stopPropagation();
          this.callbacks.onConfirm();
        },
        half,
        ROW_H + 4,
      );
      fire.container.label = "cp-fire"; // e2e handle
      fire.x = PAD;
      fire.y = y;
      panel.addChild(fire.container);

      const resume = new UiButton(
        "▶",
        "Продолжить",
        "neutral",
        (e) => {
          e.stopPropagation();
          this.callbacks.onResume();
        },
        half,
        ROW_H + 4,
      );
      resume.x = PAD + half + ROW_GAP;
      resume.y = y;
      panel.addChild(resume.container);
    } else {
      const resume = new UiButton(
        "▶",
        "Продолжить",
        "neutral",
        (e) => {
          e.stopPropagation();
          this.callbacks.onResume();
        },
        ROW_W,
        ROW_H + 4,
      );
      resume.x = PAD;
      resume.y = y;
      panel.addChild(resume.container);
    }
    return y + ROW_H + 4;
  }

  private applyHighlight(): void {
    for (const row of this.targetRows) {
      row.button.setAccentColor(
        row.value === this.selectedTarget ? SELECTED : TARGET_IDLE,
      );
    }
    for (const row of this.weaponRows) {
      row.button.setAccentColor(
        row.value === this.selectedWeapon ? SELECTED : WEAPON_IDLE,
      );
    }
  }

  private drawPanelBg(panel: Container, panelH: number): void {
    const bg = new Graphics();
    bg.roundRect(0, 0, PANEL_W, panelH, 8).fill({
      color: PANEL_BG,
      alpha: 0.95,
    });
    bg.roundRect(0, 0, PANEL_W, panelH, 8).stroke({
      color: PANEL_BORDER,
      width: 2,
    });
    bg.eventMode = "static"; // swallow clicks on the panel chrome
    bg.on("pointerdown", (e) => e.stopPropagation());
    panel.addChildAt(bg, 0); // behind the content laid out above
  }

  private positionPanel(panelH: number): void {
    if (!this.panel) return;
    const { width, height } = this.deps.getScreenSize();
    this.panel.x = Math.round((width - PANEL_W) / 2);
    this.panel.y = Math.max(20, Math.round((height - panelH) / 2));
  }
}
