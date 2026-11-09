import { Container, Graphics } from "pixi.js";
import { scaledText } from "./ui/scaledText";
import type { GameEngine } from "@/systems/GameEngine";
import {
  gearById,
  applyArtifactUpgrade,
  artifactUpgradeCost,
} from "@/systems/equipment/GearCatalog";
import { ResourceType } from "@/types";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import { logger } from "@/utils/logger";

export class ResearchUpgradePanel {
  constructor(
    private readonly engine: GameEngine,
    private readonly onBack: () => void,
    private readonly showToast: (msg: string, color: number) => void,
    private readonly addToastSlot: (
      px: number,
      py: number,
      pw: number,
      ph: number,
    ) => void,
  ) {}

  render(parent: Container, sw: number, sh: number): void {
    parent.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.buildPanel(parent, sw, sh);
  }

  private buildPanel(parent: Container, sw: number, sh: number): void {
    const bg = new Graphics();
    bg.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    parent.addChild(bg);

    const PW = Math.min(640, sw - 40);
    const PH = Math.min(580, sh - 60);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH).fill({ color: 0x08100c, alpha: 1 });
    panel.rect(PX, PY, PW, PH).stroke({ color: 0x334433, width: 1 });
    parent.addChild(panel);

    const titleText = scaledText(
      "[ ИССЛЕДОВАТЕЛЬСКАЯ ЛАБОРАТОРИЯ — УЛУЧШЕНИЕ СНАРЯЖЕНИЯ ]",
      13,
      0xcc88ff,
      { rawColor: true, fontFamily: "monospace" },
    );
    titleText.anchor.set(0.5, 0);
    titleText.x = PX + PW / 2;
    titleText.y = PY + 12;
    titleText.eventMode = "none";
    parent.addChild(titleText);

    const loadout = this.engine.playerLoadout;
    const player = this.engine.player;
    const artifactStack = player?.inventory.resources.find(
      (r) => r.type === ResourceType.ARTIFACTS,
    );
    const artifactCount = artifactStack?.amount ?? 0;

    const artifactLabel = scaledText(
      `Артефакты: ${artifactCount}`,
      13,
      0xffcc44,
      { rawColor: true, fontFamily: "monospace" },
    );
    artifactLabel.anchor.set(1, 0);
    artifactLabel.x = PX + PW - 14;
    artifactLabel.y = PY + 14;
    artifactLabel.eventMode = "none";
    parent.addChild(artifactLabel);

    const sep = new Graphics();
    sep.rect(PX + 16, PY + 38, PW - 32, 1).fill({ color: 0x334433 });
    parent.addChild(sep);

