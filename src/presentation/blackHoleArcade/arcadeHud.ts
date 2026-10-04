import { Container, Graphics, Sprite, type Text } from "pixi.js";
import { scaledText } from "../ui/scaledText";
import { t } from "@/i18n/i18n";
import {
  ARCADE_BOMB_CAP,
  ARCADE_TOTAL_LEVELS,
  ARCADE_WEAPON_MAX_LEVEL,
} from "@/systems/blackHoleArcade/arcadeConfig";
import type { ArcadeRunState } from "@/systems/blackHoleArcade/arcadeTypes";
import { ARCADE_WEAPONS } from "@/systems/blackHoleArcade/arcadeWeapons";
import type { ArcadeArt } from "./arcadeArt";

export interface HudLayout {
  mode: "side" | "top";
  width: number;
  height: number;
  fieldX: number;
  fieldY: number;
  fieldW: number;
  fieldH: number;
}

export interface HudExtra {
  autoFire: boolean;
  levelProgress: number;
  rewardNow: number;
  practice: boolean;
  difficulty: number;
  soundOn: boolean;
}

const TEXT = 0xe4def7;
const DIM = 0x9188b4;
const ACCENT = 0xffd166;
const BAR_BACK = 0x1a1530;
const HULL_OK = 0x4ade80;
const HULL_WARN = 0xfbbf24;
const HULL_LOW = 0xf87171;
const SHIELD = 0x59c8ff;

export class ArcadeHud {
  readonly root = new Container();
  private gfx = new Graphics();
  private levelText: Text;
  private scoreText: Text;
  private rewardText: Text;
  private autoText: Text;
  private difficultyText: Text;
  private soundText: Text;
  private hullLabel: Text;
  private hullNum: Text;
  private shieldLabel: Text;
  private shieldNum: Text;
  private armorText: Text;
  private bombLabel: Text;
  private weaponLabel: Text;
  private weaponName: Text;
  private dronesText: Text;
  private magnetText: Text;
  private weaponIcon: Sprite;
  private bombIcons: Sprite[] = [];
  private layoutState: HudLayout | null = null;
  private lastKey = "";
  private lastStrings = new Map<Text, string>();

  constructor(private readonly art: ArcadeArt) {
    this.root.addChild(this.gfx);
    const mk = (size: number, color: number, bold = false): Text => {
      const text = scaledText("", size, color, {
        rawColor: true,
        ...(bold ? { fontWeight: "bold" as const } : {}),
      });
      text.eventMode = "none";
      this.root.addChild(text);
      return text;
    };
    this.levelText = mk(22, ACCENT, true);
    this.scoreText = mk(15, TEXT);
    this.rewardText = mk(15, TEXT);
    this.autoText = mk(12, DIM);
    this.difficultyText = mk(12, DIM);
    this.soundText = mk(13, TEXT, true);
    this.hullLabel = mk(12, DIM, true);
    this.hullNum = mk(14, TEXT);
    this.shieldLabel = mk(12, DIM, true);
    this.shieldNum = mk(14, TEXT);
    this.armorText = mk(14, TEXT);
    this.bombLabel = mk(12, DIM, true);
    this.weaponLabel = mk(12, DIM, true);
    this.weaponName = mk(15, TEXT, true);
    this.dronesText = mk(14, TEXT);
    this.magnetText = mk(14, ACCENT);

    this.weaponIcon = new Sprite(art.pickups.weapon_vulcan);
    this.weaponIcon.anchor.set(0.5);
    this.weaponIcon.width = this.weaponIcon.height = 42;
    this.root.addChild(this.weaponIcon);
    for (let i = 0; i < ARCADE_BOMB_CAP; i++) {
      const icon = new Sprite(art.pickups.bomb);
      icon.anchor.set(0.5);
      icon.width = icon.height = 32;
      this.bombIcons.push(icon);
      this.root.addChild(icon);
    }
    this.hullLabel.text = t("arcade.hud.hull");
    this.shieldLabel.text = t("arcade.hud.shield");
    this.bombLabel.text = t("arcade.hud.bombs");
    this.weaponLabel.text = t("arcade.hud.weapon");
  }

