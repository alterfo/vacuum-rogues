import { Container, Graphics, Text } from "pixi.js";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import {
  commsContextFor,
  commsOptionsFor,
  type CommsContext,
  type CommsOption,
} from "@/systems/comms/commsOptions";
import { bindModalKeys } from "./ui/bindModalKeys";

/** Button label per context-driven comms option (universal hail window). */
const OPTION_LABELS: Record<CommsOption, string> = {
  trade: "Торговать",
  hire: "Нанять",
  ally: "Союз",
  attack: "Атаковать",
  "pay-tribute": "Откупиться",
  flee: "Бежать",
};

/** Button colour per comms option. */
const OPTION_COLORS: Record<CommsOption, number> = {
  trade: 0x885500,
  hire: 0x556600,
  ally: 0x336688,
  attack: 0x880000,
  "pay-tribute": 0x886600,
  flee: 0x444466,
};

const FACTION_TYPE_LABELS: Record<FactionType, string> = {
  [FactionType.OUTLANDERS]: "Окраинник",
  [FactionType.BASTIONS]: "Бастион",
  [FactionType.SYNDICATE]: "Синдикат",
  [FactionType.PARADOXES]: "Парадокс",
  [FactionType.PROGRESSORS]: "Прогрессор",
};

const FACTION_LABELS: Record<Faction, string> = {
  [Faction.OUTLANDERS]: "Окраинники",
  [Faction.BASTIONS]: "Бастионы",
  [Faction.SYNDICATE]: "Синдикат",
  [Faction.PARADOXES]: "Парадоксы",
  [Faction.PROGRESSORS]: "Прогрессоры",
  [Faction.INDEPENDENT]: "Независимые",
  [Faction.OVERMIND]: "Предтечи",
};

const ROLE_LABELS: Record<NpcRole, string> = {
  [NpcRole.RANGER]: "Рейнджер",
  [NpcRole.TRADER]: "Торговец",
  [NpcRole.PIRATE]: "Пират",
  [NpcRole.PATROL]: "Патруль",
};

export interface NpcContactCallbacks {
  onHail: () => void;
  onTrade: () => void;
  onAttack: () => void;
  onApproach: () => void;
  onClose: () => void;
  /** Context-driven options of the universal hail; wired by later tasks. A
   *  comms option only renders a button once its handler is supplied. */
  onHire?: () => void;
  onAlly?: () => void;
  onPayTribute?: () => void;
  onFlee?: () => void;
}

/**
 * Contact panel for an NPC ship in the player's system (Feature 8, slice 2).
 */
export class NpcContactPanel {
  public readonly container: Container;
  private readonly callbacks: NpcContactCallbacks;

  private static readonly W = 240;
  // First action button sits below the stat readout; the panel grows to fit the
  // number of context-driven buttons it actually renders.
  private static readonly BTN_TOP = 162;
  private static readonly BTN_STEP = 30;
  private static readonly H_OUT = 230;

  private readonly inRange: boolean;
  private readonly playerScanPower: number;
  private readonly context: CommsContext;
  private scanResultLabel: Text | null = null;
  // Y where the scan readout is mounted — set after buttons so it never overlaps.
  private scanResultY = 284;
  // Esc closes the hail window via the shared modal-key convention. This is a
  // multi-button panel (the helper is intentionally not for multi-button forms),
  // so it wires only Esc→close — there is no single Enter primary among
  // talk/trade/attack/scan. Detached in destroy() so the listener never leaks.
  private readonly detachKeys: () => void;

  constructor(
    npc: NpcShip,
    screenWidth: number,
    _screenHeight: number,
    callbacks: NpcContactCallbacks,
    inRange = true,
    playerScanPower = 0,
    context: CommsContext = commsContextFor(npc),
  ) {
    this.callbacks = callbacks;
    this.inRange = inRange;
    this.playerScanPower = playerScanPower;
    this.context = context;
    this.container = new Container();
    this.container.x = screenWidth - NpcContactPanel.W - 20;
    this.container.y = 80;
    this.render(npc);
    this.detachKeys = bindModalKeys({
      onCancel: () => this.callbacks.onClose(),
    });
  }

  /**
   * Map a comms option to its wired callback (if any). An option without a
   * handler is simply not rendered — this is how later tasks (hire/ally/tribute/
   * flee) light up their buttons additively without changing this renderer.
   */
  private optionHandler(opt: CommsOption): (() => void) | undefined {
    switch (opt) {
      case "trade":
        return this.callbacks.onTrade;
      case "attack":
        return this.callbacks.onAttack;
      case "hire":
        return this.callbacks.onHire;
      case "ally":
        return this.callbacks.onAlly;
      case "pay-tribute":
        return this.callbacks.onPayTribute;
      case "flee":
        return this.callbacks.onFlee;
    }
  }

