import { Container, Graphics } from "pixi.js";
import { scaledText } from "./scaledText";
import type { Renderer } from "../Renderer";
import type { Player } from "@/domain/Player";
import type { ShipLoadout } from "@/systems/equipment/ShipLoadout";
import { gearById } from "@/systems/equipment/GearCatalog";
import { gearMicromoduleCategory } from "@/systems/equipment/GearBridge";
import { logger } from "@/utils/logger";

const TIER_BONUS = ["", "+20%", "+12%", "+6%"] as const;

export interface MicromoduleApplyContext {
  readonly container: Container;
  readonly player: Player;
  readonly loadout: ShipLoadout;
  readonly target: { slotIndex: number; gearId: string };
  showToast(msg: string, color: number): void;
  onClose(): void;
}

export class MicromoduleApplyPanel {
  constructor(private readonly renderer: Renderer) {}

  render(ctx: MicromoduleApplyContext): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const { container, player, loadout, target } = ctx;
    const targetGear = gearById(target.gearId);
    if (!targetGear) {
      ctx.onClose();
      return;
    }

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    container.addChild(bg);

    const PW = Math.min(520, sw - 60);
    const PH = Math.min(480, sh - 80);
    const PX = (sw - PW) / 2;
    const PY = (sh - PH) / 2;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH).fill({ color: 0x0a1018, alpha: 1 });
    panel.rect(PX, PY, PW, PH).stroke({ color: 0x443322, width: 1 });
    container.addChild(panel);

    const title = scaledText(
      `Выбор микромодуля для: ${targetGear.name}`,
      13,
      0xffaa22,
      { rawColor: true, fontFamily: "monospace" },
    );
    title.x = PX + 14;
    title.y = PY + 12;
    title.eventMode = "none";
    container.addChild(title);

    const targetCategory = gearMicromoduleCategory(targetGear);
    const matching = player.inventory.micromodules.filter(
      (mm) => mm.targetCategory === targetCategory,
    );

    if (matching.length === 0) {
      const none = scaledText(
        "Нет подходящих микромодулей в инвентаре",
        12,
        0x445566,
        { rawColor: true, fontFamily: "monospace" },
      );
      none.x = PX + 20;
      none.y = PY + 60;
      none.eventMode = "none";
      container.addChild(none);
    } else {
      let rowY = PY + 52;
      const ROW = 48;
      for (const mm of matching) {
        if (rowY + ROW > PY + PH - 50) break;

        const rowBg = new Graphics();
        rowBg.rect(PX + 14, rowY, PW - 28, ROW - 4).fill({ color: 0x0d1820 });
        container.addChild(rowBg);

        const tierColor =
          mm.bonusTier === 1
            ? 0xffcc44
            : mm.bonusTier === 2
              ? 0x88ccff
              : 0xb4b4b4;
        const info = scaledText(
          `${mm.name}  (${TIER_BONUS[mm.bonusTier]} ${mm.bonusType})`,
          12,
          tierColor,
          { rawColor: true, fontFamily: "monospace" },
        );
        info.x = PX + 20;
        info.y = rowY + 14;
        info.eventMode = "none";
        container.addChild(info);

        const applyBtn = scaledText("[Применить]", 12, 0x44ff88, {
          rawColor: true,
          fontFamily: "monospace",
        });
        applyBtn.anchor.set(1, 0.5);
        applyBtn.x = PX + PW - 14;
        applyBtn.y = rowY + ROW / 2 - 2;
        applyBtn.eventMode = "static";
        applyBtn.cursor = "pointer";
        applyBtn.on("pointerdown", (e) => {
          e.stopPropagation();
          const applied = loadout.applyMicromoduleAt(target.slotIndex, mm.id);
          if (applied) {
            const idx = player.inventory.micromodules.indexOf(mm);
            if (idx >= 0) player.inventory.micromodules.splice(idx, 1);
            logger.info(
              `Applied micromodule ${mm.id} to loadout gear ${target.gearId}`,
            );
            ctx.showToast(`Применён: ${mm.name}`, 0x44ff88);
          } else {
            ctx.showToast("Не удалось применить микромодуль", 0xff8844);
          }
          ctx.onClose();
        });
        applyBtn.on("pointerover", () => {
          applyBtn.alpha = 0.7;
        });
        applyBtn.on("pointerout", () => {
          applyBtn.alpha = 1;
        });
        container.addChild(applyBtn);

        rowY += ROW;
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
      ctx.onClose();
    });
    back.on("pointerover", () => {
      back.alpha = 0.7;
    });
    back.on("pointerout", () => {
      back.alpha = 1;
    });
    container.addChild(back);
  }
}
