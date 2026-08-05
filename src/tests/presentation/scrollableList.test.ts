import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "",
      alpha: 1,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      mask: null,
      hitArea: null,
      on: vi.fn(function (this: unknown) {
        return this;
      }),
      destroy: vi.fn(),
      destroyed: false,
    };
    node.addChild = vi.fn((...kids: unknown[]) => {
      (node.children as unknown[]).push(...kids);
      return kids[0];
    });
    node.removeChild = vi.fn();
    return node;
  };
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      rect: vi.fn().mockReturnThis(),
      roundRect: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Rectangle: vi
      .fn()
      .mockImplementation((x: number, y: number, w: number, h: number) => ({
        x,
        y,
        width: w,
        height: h,
      })),
  };
});

import { ScrollableList } from "@/presentation/ui/ScrollableList";
import { Container } from "pixi.js";

const ITEM_H = 40;
const VIEW_H = 200; // fits 5 rows

function makeList(count: number, opts: Record<string, unknown> = {}) {
  const items = Array.from({ length: count }, (_, i) => ({ id: i }));
  return new ScrollableList({
    width: 300,
    height: VIEW_H,
    itemHeight: ITEM_H,
    items,
    renderItem: () => new Container(),
    ...opts,
  });
}

describe("ScrollableList", () => {
  it("renders every item with no truncation", () => {
    const list = makeList(12);
    expect(list.itemCount).toBe(12);
    expect(list.contentHeight).toBe(12 * ITEM_H);
    const content = (list as unknown as { content: { children: unknown[] } })
      .content;
    expect(content.children).toHaveLength(12);
  });

  it("reports overflow and a positive maxOffset when content exceeds the window", () => {
    const list = makeList(12); // 480px content into a 200px window
    expect(list.overflows).toBe(true);
    expect(list.maxOffset).toBe(12 * ITEM_H - VIEW_H);
  });

  it("does not scroll when everything already fits", () => {
    const list = makeList(4); // 160px content into a 200px window
    expect(list.overflows).toBe(false);
    expect(list.maxOffset).toBe(0);
    list.scrollBy(100);
    expect(list.offset).toBe(0);
  });

  it("clamps the offset at the top", () => {
    const list = makeList(12);
    list.scrollBy(-50);
    expect(list.offset).toBe(0);
  });

  it("clamps the offset at the bottom", () => {
    const list = makeList(12);
    list.scrollBy(100000);
    expect(list.offset).toBe(list.maxOffset);
  });

  it("translates the content container by the negative offset", () => {
    const list = makeList(12);
    const content = (list as unknown as { content: { y: number } }).content;
    expect(content.y).toBe(0);
    list.scrollTo(80);
    expect(list.offset).toBe(80);
    expect(content.y).toBe(-80);
    list.scrollTo(0);
    expect(content.y).toBe(0); // normalised, not -0
  });

  it("advances the tracking hitArea with the offset (mask clips render only)", () => {
    const list = makeList(12);
    const content = (
      list as unknown as { content: { y: number; hitArea: { y: number } } }
    ).content;
    const worldTop = content.hitArea.y + content.y;
    list.scrollTo(120);
    expect(content.hitArea.y + content.y).toBeCloseTo(worldTop, 5);
  });

  it("addChild's the mask to the root container (PixiJS 8 mask rule)", () => {
    const list = makeList(12);
    const root = list.container as unknown as {
      children: unknown[];
    };
    const content = (list as unknown as { content: { mask: unknown } }).content;
    expect(content.mask).toBeTruthy();
    expect(root.children).toContain(content.mask);
  });

  it("scrolls on a window wheel event and detaches on destroy", () => {
    const wheelHandlers: ((e: WheelEvent) => void)[] = [];
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, handler) => {
        if (String(type) === "wheel") {
          wheelHandlers.push(handler as (e: WheelEvent) => void);
        }
      });
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      const list = makeList(12);
      expect(wheelHandlers).toHaveLength(1);
      const wheel = wheelHandlers[0];
      expect(list.offset).toBe(0);
      wheel({ deltaY: 100, preventDefault: vi.fn() } as unknown as WheelEvent);
      expect(list.offset).toBeGreaterThan(0);
      wheel({ deltaY: -100, preventDefault: vi.fn() } as unknown as WheelEvent);
      expect(list.offset).toBe(0);
      list.destroy();
      expect(removeSpy).toHaveBeenCalledWith("wheel", wheel);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("does not attach a wheel listener when enableWheel is false", () => {
    const wheelHandlers: unknown[] = [];
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, handler) => {
        if (String(type) === "wheel") wheelHandlers.push(handler);
      });
    try {
      const list = makeList(12, { enableWheel: false }); // overflows, but opted out
      expect(list.overflows).toBe(true);
      expect(wheelHandlers).toHaveLength(0);
      list.scrollBy(80);
      expect(list.offset).toBe(80);
    } finally {
      addSpy.mockRestore();
    }
  });

  it("does not attach a wheel listener when content fits", () => {
    const wheelHandlers: unknown[] = [];
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, handler) => {
        if (String(type) === "wheel") wheelHandlers.push(handler);
      });
    try {
      makeList(3); // fits — no overflow
      expect(wheelHandlers).toHaveLength(0);
    } finally {
      addSpy.mockRestore();
    }
  });

  it("drag-scrolls the content (down-drag reveals earlier rows)", () => {
    const list = makeList(12);
    const content = list as unknown as {
      content: { on: ReturnType<typeof vi.fn> };
    };
    const handlers = new Map<string, (e: unknown) => void>();
    for (const call of content.content.on.mock.calls) {
      handlers.set(call[0] as string, call[1] as (e: unknown) => void);
    }
    list.scrollTo(120);
    handlers.get("pointerdown")!({ global: { y: 100 } });
    handlers.get("globalpointermove")!({ global: { y: 140 } }); // dragged +40
    expect(list.offset).toBe(80); // 120 - 40
    handlers.get("pointerup")!({});
    handlers.get("globalpointermove")!({ global: { y: 300 } });
    expect(list.offset).toBe(80);
  });
});