  /**
   * Build the in-range action button set for this hail: talk/scan standing
   * affordances bracketing the context-driven {@link commsOptionsFor} options.
   * An option whose handler is not yet wired is silently skipped, so the neutral
   * panel renders the familiar Связаться/Торговать/Атаковать/Сканировать set.
   */
  private buildActionButtons(
    npc: NpcShip,
  ): { label: string; color: number; onClick: () => void }[] {
    const out: { label: string; color: number; onClick: () => void }[] = [];
    // Talk + scan frame a normal hail; a forced pirate shakedown or a futile
    // Overmind hail (gibberish — Task 5) drops them.
    const showStanding =
      this.context !== "pirate-shakedown" && this.context !== "overmind";
    if (showStanding) {
      out.push({
        label: "Связаться",
        color: 0x004488,
        onClick: this.callbacks.onHail,
      });
    }
    let hasAttack = false;
    for (const opt of commsOptionsFor(npc, this.context)) {
      const onClick = this.optionHandler(opt);
      if (!onClick) continue;
      if (opt === "attack") hasAttack = true;
      out.push({
        label: OPTION_LABELS[opt],
        color: OPTION_COLORS[opt],
        onClick,
      });
    }
    // A hostile or Overmind contact must always expose "Атаковать" in range: the
    // Overmind answers a hail with gibberish ({@link commsOptionsFor} → []), which
    // would otherwise strip the only meaningful action and leave an enemy that can
    // never be engaged. The neutral panel already lists attack via commsOptionsFor
    // (so it is untouched), and a hostile-other / pirate-shakedown context already
    // carries it — the guard only adds the missing button for the Overmind.
    const hostileContact =
      this.context === "overmind" ||
      this.context === "hostile-other" ||
      this.context === "pirate-shakedown";
    if (hostileContact && !hasAttack) {
      out.push({
        label: OPTION_LABELS.attack,
        color: OPTION_COLORS.attack,
        onClick: this.callbacks.onAttack,
      });
    }
    if (showStanding) {
      out.push({
        label: "Сканировать",
        color: 0x005544,
        onClick: () => this.onScan(npc),
      });
    }
    return out;
  }

  private render(npc: NpcShip): void {
    // Compute the in-range action buttons first so the panel can size itself to
    // the number it actually renders (the universal hail varies by context).
    const buttons = this.inRange ? this.buildActionButtons(npc) : [];
    const h = this.inRange
      ? NpcContactPanel.BTN_TOP + buttons.length * NpcContactPanel.BTN_STEP + 70
      : NpcContactPanel.H_OUT;
    const bg = new Graphics();
    bg.rect(0, 0, NpcContactPanel.W, h);
    bg.fill({ color: 0x000000, alpha: 0.85 });
    bg.stroke({ color: 0x00ffff, width: 2 });
    bg.eventMode = "static";
    bg.on("pointerdown", (e) => e.stopPropagation());
    this.container.addChild(bg);

    // Truncate long names so they never run under the corner ✕.
    const name = npc.name.length > 20 ? npc.name.slice(0, 19) + "…" : npc.name;
    this.addLabel(name, 12, 12, 14, 0x00ffff, true);
    this.addLabel(
      `Фракция: ${FACTION_TYPE_LABELS[npc.race] ?? npc.race}`,
      12,
      40,
      12,
      0xcccccc,
    );
    this.addLabel(
      `Альянс: ${FACTION_LABELS[npc.faction] ?? npc.faction}`,
      12,
      60,
      12,
      0xcccccc,
    );
    this.addLabel(
      `Роль: ${ROLE_LABELS[npc.role] ?? npc.role}`,
      12,
      80,
      12,
      0xcccccc,
    );
    this.addLabel(
      `Корпус: ${Math.round(npc.hullHP)} / ${Math.round(npc.maxHull)}`,
      12,
      100,
      12,
      0xff8866,
    );

    if (this.inRange) {
      // Within radar range: detailed scan readout, then the context-driven action
      // set (US-070 #3 — more is known about a ship once it is on the scanner).
      this.addLabel(`Щиты: ${Math.round(npc.shields)}`, 12, 120, 12, 0x66ccff);
      this.addLabel(`Урон: ${Math.round(npc.damage)}`, 130, 120, 12, 0xffaa66);
      this.addLabel(`Скорость: ${npc.speed.toFixed(2)}`, 12, 138, 12, 0xcccccc);
      this.addLabel(
        `Кредиты: ${Math.round(npc.credits)}`,
        130,
        138,
        12,
        0xffee88,
      );

      let y = NpcContactPanel.BTN_TOP;
      for (const b of buttons) {
        this.addButton(b.label, 12, y, b.color, b.onClick);
        y += NpcContactPanel.BTN_STEP;
      }
      this.scanResultY = y + 4;
    } else {
      // Beyond radar range (US-070 #3): no hail/trade — the ship can only close
      // the distance to firing range, after which the panel offers them. Attack
      // is still allowed (the ship auto-closes and opens fire).
      this.addLabel("Цель вне зоны радара", 12, 128, 12, 0xffaa00);
      this.addButton(
        "Приблизиться",
        12,
        152,
        0x004488,
        this.callbacks.onApproach,
      );
      this.addButton("Атаковать", 12, 188, 0x880000, this.callbacks.onAttack);
    }

    // Close via the corner "✕" (or by clicking outside the panel — handled by
    // the scene). A full-width button used to overflow the frame.
    this.addCloseX();
  }

