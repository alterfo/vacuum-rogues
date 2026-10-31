import { Container, Graphics, Rectangle } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import { attachWheelScroll } from "./WheelScroll";

export interface ScrollableListOptions<T> {
  x?: number;
  y?: number;
  width: number;
  height: number;
  itemHeight: number;
  items: T[];
  renderItem: (item: T, index: number) => Container;
  getItemHeight?: (item: T, index: number) => number;
  wheelStep?: number;
  enableDrag?: boolean;
  enableWheel?: boolean;
}

export class ScrollableList<T> {
  public readonly container: Container;

  private readonly content: Container;
  private readonly clipMask: Graphics;
  private readonly hitArea: Rectangle;

  private readonly itemHeights: number[];
  private readonly wheelStep: number;
  private readonly itemCountValue: number;

  private scrollOffset = 0;
  private readonly maxScroll: number;

  private detachWheel: (() => void) | null = null;

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
      getItemHeight,
      wheelStep,
      enableDrag = true,
      enableWheel = true,
    } = options;

    this.wheelStep = wheelStep ?? itemHeight;
    this.itemCountValue = items.length;

    this.itemHeights = items.map((item, index) => {
      const measured = getItemHeight?.(item, index) ?? itemHeight;
      return measured > 0 ? measured : itemHeight;
    });
    const contentHeight = this.itemHeights.reduce((sum, rowHeight) => {
      return sum + rowHeight;
    }, 0);
    this.maxScroll = Math.max(0, contentHeight - height);

    this.container = new Container();
    this.container.x = x;
    this.container.y = y;

    this.content = new Container();
    let rowY = 0;
    items.forEach((item, index) => {
      const row = renderItem(item, index);
      row.y = rowY;
      rowY += this.itemHeights[index] ?? itemHeight;
      this.content.addChild(row);
    });
    this.container.addChild(this.content);

    this.clipMask = new Graphics();
    this.clipMask.rect(0, 0, width, height).fill({ color: 0xffffff });
    this.clipMask.eventMode = "none";
    this.container.addChild(this.clipMask);
    this.content.mask = this.clipMask;

    this.hitArea = new Rectangle(0, 0, width, height);
    this.content.hitArea = this.hitArea;

    if (enableDrag) this.enableDragScroll();

    if (enableWheel && this.maxScroll > 0) {
      this.detachWheel = attachWheelScroll((dir) =>
        this.scrollBy(dir * this.wheelStep),
      );
    }
  }

  public get contentHeight(): number {
    return this.itemHeights.reduce((sum, rowHeight) => sum + rowHeight, 0);
  }

  public get itemCount(): number {
    return this.itemCountValue;
  }

  public get offset(): number {
    return this.scrollOffset;
  }

  public get maxOffset(): number {
    return this.maxScroll;
  }

  public get overflows(): boolean {
    return this.maxScroll > 0;
  }

  public scrollTo(offset: number): void {
    const next = Math.max(0, Math.min(this.maxScroll, offset));
    if (next === this.scrollOffset) return;
    this.scrollOffset = next;
    this.applyOffset();
  }

  public scrollBy(delta: number): void {
    this.scrollTo(this.scrollOffset + delta);
  }

  private applyOffset(): void {
    this.content.y = -this.scrollOffset || 0;
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
      const dy = e.global.y - this.dragStartPointerY;
      this.scrollTo(this.dragStartOffset - dy);
    });
    this.content.on("pointerup", end);
    this.content.on("pointerupoutside", end);
  }

  public destroy(): void {
    if (this.detachWheel) {
      this.detachWheel();
      this.detachWheel = null;
    }
    this.container.destroy({ children: true });
  }
}