  layout(layout: HudLayout): void {
    this.layoutState = layout;
    this.lastKey = "";
  }

  private setText(text: Text, value: string): void {
    if (this.lastStrings.get(text) === value) return;
    this.lastStrings.set(text, value);
    text.text = value;
  }

  private place(text: Text, x: number, y: number): void {
    text.x = x;
    text.y = y;
  }

  update(state: ArcadeRunState, extra: HudExtra): void {
    const layout = this.layoutState;
    if (!layout) return;
    const p = state.player;

    this.setText(
      this.levelText,
      t("arcade.hud.level", { n: state.level, total: ARCADE_TOTAL_LEVELS }),
    );
    this.setText(this.scoreText, t("arcade.hud.score", { n: state.score }));
    this.setText(
      this.rewardText,
      extra.practice
        ? t("arcade.hud.practice")
        : t("arcade.hud.reward", { n: extra.rewardNow }),
    );
    this.setText(
      this.autoText,
      t("arcade.hud.autofire", {
        state: t(extra.autoFire ? "arcade.on" : "arcade.off"),
      }),
    );
    this.setText(
      this.difficultyText,
      t("arcade.hud.difficulty", { n: extra.difficulty.toFixed(2) }),
    );
    this.setText(
      this.soundText,
      t("arcade.hud.sound", {
        state: t(extra.soundOn ? "arcade.on" : "arcade.off"),
      }),
    );
    this.setText(this.hullNum, `${Math.ceil(p.hull)} / ${p.maxHull}`);
    this.setText(
      this.shieldNum,
      p.shieldMax > 0 ? `${Math.ceil(p.shield)} / ${p.shieldMax}` : "—",
    );
    this.setText(
      this.armorText,
      t("arcade.hud.armor", { n: Math.round(p.armor * 100) }),
    );
    this.setText(
      this.weaponName,
      `${t(`arcade.weapon.${p.weapon}`)}  ${p.weaponLevel}/${ARCADE_WEAPON_MAX_LEVEL}`,
    );
    this.setText(this.dronesText, t("arcade.hud.drones", { n: p.drones }));
    this.setText(
      this.magnetText,
      p.magnetMs > 0
        ? t("arcade.hud.magnet", { n: Math.ceil(p.magnetMs / 1000) })
        : "",
    );

    const weaponTex =
      this.art.pickups[`weapon_${p.weapon}` as keyof typeof this.art.pickups];
    if (this.weaponIcon.texture !== weaponTex)
      this.weaponIcon.texture = weaponTex;
    this.weaponIcon.width = this.weaponIcon.height = 42;
    this.bombIcons.forEach((icon, i) => {
      icon.visible = i < p.bombs;
    });

    const key = [
      layout.mode,
      layout.width,
      layout.height,
      Math.ceil(p.hull),
      p.maxHull,
      Math.ceil(p.shield),
      p.shieldMax,
      p.weapon,
      p.weaponLevel,
      Math.round(extra.levelProgress * 100),
    ].join("|");
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.arrange(layout, state, extra);
    }
  }

  private bar(
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    color: number,
  ): void {
    this.gfx.roundRect(x, y, w, h, 3).fill({ color: BAR_BACK });
    const filled = Math.max(0, Math.min(1, ratio)) * (w - 2);
    if (filled > 0) {
      this.gfx.roundRect(x + 1, y + 1, filled, h - 2, 2).fill({ color });
    }
    this.gfx.roundRect(x, y, w, h, 3).stroke({ color: 0x4a4070, width: 1 });
  }

  private pips(x: number, y: number, level: number, color: number): void {
    for (let i = 0; i < ARCADE_WEAPON_MAX_LEVEL; i++) {
      this.gfx
        .roundRect(x + i * 20, y, 16, 7, 2)
        .fill({ color: i < level ? color : BAR_BACK });
    }
  }

  private arrange(
    layout: HudLayout,
    state: ArcadeRunState,
    extra: HudExtra,
  ): void {
    const p = state.player;
    const g = this.gfx;
    g.clear();
    const hullRatio = p.hull / p.maxHull;
    const hullColor =
      hullRatio > 0.5 ? HULL_OK : hullRatio > 0.25 ? HULL_WARN : HULL_LOW;
    const weaponColor = ARCADE_WEAPONS[p.weapon].color;

    if (layout.mode === "side") {
      const pad = 18;
      const leftW = Math.max(120, layout.fieldX - pad * 2);
      const rx = layout.fieldX + layout.fieldW + pad;
      const rightW = Math.max(120, layout.width - rx - pad);

      this.place(this.levelText, pad, 22);
      this.bar(pad, 62, leftW, 8, extra.levelProgress, ACCENT);
      this.place(this.scoreText, pad, 84);
      this.place(this.rewardText, pad, 108);
      this.place(this.autoText, pad, 140);
      this.place(this.difficultyText, pad, 160);
      this.place(this.soundText, pad, 186);

      this.place(this.hullLabel, rx, 22);
      this.place(this.hullNum, rx + rightW - this.hullNum.width, 20);
      this.bar(rx, 42, rightW, 14, hullRatio, hullColor);
      this.place(this.shieldLabel, rx, 70);
      this.place(this.shieldNum, rx + rightW - this.shieldNum.width, 68);
      this.bar(
        rx,
        90,
        rightW,
        14,
        p.shieldMax > 0 ? p.shield / p.shieldMax : 0,
        SHIELD,
      );
      this.place(this.armorText, rx, 118);
      this.place(this.dronesText, rx, 142);
      this.place(this.magnetText, rx, 166);

      this.place(this.bombLabel, rx, 204);
      this.bombIcons.forEach((icon, i) => {
        icon.x = rx + 16 + i * 36;
        icon.y = 240;
      });

      this.place(this.weaponLabel, rx, 280);
      this.weaponIcon.x = rx + 22;
      this.weaponIcon.y = 322;
      this.place(this.weaponName, rx + 54, 304);
      this.pips(rx + 54, 332, p.weaponLevel, weaponColor);
    } else {
      const pad = 8;
      const w = layout.width;
      const half = (w - pad * 3) / 2;
      const right = (text: Text, y: number): void =>
        this.place(text, w - pad - text.width, y);

      this.place(this.levelText, pad, 1);
      right(this.rewardText, 6);

      this.bar(pad, 30, half, 17, hullRatio, hullColor);
      this.bar(
        pad * 2 + half,
        30,
        half,
        17,
        p.shieldMax > 0 ? p.shield / p.shieldMax : 0,
        SHIELD,
      );
      this.place(this.hullLabel, -999, -999);
      this.place(this.shieldLabel, -999, -999);
      this.place(this.hullNum, pad + 5, 30);
      this.place(this.shieldNum, pad * 2 + half + 5, 30);

      this.weaponIcon.x = pad + 12;
      this.weaponIcon.y = 59;
      this.weaponIcon.width = this.weaponIcon.height = 26;
      this.place(this.weaponName, pad + 30, 50);
      this.place(this.weaponLabel, -999, -999);
      this.place(this.bombLabel, -999, -999);
      this.bombIcons.forEach((icon, i) => {
        icon.x = w * 0.58 + i * 19;
        icon.y = 59;
        icon.width = icon.height = 22;
      });
      right(this.armorText, 52);
      this.place(this.dronesText, -999, -999);
      this.place(this.magnetText, -999, -999);
      this.place(this.autoText, -999, -999);
      this.place(this.difficultyText, -999, -999);
      this.place(this.soundText, -999, -999);
      this.place(this.scoreText, -999, -999);
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.lastStrings.clear();
  }
}
