/**
 * Reusable masked, scrollable list region.
 *
 * Several panels (quest journal, equipment shop, station hangar, info center,
 * job board, main-menu saves) each hand-rolled the same masked container +
 * scrollbar + wheel handling on top of `attachWheelScroll`. This extracts ONE
 * implementation so every long list is fully reachable with a consistent design
 * (no ad-hoc "show first N" truncation).
 *
 * Design (see plan 20260618-scrollable-list-design-and-planet-rotation):
 *  - a `content` Container holds ALL items stacked by `itemHeight` (no slicing);
 *  - it is translated by a clamped, pixel `scrollOffset`;
 *  - a Graphics mask is `addChild()`'d to the root so it stays fixed on screen
 *    while content scrolls under it (PixiJS 8 mask rule — see pixi-rules.md);
 *  - a tracking `hitArea` keeps scrolled-out rows un-clickable (a mask clips
 *    RENDER only, not hit-testing);
 *  - wheel (window-level via `attachWheelScroll`) and vertical drag both scroll.
 *
 * It is list-type-agnostic: callers supply `items`, a fixed `itemHeight` and a
 * `renderItem` callback returning the per-row display object.
 */
import { Container, Graphics, Rectangle } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import { attachWheelScroll } from "./WheelScroll";

export interface ScrollableListOptions<T> {
  /** Local x of the masked region (within the parent container). */
  x?: number;
  /** Local y of the masked region (within the parent container). */
  y?: number;
  /** Visible window width in px. */
  width: number;
  /** Visible window height in px. */
  height: number;
  /** Fixed per-row height in px (content height = items.length * itemHeight). */
  itemHeight: number;
  /** The backing data — rendered in full, never truncated. */
  items: T[];
  /** Build the display object for one row (positioned by the list). */
  renderItem: (item: T, index: number) => Container;
  /** Px scrolled per wheel notch / arrow press. Defaults to `itemHeight`. */
  wheelStep?: number;
  /** Enable click-drag scrolling (default true). */
  enableDrag?: boolean;
}

export class ScrollableList<T> {
  /** Root display object — add this to the parent scene/panel. */
  public readonly container: Container;

  private readonly content: Container;
  private readonly clipMask: Graphics;
  private readonly hitArea: Rectangle;

  private readonly itemHeight: number;
  private readonly wheelStep: number;
  private readonly itemCountValue: number;

  /** Current pixel scroll offset, always in `[0, maxOffset]`. */
  private scrollOffset = 0;
  private readonly maxScroll: number;

  private detachWheel: (() => void) | null = null;

  // Drag state.
  private dragging = false;
  private dragStartPointerY = 0;
  private dragStartOffset = 0;

  constructor(options: ScrollableListOptions<T>) {
    const {
      x = 0,
      y = 0,
      width,
      height,
      itemHeight,
      items,
      renderItem,
      wheelStep,
      enableDrag = true,
    } = options;

    this.itemHeight = itemHeight;
    this.wheelStep = wheelStep ?? itemHeight;
    this.itemCountValue = items.length;

    const contentHeight = items.length * itemHeight;
    this.maxScroll = Math.max(0, contentHeight - height);

    this.container = new Container();
    this.container.x = x;
    this.container.y = y;

    // Content holds every row — no truncation.
    this.content = new Container();
    items.forEach((item, index) => {
      const row = renderItem(item, index);
      row.y = index * itemHeight;
      this.content.addChild(row);
    });
    this.container.addChild(this.content);

    // Mask lives on the root (a sibling of content) so it stays put while the
    // content scrolls under it. It MUST be in the scene graph — assigning
    // `.mask` to an un-parented Graphics is ignored by PixiJS 8.
    this.clipMask = new Graphics();
    this.clipMask.rect(0, 0, width, height).fill({ color: 0xffffff });
    // A mask is a render-only clip; it must never be a hit target (otherwise it
    // would swallow clicks meant for the rows or a modal backdrop beneath it).
    this.clipMask.eventMode = "none";
    this.container.addChild(this.clipMask);
    this.content.mask = this.clipMask;

    // A mask clips render only; without a tracking hitArea the scrolled-out
    // rows stay clickable in their old on-screen spots. Keep the hit window
    // fixed on screen by advancing it with the scroll offset (local coords).
    this.hitArea = new Rectangle(0, 0, width, height);
    this.content.hitArea = this.hitArea;

    if (enableDrag) this.enableDragScroll();

    // Window-level wheel: federated `wheel` on the content is swallowed by the
    // rows on top, so use the shared DOM listener. Only attach when there is
    // something to scroll (otherwise we'd needlessly preventDefault page scroll).
    if (this.maxScroll > 0) {
      this.detachWheel = attachWheelScroll((dir) =>
        this.scrollBy(dir * this.wheelStep),
      );
    }
  }

  /** Total stacked content height in px. */
  public get contentHeight(): number {
    return this.itemCountValue * this.itemHeight;
  }

  /** Number of rendered rows (== items.length — never truncated). */
  public get itemCount(): number {
    return this.itemCountValue;
  }

  /** Current clamped pixel offset. */
  public get offset(): number {
    return this.scrollOffset;
  }

  /** Maximum scrollable pixel offset (0 when everything fits). */
  public get maxOffset(): number {
    return this.maxScroll;
  }

  /** True when content overflows the visible window. */
  public get overflows(): boolean {
    return this.maxScroll > 0;
  }

  /** Scroll to an absolute pixel offset, clamped to `[0, maxOffset]`. */
  public scrollTo(offset: number): void {
    const next = Math.max(0, Math.min(this.maxScroll, offset));
    if (next === this.scrollOffset) return;
    this.scrollOffset = next;
    this.applyOffset();
  }

  /** Scroll by a relative pixel delta, clamped to `[0, maxOffset]`. */
  public scrollBy(delta: number): void {
    this.scrollTo(this.scrollOffset + delta);
  }

  private applyOffset(): void {
    // `|| 0` normalises the `-0` you'd otherwise get at offset 0.
    this.content.y = -this.scrollOffset || 0;
    // Track the hit window so it stays fixed on screen as content scrolls.
    this.hitArea.y = this.scrollOffset;
  }

  private enableDragScroll(): void {
    this.content.eventMode = "static";
    this.content.on("pointerdown", (e: FederatedPointerEvent) => {
      this.dragging = true;
      this.dragStartPointerY = e.global.y;
      this.dragStartOffset = this.scrollOffset;
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.content.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      // Drag content DOWN (pointer +y) → reveal earlier rows → offset shrinks.
      const dy = e.global.y - this.dragStartPointerY;
      this.scrollTo(this.dragStartOffset - dy);
    });
    this.content.on("pointerup", end);
    this.content.on("pointerupoutside", end);
  }

  /** Detach the wheel listener and tear down the display objects. */
  public destroy(): void {
    if (this.detachWheel) {
      this.detachWheel();
      this.detachWheel = null;
    }
    this.container.destroy({ children: true });
  }
}
