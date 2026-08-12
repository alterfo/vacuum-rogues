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
  gearFacets: Set<string>;
  gearMinHpIdx: number;
  gearMinCargoIdx: number;
  gearMinDamageIdx: number;
  gearResults: Array<{ gear: { id: string } }>;
  runGearSearch: () => void;
  destroy: () => void;
};

async function makeScene(): Promise<SceneWithGearSearch> {
  const { InfoCenterScene } = await import("@/presentation/InfoCenterScene");
  const scene = new InfoCenterScene(mockRenderer);
  return scene as unknown as SceneWithGearSearch;
}

function makeSystem(): import("@/domain/StarSystem").StarSystem {
  return {
    id: "A",
    name: "Альфа",
    connections: [],
    planets: [{ id: "p1", name: "Планета" }],
  } as unknown as import("@/domain/StarSystem").StarSystem;
}

describe("InfoCenterScene gear search — stat-threshold controls (Task 11)", () => {
  it("a hull HP threshold filters out gear below it (facet=hull)", async () => {
    const { GalacticRegistry } =
      await import("@/systems/info/GalacticRegistry");
    const { gearById } = await import("@/systems/equipment/GearCatalog");
    const system = makeSystem();

    const registry = new GalacticRegistry(
      [system],
      [],
      [
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("hull_courier")!,
          price: 6000,
        }, // hp 120
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("hull_warden")!,
          price: 20000,
        }, // hp 220
      ],
    );

    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => registry,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.gearFacets = new Set(["hull"]);
    scene.gearMinHpIdx = 3; // GEAR_HP_OPTIONS[3] === 200

    scene.runGearSearch();

    expect(scene.gearResults.map((r) => r.gear.id)).toEqual(["hull_warden"]);
    scene.destroy();
  });

  it("combining facet + stat threshold + price narrows correctly", async () => {
    const { GalacticRegistry } =
      await import("@/systems/info/GalacticRegistry");
    const { gearById } = await import("@/systems/equipment/GearCatalog");
    const system = makeSystem();

    const registry = new GalacticRegistry(
      [system],
      [],
      [
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("hull_warden")!,
          price: 20000,
        }, // hp 220, over price cap
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("hull_bastion")!,
          price: 9000,
        }, // hp 360, within cap
      ],
    );

    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => registry,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.gearFacets = new Set(["hull"]);
    scene.gearMinHpIdx = 3; // minHp 200
    (scene as unknown as { gearMaxPriceIdx: number }).gearMaxPriceIdx = 3; // GEAR_MAX_PRICE_OPTIONS[3] === 10000

    scene.runGearSearch();

    expect(scene.gearResults.map((r) => r.gear.id)).toEqual(["hull_bastion"]);
    scene.destroy();
  });

  it("empty thresholds (idx=0) reproduce the default facet-only search", async () => {
    const { GalacticRegistry } =
      await import("@/systems/info/GalacticRegistry");
    const { gearById } = await import("@/systems/equipment/GearCatalog");
    const system = makeSystem();

    const registry = new GalacticRegistry(
      [system],
      [],
      [
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("hull_courier")!,
          price: 6000,
        },
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("hull_warden")!,
          price: 20000,
        },
      ],
    );

    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => registry,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.gearFacets = new Set(["hull"]);

    scene.runGearSearch();

    expect(scene.gearResults.map((r) => r.gear.id)).toEqual([
      "hull_courier",
      "hull_warden",
    ]);
    scene.destroy();
  });

  it("a weapon damage threshold filters out gear below it (facet=weapon)", async () => {
    const { GalacticRegistry } =
      await import("@/systems/info/GalacticRegistry");
    const { gearById } = await import("@/systems/equipment/GearCatalog");
    const system = makeSystem();

    const registry = new GalacticRegistry(
      [system],
      [],
      [
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("wpn_pulse")!,
          price: 2500,
        }, // dmg 14
        {
          systemId: "A",
          planetId: "p1",
          gear: gearById("wpn_torpedo")!,
          price: 16000,
        }, // dmg 55
      ],
    );

    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => registry,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.gearFacets = new Set(["weapon"]);
    scene.gearMinDamageIdx = 3; // GEAR_DAMAGE_OPTIONS[3] === 20

    scene.runGearSearch();

    expect(scene.gearResults.map((r) => r.gear.id)).toEqual(["wpn_torpedo"]);
    scene.destroy();
  });
});
