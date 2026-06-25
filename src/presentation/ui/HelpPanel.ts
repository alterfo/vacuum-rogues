import { Container, Graphics } from "pixi.js";
import { scaledText } from "./scaledText";
import { UiButton } from "./UiButton";
import type { Renderer } from "../Renderer";
import type { HelpEntry } from "@/systems/onboarding/helpContent";

/**
 * The reusable, dismissible onboarding / contextual-help panel
 * (`docs/plans/20260623-onboarding-and-contextual-help.md`).
 *
 * A themed dark overlay (the same look as the quest journal / micromodule modal):
 * a full-screen click-swallowing backdrop, a centred panel with a title, the
 * entry's body paragraphs, an optional «Управление» controls list, and two close
 * affordances («Понятно» + «✕»). All text routes through `scaledText` so it
 * tracks the S/M/L setting and stays legible on the dark panel.
 *
 * The panel is content-agnostic: it renders any {@link HelpEntry}, so the
 * first-time auto-hint and the «?»-reopened hint share one component. Mount its
 * `container`; call `destroy()` (or any close affordance → `onClose`) to remove.
 */
export class HelpPanel {
  /** Mount this into the scene's UI container. */
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

    // Full-screen click-swallowing backdrop: like QuestJournalUI, it is the one
    // hit target so every click over the panel stops here instead of bubbling to
    // the scene's stage handlers (CLAUDE.md Rule 2/3). All panel content below is
    // eventMode="none" so it falls through to this — only the buttons are live.
    // The container is offset to the panel position below, so the backdrop uses
    // an oversized rect to cover the whole screen regardless of that offset.
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

    // Panel background — drawn after we measure the content so its height hugs
    // the text. Added first so the text/buttons stack on top of it.
    const panel = new Graphics();
    panel.eventMode = "none";
    this.container.addChild(panel);

    // Lay the content out top-down, advancing `y` by each block's real height.
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
      const header = scaledText("Управление:", 12, 0x88aabb, {
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

    // «Понятно» (primary) closes the panel; the «✕» in the corner does the same.
    const okBtn = new UiButton(
      "",
      "Понятно",
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

    // «✕» close button, top-right inside the panel.
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

  /** Remove the panel (and all its children) from the scene graph. */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
