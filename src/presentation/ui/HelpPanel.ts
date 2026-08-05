import { Container, Graphics } from "pixi.js";
import { scaledText } from "./scaledText";
import { UiButton } from "./UiButton";
import type { Renderer } from "../Renderer";
import type { HelpEntry } from "@/systems/onboarding/helpContent";
import { t } from "@/i18n/i18n";

export class HelpPanel {
  public readonly container: Container;

  private static readonly PANEL_PADDING = 22;
  private static readonly MAX_PANEL_WIDTH = 560;
  private static readonly PARAGRAPH_GAP = 12;

  constructor(
    private readonly renderer: Renderer,
    entry: HelpEntry,
    private readonly onClose: () => void,
  ) {
    this.container = new Container();
    this.render(entry);
  }

  private render(entry: HelpEntry): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;
    const pad = HelpPanel.PANEL_PADDING;

    const panelW = Math.min(HelpPanel.MAX_PANEL_WIDTH, sw - 60);
    const contentW = panelW - pad * 2;

    const backdrop = new Graphics();
    backdrop
      .rect(-3000, -3000, 6000, 6000)
      .fill({ color: 0x000000, alpha: 0.72 });
    backdrop.eventMode = "static";
    const swallow = (event: { stopPropagation: () => void }): void =>
      event.stopPropagation();
    backdrop.on("pointerdown", swallow);
    backdrop.on("pointerup", swallow);
    backdrop.on("pointertap", swallow);
    this.container.addChild(backdrop);

    const panel = new Graphics();
    panel.eventMode = "none";
    this.container.addChild(panel);

    let y = pad;

    const title = scaledText(entry.title, 18, 0x00ffee, {
      rawColor: true,
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: contentW,
    });
    title.x = pad;
    title.y = y;
    title.eventMode = "none";
    this.container.addChild(title);
    y += title.height + HelpPanel.PARAGRAPH_GAP;

    for (const paragraph of entry.body) {
      const para = scaledText(paragraph, 13, 0xc8d4e0, {
        wordWrap: true,
        wordWrapWidth: contentW,
        lineHeight: 18,
      });
      para.x = pad;
      para.y = y;
      para.eventMode = "none";
      this.container.addChild(para);
      y += para.height + HelpPanel.PARAGRAPH_GAP;
    }

    if (entry.controls && entry.controls.length > 0) {
      const header = scaledText(t("help.controlsHeader"), 12, 0x88aabb, {
        rawColor: true,
        fontWeight: "bold",
      });
      header.x = pad;
      header.y = y;
      header.eventMode = "none";
      this.container.addChild(header);
      y += header.height + 6;

      for (const control of entry.controls) {
        const line = scaledText(`• ${control}`, 12, 0xaabccc, {
          wordWrap: true,
          wordWrapWidth: contentW,
          lineHeight: 16,
        });
        line.x = pad + 6;
        line.y = y;
        line.eventMode = "none";
        this.container.addChild(line);
        y += line.height + 4;
      }
      y += HelpPanel.PARAGRAPH_GAP - 4;
    }

    const okBtn = new UiButton(
      "",
      t("help.gotIt"),
      "primary",
      (e) => {
        e.stopPropagation();
        this.onClose();
      },
      140,
      34,
    );
    okBtn.x = pad;
    okBtn.y = y;
    this.container.addChild(okBtn.container);

    const panelH = y + 34 + pad;
    const panelX = (sw - panelW) / 2;
    const panelY = Math.max(40, (sh - panelH) / 2);
    panel.rect(0, 0, panelW, panelH).fill({ color: 0x0a1018, alpha: 0.97 });
    panel.rect(0, 0, panelW, panelH).stroke({ color: 0x00ffee, width: 2 });
    this.container.x = panelX;
    this.container.y = panelY;

    const closeBtn = new UiButton(
      "✕",
      "",
      "neutral",
      (e) => {
        e.stopPropagation();
        this.onClose();
      },
      28,
      28,
    );
    closeBtn.x = panelW - 28 - 8;
    closeBtn.y = 8;
    this.container.addChild(closeBtn.container);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
