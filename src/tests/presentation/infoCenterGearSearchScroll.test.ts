import { describe, it, expect, vi, afterEach } from "vitest";
import { setFontScale } from "@/utils/fontScale";
import { GearKind } from "@/systems/equipment/GearCatalog";
import type { EquipmentHit } from "@/systems/info/GalacticRegistry";

afterEach(() => setFontScale("M"));

interface FakeNode {
  children: FakeNode[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mask?: unknown;
}

vi.mock("pixi.js", () => {
  const makeContainer = (): FakeNode => {
    const node: Record<string, unknown> = {
      children: [] as FakeNode[],
      eventMode: "auto",
      cursor: "",
      alpha: 1,
      x: 0,
      y: 0,
      width: 0,
      height: 14,
      text: "",
      anchor: { set: vi.fn() },
      on: vi.fn(),
      destroy: vi.fn(),
      removeChildren: vi.fn(),
      destroyed: false,
    };
    node.addChild = vi.fn((...kids: unknown[]) => {
      (node.children as unknown[]).push(...kids);
      return kids[0];
    });
    node.removeChild = vi.fn();
    return node as unknown as FakeNode;
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
      clear: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation((opts?: { text?: unknown }) => {
      const node = makeContainer();
      node.text = opts?.text != null ? String(opts.text) : "";
      return node;
    }),
    Rectangle: vi.fn().mockImplementation((x = 0, y = 0, w = 0, h = 0) => ({
      x,
      y,
      width: w,
      height: h,
    })),
  };
});

const mockRenderer = {
  app: { screen: { width: 900, height: 700 } },
  uiLayer: { addChild: vi.fn(), removeChild: vi.fn() },
  stage: {
    addChild: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    on: vi.fn(),
    off: vi.fn(),
  },
} as unknown as import("@/presentation/Renderer").Renderer;

function collectTexts(node: FakeNode): FakeNode[] {
  const out: FakeNode[] = [];
  const visit = (n: FakeNode): void => {
    if (typeof n.text === "string" && n.text.length > 0) out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  visit(node);
  return out;
}

function makeHit(i: number, price: number): EquipmentHit {
  return {
    gear: {
      id: `fuel_${i}`,
      name: `Бак${String(i).padStart(2, "0")}`,
      kind: GearKind.EQUIPMENT,
      techLevel: 1 + (i % 6),
    } as unknown as EquipmentHit["gear"],
    planet: `Планета${i}`,
    system: `Система${i}`,
    price,
    jumps: i % 5,
    systemId: `sys${i}`,
    planetId: `p${i}`,
  };
}

describe("InfoCenterScene gear-search results are never silently truncated", () => {
  it("renders every result row (not just the first screen's worth) — the old top-20 render slice is gone", async () => {
    const { InfoCenterScene } = await import("@/presentation/InfoCenterScene");
    const scene = new InfoCenterScene(mockRenderer);
    scene.initialize();
    const inner = scene as unknown as {
      activeTab: string;
      gearResults: EquipmentHit[];
      mainContainer: FakeNode;
      render: () => void;
    };
    inner.activeTab = "gear";
    inner.gearResults = Array.from({ length: 30 }, (_, i) =>
      makeHit(i, 100 + i * 50),
    );
    inner.render();

    const texts = collectTexts(inner.mainContainer);
    for (let i = 0; i < 30; i++) {
      const label = `Бак${String(i).padStart(2, "0")}`;
      const found = texts.some((t) => t.text.includes(label));
      expect(found, `expected row ${i}'s main line to be built`).toBe(true);
    }

    scene.destroy();
  });

  it("keeps a persisted scroll offset across a re-render (e.g. a facet toggle)", async () => {
    const { InfoCenterScene } = await import("@/presentation/InfoCenterScene");
    const scene = new InfoCenterScene(mockRenderer);
    scene.initialize();
    const inner = scene as unknown as {
      activeTab: string;
      gearResults: EquipmentHit[];
      gearList: { scrollBy(px: number): void; offset: number } | null;
      render: () => void;
    };
    inner.activeTab = "gear";
    inner.gearResults = Array.from({ length: 30 }, (_, i) =>
      makeHit(i, 100 + i * 50),
    );
    inner.render();
    expect(inner.gearList).not.toBeNull();

    inner.gearList!.scrollBy(200);
    const scrolledOffset = inner.gearList!.offset;
    expect(scrolledOffset).toBeGreaterThan(0);

    inner.render(); // simulate a facet-toggle re-render
    expect(inner.gearList!.offset).toBe(scrolledOffset);

    scene.destroy();
  });
});
