import { Container, Graphics, Text } from "pixi.js";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole, FactionType } from "@/types";
import { Faction } from "@/types/faction";

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
}

/**
 * Contact panel for an NPC ship in the player's system (Feature 8, slice 2).
 */
export class NpcContactPanel {
  public readonly container: Container;
  private readonly callbacks: NpcContactCallbacks;

  private static readonly W = 240;
  // Taller when in radar range: scan button + possible result area (Task 8).
  private static readonly H_IN_RANGE = 350;
  private static readonly H_OUT = 230;

  private readonly inRange: boolean;
  private readonly playerScanPower: number;
  private scanResultLabel: Text | null = null;

  constructor(
    npc: NpcShip,
    screenWidth: number,
    _screenHeight: number,
    callbacks: NpcContactCallbacks,
    inRange = true,
    playerScanPower = 0,
  ) {
    this.callbacks = callbacks;
    this.inRange = inRange;
    this.playerScanPower = playerScanPower;
    this.container = new Container();
    this.container.x = screenWidth - NpcContactPanel.W - 20;
    this.container.y = 80;
    this.render(npc);
  }

  private render(npc: NpcShip): void {
    const h = this.inRange ? NpcContactPanel.H_IN_RANGE : NpcContactPanel.H_OUT;
    const bg = new Graphics();
    bg.rect(0, 0, NpcContactPanel.W, h);
    bg.fill({ color: 0x000000, alpha: 0.85 });
    bg.stroke({ color: 0x00ffff, width: 2 });
    bg.eventMode = "static";
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
      // Within radar range: detailed scan readout, then the full action set
      // (US-070 #3 — more is known about a ship once it is on the scanner).
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

      this.addButton("Связаться", 12, 162, 0x004488, this.callbacks.onHail);
      this.addButton("Торговать", 12, 192, 0x885500, this.callbacks.onTrade);
      this.addButton("Атаковать", 12, 222, 0x880000, this.callbacks.onAttack);
      this.addButton("Сканировать", 12, 252, 0x005544, () => this.onScan(npc));
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
    label.y = 284;
    label.eventMode = "none";
    this.scanResultLabel = label;
    this.container.addChild(label);
  }

  destroy(): void {
    // Idempotent: the panel may be torn down both by a deferred close and by the
    // scene's clearUILayer(); destroying an already-destroyed container throws.
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }
}