  /** Small "✕" close affordance (with its own backing) in the top-right corner. */
  private addCloseX(): void {
    // Dark backing so the ✕ stays legible over the title/name text.
    const bg = new Graphics();
    bg.roundRect(NpcContactPanel.W - 28, 6, 22, 22, 4);
    bg.fill({ color: 0x000000, alpha: 0.85 });
    bg.stroke({ color: 0xff6666, width: 1 });
    bg.eventMode = "static";
    bg.cursor = "pointer";
    bg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.callbacks.onClose();
    });
    this.container.addChild(bg);

    const x = new Text({
      text: "✕",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xff6666,
        fontWeight: "bold",
      },
    });
    x.x = NpcContactPanel.W - 22;
    x.y = 8;
    x.eventMode = "static";
    x.cursor = "pointer";
    x.on("pointerdown", (e) => {
      e.stopPropagation();
      this.callbacks.onClose();
    });
    x.on("pointerover", () => {
      x.alpha = 0.7;
    });
    x.on("pointerout", () => {
      x.alpha = 1;
    });
    this.container.addChild(x);
  }

  private addLabel(
    text: string,
    x: number,
    y: number,
    size: number,
    color: number,
    bold = false,
  ): void {
    const t = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: size,
        fill: color,
        fontWeight: bold ? "bold" : "normal",
      },
    });
    t.x = x;
    t.y = y;
    t.eventMode = "none";
    this.container.addChild(t);
  }

  private addButton(
    label: string,
    x: number,
    y: number,
    color: number,
    onClick: () => void,
  ): void {
    const w = 116;
    const h = 24;
    const btn = new Graphics();
    btn.rect(0, 0, w, h);
    btn.fill({ color });
    btn.stroke({ color: 0x00ffff, width: 1 });
    btn.x = x;
    btn.y = y;
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      onClick();
    });

    const t = new Text({
      text: label,
      style: { fontFamily: "Courier New", fontSize: 12, fill: 0xffffff },
    });
    t.x = x + (w - t.width) / 2;
    t.y = y + (h - t.height) / 2;
    t.eventMode = "none";

    this.container.addChild(btn);
    this.container.addChild(t);
  }

  /** Handle the "Сканировать" button: compare scan power vs NPC shield power. */
  private onScan(npc: NpcShip): void {
    if (this.scanResultLabel) {
      this.container.removeChild(this.scanResultLabel);
      this.scanResultLabel.destroy();
      this.scanResultLabel = null;
    }

    let resultText: string;
    if (this.playerScanPower > npc.shieldPower) {
      const items = npc.loadoutSummary.length
        ? npc.loadoutSummary.join(", ")
        : "Данные недоступны";
      resultText = `Снаряжение:\n${items}`;
      if (npc.cargo && npc.cargo.length > 0) {
        const cargoText = npc.cargo
          .map((c) => `${c.goodId} ×${c.qty}`)
          .join(", ");
        resultText += `\nГруз: ${cargoText}`;
      }
    } else {
      resultText = "Цель защищена полем —\nсканирование невозможно";
    }

    const label = new Text({
      text: resultText,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: this.playerScanPower > npc.shieldPower ? 0x88ffcc : 0xff8844,
        wordWrap: true,
        wordWrapWidth: NpcContactPanel.W - 24,
      },
    });
    label.x = 12;
    label.y = this.scanResultY;
    label.eventMode = "none";
    this.scanResultLabel = label;
    this.container.addChild(label);
  }

  destroy(): void {
    // Detach the Esc listener first (idempotent) so it can't outlive the panel.
    this.detachKeys();
    // Idempotent: the panel may be torn down both by a deferred close and by the
    // scene's clearUILayer(); destroying an already-destroyed container throws.
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }
}
