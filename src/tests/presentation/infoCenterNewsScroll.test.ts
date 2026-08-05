import { describe, it, expect, vi, afterEach } from "vitest";

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
      text: "",
      mask: null,
      hitArea: null,
      anchor: { set: vi.fn() },
      on: vi.fn(function (this: unknown) {
        return this;
      }),
      destroy: vi.fn(),
      removeChildren: vi.fn(function (this: { children: unknown[] }) {
        this.children.length = 0;
      }),
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
      circle: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation((opts?: { text?: unknown }) => {
      const node = makeContainer();
      node.text = opts?.text != null ? String(opts.text) : "";
      return node;
    }),
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

const mockRenderer = {
  app: { screen: { width: 800, height: 600 } },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn() },
} as unknown as import("@/presentation/Renderer").Renderer;

interface NewsItemLike {
  day: number;
  text: string;
  color: number;
  bookmarkKey: number;
}

type SceneInternals = {
  activeTab: string;
  newsItems: NewsItemLike[];
  newsScroll: number;
  newsList: { itemCount: number; offset: number; maxOffset: number } | null;
  render: () => void;
  scrollNews: (deltaRows: number) => void;
  initialize: (ctx?: object) => void;
  destroy: () => void;
};

const NEWS_ROW_H = 38;

function makeNews(count: number): NewsItemLike[] {
  return Array.from({ length: count }, (_, i) => ({
    day: i,
    text: `Новость ${i}`,
    color: 0xffffff,
    bookmarkKey: i,
  }));
}

const createdScenes: { destroy: () => void }[] = [];

async function makeScene(newsCount: number): Promise<SceneInternals> {
  const { InfoCenterScene } = await import("@/presentation/InfoCenterScene");
  const scene = new InfoCenterScene(mockRenderer) as unknown as SceneInternals;
  createdScenes.push(scene as unknown as { destroy: () => void });
  scene.initialize();
  scene.newsItems = makeNews(newsCount);
  scene.render();
  return scene;
}

afterEach(() => {
  for (const scene of createdScenes.splice(0)) scene.destroy();
});

describe("InfoCenterScene news scroll (ScrollableList migration)", () => {
  it("renders every news item with no truncation", async () => {
    const scene = await makeScene(30);
    expect(scene.newsList).not.toBeNull();
    expect(scene.newsList!.itemCount).toBe(30);
    expect(scene.newsList!.maxOffset).toBeGreaterThan(0);
  });

  it("scrolls down by rows and clamps at the bottom", async () => {
    const scene = await makeScene(30);
    expect(scene.newsList!.offset).toBe(0);

    scene.scrollNews(3);
    expect(scene.newsList!.offset).toBe(3 * NEWS_ROW_H);

    scene.scrollNews(1000); // far past the end
    expect(scene.newsList!.offset).toBe(scene.newsList!.maxOffset);
  });

  it("clamps at the top (cannot scroll above the first row)", async () => {
    const scene = await makeScene(30);
    scene.scrollNews(-5);
    expect(scene.newsList!.offset).toBe(0);
  });

  it("preserves the scroll position across a re-render (bookmark toggle)", async () => {
    const scene = await makeScene(30);
    scene.scrollNews(4);
    const before = scene.newsList!.offset;
    expect(before).toBeGreaterThan(0);
    scene.render();
    expect(scene.newsList!.offset).toBe(before);
  });

  it("does not scroll when every item already fits", async () => {
    const scene = await makeScene(2);
    expect(scene.newsList!.maxOffset).toBe(0);
    scene.scrollNews(3);
    expect(scene.newsList!.offset).toBe(0);
  });
});
