/**
 * Playtest bug: the InfoCenter equipment search silently excluded tech-7/8
 * gear (e.g. the apex `eq_engine_v`) even though the catalog goes up to
 * tech 8. Two compounding causes, both a stray hardcoded `6`:
 *  1. `gearMaxTech` defaulted to 6, so a fresh search never included tech-7/8
 *     hits at all, with no visible sign anything was being hidden.
 *  2. The "Т.ур:" min/max cycle buttons wrapped `(value % 6) + 1`, so no
 *     amount of clicking could reach 7 or 8 either.
 */
import { describe, it, expect, vi } from "vitest";
import {
  GearKind,
  GEAR_CATALOG,
  EquipmentClass,
} from "@/systems/equipment/GearCatalog";

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
  };
});

const mockRenderer = {
  app: { screen: { width: 800, height: 600 } },
  uiLayer: { addChild: vi.fn() },
} as unknown as import("@/presentation/Renderer").Renderer;

type SceneWithGearSearch = {
  gameEngine: unknown;
  gearMinTech: number;
  gearMaxTech: number;
  gearResults: Array<{ gear: { techLevel: number } }>;
  runGearSearch: () => void;
  destroy: () => void;
};

async function makeScene(): Promise<SceneWithGearSearch> {
  const { InfoCenterScene } = await import("@/presentation/InfoCenterScene");
  const scene = new InfoCenterScene(mockRenderer);
  return scene as unknown as SceneWithGearSearch;
}

describe("InfoCenterScene gear search tech-level range", () => {
  it("includes tech-7/8 gear (e.g. the apex engine) in a default search, not just tech 1-6", async () => {
    const { GalacticRegistry } =
      await import("@/systems/info/GalacticRegistry");
    const system = {
      id: "A",
      name: "Альфа",
      connections: [],
      planets: [{ id: "p1", name: "Планета" }],
    } as unknown as import("@/domain/StarSystem").StarSystem;

    // Must be an ENGINE specifically: the scene's default facet filter is
    // {"engine"}, so a non-engine tech-7 pick would be excluded by the facet
    // (not the tech range) and fail this test with a misleading signal.
    const apexEngine = GEAR_CATALOG.find(
      (g) =>
        g.kind === GearKind.EQUIPMENT &&
        g.equipmentClass === EquipmentClass.ENGINE &&
        g.techLevel >= 7,
    );
    expect(
      apexEngine,
      "fixture assumption: a tech >=7 engine exists",
    ).toBeTruthy();

    const registry = new GalacticRegistry(
      [system],
      [],
      [{ systemId: "A", planetId: "p1", gear: apexEngine!, price: 13500 }],
    );

    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => registry,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };

    scene.runGearSearch();

    expect(
      scene.gearResults.some((r) => r.gear.techLevel === apexEngine!.techLevel),
    ).toBe(true);

    scene.destroy();
  });
});

describe("Т.ур: min/max cycle reaches the full tech range (cause 2)", () => {
  it("cycles 1→2→…→GEAR_TECH_MAX and wraps back to 1 (the old `% 6` wrap never reached 7-8)", async () => {
    const { GEAR_TECH_MAX, cycleGearTech } =
      await import("@/presentation/InfoCenterScene");

    const seen: number[] = [];
    let v = 1;
    for (let i = 0; i < GEAR_TECH_MAX; i++) {
      seen.push(v);
      v = cycleGearTech(v);
    }
    // Every level up to the ceiling is reachable by clicking …
    expect(seen).toEqual(
      Array.from({ length: GEAR_TECH_MAX }, (_, i) => i + 1),
    );
    expect(Math.max(...seen)).toBe(GEAR_TECH_MAX);
    // … and one more click wraps back to 1.
    expect(v).toBe(1);
  });

  it("GEAR_TECH_MAX covers every base-catalog techLevel (the original bug: a ceiling BELOW the catalog max silently hides gear)", async () => {
    const { GEAR_TECH_MAX } = await import("@/presentation/InfoCenterScene");
    const catalogMax = Math.max(...GEAR_CATALOG.map((g) => g.techLevel));
    // Base catalog tops out at 7 today; upgradeGear adds +1 (the type's 1..8
    // domain), so the ceiling must never drop below the catalog max — a new
    // higher-tech item must widen GEAR_TECH_MAX, not vanish from search.
    expect(GEAR_TECH_MAX).toBeGreaterThanOrEqual(catalogMax);
  });
});
