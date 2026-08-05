import { describe, it, expect, vi, afterEach } from "vitest";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import {
  lineStepFor,
  MONO_CHAR_WIDTH_RATIO,
} from "@/presentation/ui/questCardLayout";
import { GearKind } from "@/systems/equipment/GearCatalog";
import type { EquipmentHit } from "@/systems/info/GalacticRegistry";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

interface FakeNode {
  children: FakeNode[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

const LONG_GEAR_NAME = "Сверхдальний импульсный излучатель Мк.IV особый";

function makeHit(): EquipmentHit {
  return {
    gear: {
      id: "wpn_test",
      name: LONG_GEAR_NAME,
      kind: GearKind.WEAPON,
      techLevel: 3,
    } as unknown as EquipmentHit["gear"],
    planet: "Новая Земля-Прим",
    system: "Дальний Рубеж",
    price: 500,
    jumps: 2,
    systemId: "sys1",
    planetId: "p1",
  };
}

describe("InfoCenterScene gear-search rows at L font scale", () => {
  it("keeps the stats line from overlapping the main line above it", async () => {
    setFontScale("L");
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
    inner.gearResults = [makeHit()];
    inner.render();

    const texts = collectTexts(inner.mainContainer);
    const lineLabel = texts.find((n) => n.text.includes("T3"));
    expect(lineLabel, "expected the gear-row main line").toBeTruthy();
    const statsLabel = texts.find(
      (n) => n !== lineLabel && n.x === lineLabel!.x && n.y > lineLabel!.y,
    );
    expect(statsLabel, "expected the gear-row stats line").toBeTruthy();

    const lineStep = lineStepFor(scaledFont(11));
    expect(statsLabel!.y).toBeGreaterThanOrEqual(lineLabel!.y + lineStep);

    scene.destroy();
  });

  it("shrinks the char budget (not word-wraps) so a long name/planet name never overflows the row at L scale", async () => {
    setFontScale("L");
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
    inner.gearResults = [makeHit()];
    inner.render();

    const texts = collectTexts(inner.mainContainer);
    const lineLabel = texts.find((n) => n.text.includes("T3"));
    expect(lineLabel, "expected the gear-row main line").toBeTruthy();

    const baseCharPx = 11 * MONO_CHAR_WIDTH_RATIO;
    const charPx = scaledFont(11) * MONO_CHAR_WIDTH_RATIO;
    const gearNameChars = Math.max(6, Math.floor((18 * baseCharPx) / charPx));
    expect(gearNameChars).toBeLessThan(18);

    const oldGearName = LONG_GEAR_NAME.slice(0, 18).padEnd(18);
    const newGearName = LONG_GEAR_NAME.slice(0, gearNameChars).padEnd(
      gearNameChars,
    );
    expect(lineLabel!.text).toContain(newGearName);
    expect(lineLabel!.text).not.toContain(oldGearName);

    scene.destroy();
  });
});