    if (!loadout) {
      const noLoad = scaledText("Нет активного снаряжения", 13, 0x445566, {
        rawColor: true,
        fontFamily: "monospace",
      });
      noLoad.x = PX + 20;
      noLoad.y = PY + 56;
      noLoad.eventMode = "none";
      parent.addChild(noLoad);
    } else {
      const items = loadout.slottedWithGear();
      if (items.length === 0) {
        const empty = scaledText(
          "Нет установленного снаряжения для улучшения",
          13,
          0x445566,
          { rawColor: true, fontFamily: "monospace" },
        );
        empty.x = PX + 20;
        empty.y = PY + 56;
        empty.eventMode = "none";
        parent.addChild(empty);
      } else {
        const ROW = 56;
        let rowY = PY + 48;

        for (const item of items) {
          if (rowY + ROW > PY + PH - 50) break;
          if (!item.gear) continue;

          const currentUpgrades = item.upgrades;
          const cost = artifactUpgradeCost(currentUpgrades);
          const effectiveTech = item.gear.techLevel + currentUpgrades;
          const maxed = currentUpgrades >= 2;
          const canAfford = !maxed && artifactCount >= cost;

          const rowBg = new Graphics();
          rowBg
            .rect(PX + 14, rowY + 2, PW - 28, ROW - 4)
            .fill({ color: 0x0a1810, alpha: 1 });
          parent.addChild(rowBg);

          const nameText = scaledText(item.gear.name, 13, 0xddeeff, {
            rawColor: true,
            fontFamily: "monospace",
          });
          nameText.x = PX + 22;
          nameText.y = rowY + 8;
          nameText.eventMode = "none";
          parent.addChild(nameText);

          const techColor =
            currentUpgrades === 2
              ? 0xcc88ff
              : currentUpgrades === 1
                ? 0x88ccff
                : 0x556677;
          const tierLabel = currentUpgrades > 0 ? ` (+${currentUpgrades})` : "";
          const techText = scaledText(
            `T${effectiveTech}${tierLabel}`,
            12,
            techColor,
            { rawColor: true, fontFamily: "monospace" },
          );
          techText.x = PX + 22;
          techText.y = rowY + 30;
          techText.eventMode = "none";
          parent.addChild(techText);

          const costLabel = maxed ? "Максимум" : `Улучшить: ${cost} арт.`;
          const costColor = maxed ? 0x445566 : canAfford ? 0xcc88ff : 0x664433;
          const costText = scaledText(costLabel, 12, costColor, {
            rawColor: true,
            fontFamily: "monospace",
          });
          costText.anchor.set(1, 0.5);
          costText.x = PX + PW - 120;
          costText.y = rowY + ROW / 2;
          costText.eventMode = "none";
          parent.addChild(costText);

          if (!maxed) {
            const btnLabel = canAfford ? "[Улучшить]" : "Мало арт.";
            const btnColor = canAfford ? 0xaa66ff : 0x443355;
            const btn = scaledText(btnLabel, 13, btnColor, {
              rawColor: true,
              fontFamily: "monospace",
            });
            btn.anchor.set(1, 0.5);
            btn.x = PX + PW - 14;
            btn.y = rowY + ROW / 2;

            if (canAfford && player) {
              btn.eventMode = "static";
              btn.cursor = "pointer";
              btn.on("pointerdown", (e) => {
                e.stopPropagation();
                this.doUpgrade(
                  item.index,
                  item.gearId,
                  currentUpgrades,
                  artifactStack!,
                  parent,
                  sw,
                  sh,
                );
              });
              btn.on("pointerover", () => {
                btn.alpha = 0.7;
              });
              btn.on("pointerout", () => {
                btn.alpha = 1;
              });
            } else {
              btn.eventMode = "none";
            }
            parent.addChild(btn);
          }

          rowY += ROW;
        }
      }
    }

    const back = scaledText("[ ← Назад ]", 14, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
    });
    back.anchor.set(0.5, 1);
    back.x = PX + PW / 2;
    back.y = PY + PH - 10;
    back.eventMode = "static";
    back.cursor = "pointer";
    back.on("pointerdown", (e) => {
      e.stopPropagation();
      this.onBack();
    });
    back.on("pointerover", () => {
      back.alpha = 0.7;
    });
    back.on("pointerout", () => {
      back.alpha = 1;
    });
    parent.addChild(back);

    this.addToastSlot(PX, PY, PW, PH);
  }

  private doUpgrade(
    slotIndex: number,
    gearId: string,
    currentUpgrades: number,
    artifactStack: { amount: number },
    parent: Container,
    sw: number,
    sh: number,
  ): void {
    const loadout = this.engine.playerLoadout;
    if (!loadout) return;

    const baseGear = gearById(gearId);
    if (!baseGear) return;

    const effectiveGear =
      currentUpgrades > 0
        ? {
            ...baseGear,
            upgrades: currentUpgrades,
            techLevel: baseGear.techLevel + currentUpgrades,
          }
        : baseGear;

    try {
      const upgradedGear = applyArtifactUpgrade(
        effectiveGear,
        artifactStack.amount,
      );
      const cost = artifactUpgradeCost(currentUpgrades);
      artifactStack.amount -= cost;
      loadout.setSlotUpgrades(slotIndex, upgradedGear.upgrades ?? 1);
      logger.info(
        `ResearchUpgradePanel: upgraded ${gearId} to T${upgradedGear.techLevel} (+${upgradedGear.upgrades})`,
      );
      this.render(parent, sw, sh);
      this.showToast(
        `${baseGear.name} улучшен до T${upgradedGear.techLevel}!`,
        0xcc88ff,
      );
    } catch (err) {
      if (err instanceof GameBusinessException) {
        this.showToast(err.errorMessage, 0xff5544);
      }
    }
  }
}
