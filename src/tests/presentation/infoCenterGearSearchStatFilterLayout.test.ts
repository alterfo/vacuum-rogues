import { describe, it, expect, vi } from "vitest";

const rects: Array<{ x: number; y: number; w: number; h: number }> = [];

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
    Graphics: vi.fn().mockImplementation(() => {
      const g = {
        ...makeContainer(),
        rect: vi.fn().mockImplementation(function (
          this: unknown,
          x: number,
          y: number,
          w: number,
          h: number,
        ) {
          rects.push({ x, y, w, h });
          return this;
        }),
        roundRect: vi.fn().mockReturnThis(),
        circle: vi.fn().mockReturnThis(),
        fill: vi.fn().mockReturnThis(),
        stroke: vi.fn().mockReturnThis(),
      };
      return g;
    }),
    Text: vi.fn().mockImplementation((opts?: { text?: unknown }) => {
      const node = makeContainer();
      node.text = opts?.text != null ? String(opts.text) : "";
      return node;
    }),
  };
});

const mockRenderer = {
  app: { screen: { width: 500, height: 600 } },
  uiLayer: { addChild: vi.fn() },
} as unknown as import("@/presentation/Renderer").Renderer;

type SceneWithGearSearch = {
  gameEngine: unknown;
  gearFacets: Set<string>;
  renderGear: (container: unknown, pw: number, ph: number) => void;
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

describe("InfoCenterScene gear search — stat-row layout (Task 11)", () => {
  it("hull stat-threshold boxes (HP/Slots/Cargo) sit on one row, side by side, without overlap or overflow", async () => {
    rects.length = 0;
    const system = makeSystem();
    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => null,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.gearFacets = new Set(["hull"]);

    const { Container } = await import("pixi.js");
    const container = new Container();
    scene.renderGear(container, 500, 600);

    // The three hull-stat cycle boxes share the same fixed width (46px, see
    // mountStatCycle) — pick them out from every rect drawn this render pass.
    const statBoxes = rects.filter((r) => r.w === 46).sort((a, b) => a.x - b.x);
    expect(statBoxes.length).toBe(3);

    const allSameRow = statBoxes.every((b) => b.y === statBoxes[0].y);
    expect(allSameRow).toBe(true);

    for (let i = 1; i < statBoxes.length; i++) {
      expect(statBoxes[i].x).toBeGreaterThanOrEqual(
        statBoxes[i - 1].x + statBoxes[i - 1].w,
      );
    }

    const lastBox = statBoxes[statBoxes.length - 1];
    expect(lastBox.x + lastBox.w).toBeLessThanOrEqual(500 - 16);

    scene.destroy();
  });

  it("weapon stat-threshold boxes (Dmg/Range) sit on one row without overlap", async () => {
    rects.length = 0;
    const system = makeSystem();
    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => null,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.gearFacets = new Set(["weapon"]);

    const { Container } = await import("pixi.js");
    const container = new Container();
    scene.renderGear(container, 500, 600);

    const statBoxes = rects.filter((r) => r.w === 46).sort((a, b) => a.x - b.x);
    expect(statBoxes.length).toBe(2);
    expect(statBoxes[1].x).toBeGreaterThanOrEqual(
      statBoxes[0].x + statBoxes[0].w,
    );
    scene.destroy();
  });

  it("no facet selected — no stat row is drawn at all", async () => {
    rects.length = 0;
    const system = makeSystem();
    const scene = await makeScene();
    scene.gameEngine = {
      getInfoRegistry: () => null,
      galaxy: { systems: [system], gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.gearFacets = new Set();

    const { Container } = await import("pixi.js");
    const container = new Container();
    scene.renderGear(container, 500, 600);

    const statBoxes = rects.filter((r) => r.w === 46);
    expect(statBoxes.length).toBe(0);
    scene.destroy();
  });
});
