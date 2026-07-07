/**
 * UI bug fix (playtest, 2026-06-15): the Infocenter's "ОБЪЕКТЫ" search field
 * ignored typed input. `onKeyDown` only accepted characters when the private
 * `objectsInputFocused` flag was true, but that flag was unreliable — the user
 * had to click the input box separately after switching to the tab. This pins
 * the robust behaviour: as soon as the objects tab is active, typing updates
 * the query and Enter runs the search, no extra click required.
 */
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

type SceneInternals = {
  activeTab: string;
  objectsQuery: string;
  onKeyDown: (e: Partial<KeyboardEvent>) => void;
  runObjectsSearch: () => void;
};

// Each InfoCenterScene registers a window "keydown" listener in its constructor;
// destroy() removes it. Track instances so the suite doesn't leak listeners.
const createdScenes: { destroy: () => void }[] = [];

async function makeScene(): Promise<SceneInternals> {
  const { InfoCenterScene } = await import("@/presentation/InfoCenterScene");
  const scene = new InfoCenterScene(mockRenderer);
  createdScenes.push(scene as unknown as { destroy: () => void });
  return scene as unknown as SceneInternals;
}

afterEach(() => {
  for (const scene of createdScenes.splice(0)) scene.destroy();
});

describe("InfoCenterScene objects search", () => {
  it("appends typed characters to objectsQuery when the objects tab is active", async () => {
    const scene = await makeScene();
    scene.activeTab = "objects";
    scene.objectsQuery = "";
    scene.onKeyDown({ key: "a" });
    scene.onKeyDown({ key: "b" });
    scene.onKeyDown({ key: "c" });
    expect(scene.objectsQuery).toBe("abc");
  });

  it("does not require a separate input-focus click (fresh tab accepts typing)", async () => {
    const scene = await makeScene();
    scene.activeTab = "objects";
    // objectsQuery defaults to "" and the input box was never clicked.
    scene.onKeyDown({ key: "x" });
    expect(scene.objectsQuery).toBe("x");
  });

  it("removes the last character on Backspace", async () => {
    const scene = await makeScene();
    scene.activeTab = "objects";
    scene.objectsQuery = "hello";
    scene.onKeyDown({ key: "Backspace" });
    expect(scene.objectsQuery).toBe("hell");
  });

  it("runs the search on Enter", async () => {
    const scene = await makeScene();
    scene.activeTab = "objects";
    scene.objectsQuery = "vega";
    const spy = vi.spyOn(scene, "runObjectsSearch");
    scene.onKeyDown({ key: "Enter" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores Ctrl/Cmd-modified keys so paste shortcuts don't inject characters", async () => {
    const scene = await makeScene();
    scene.activeTab = "objects";
    scene.objectsQuery = "";
    scene.onKeyDown({ key: "v", metaKey: true });
    scene.onKeyDown({ key: "c", ctrlKey: true });
    expect(scene.objectsQuery).toBe("");
  });

  it("ignores multi-character keys like ArrowLeft and Shift", async () => {
    const scene = await makeScene();
    scene.activeTab = "objects";
    scene.objectsQuery = "ab";
    scene.onKeyDown({ key: "ArrowLeft" });
    scene.onKeyDown({ key: "Shift" });
    expect(scene.objectsQuery).toBe("ab");
  });

  it("ignores typing when a different tab is active", async () => {
    const scene = await makeScene();
    scene.activeTab = "news";
    scene.objectsQuery = "";
    scene.onKeyDown({ key: "z" });
    expect(scene.objectsQuery).toBe("");
  });
});

// Bug 6: the search index only covered NPC-ship + planet names, so a query
// for a star-system name silently returned "Ничего не найдено" even though
// the system exists and is reachable.
describe("InfoCenterScene objects search — star systems (Bug 6)", () => {
  type SceneWithRegistry = SceneInternals & {
    gameEngine: unknown;
    objectsResults: Array<{ kind: string }>;
  };

  it("includes a matching star system among the results, not just ships/planets", async () => {
    const { GalacticRegistry } =
      await import("@/systems/info/GalacticRegistry");
    const systems = [
      {
        id: "A",
        name: "Альфа",
        connections: [{ fromSystemId: "A", toSystemId: "B", fuelCost: 5 }],
        planets: [],
      },
      {
        id: "B",
        name: "Бета",
        connections: [{ fromSystemId: "B", toSystemId: "A", fuelCost: 5 }],
        planets: [],
      },
    ] as unknown as import("@/domain/StarSystem").StarSystem[];
    const registry = new GalacticRegistry(systems, []);

    const scene = (await makeScene()) as SceneWithRegistry;
    scene.gameEngine = {
      getInfoRegistry: () => registry,
      galaxy: { systems, gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.activeTab = "objects";
    scene.objectsQuery = "Бета";
    scene.runObjectsSearch();

    expect(scene.objectsResults.some((r) => r.kind === "system")).toBe(true);
  });

  it("returns nothing for a query that matches no ship, planet, or system", async () => {
    const { GalacticRegistry } =
      await import("@/systems/info/GalacticRegistry");
    const systems = [
      {
        id: "A",
        name: "Альфа",
        connections: [],
        planets: [],
      },
    ] as unknown as import("@/domain/StarSystem").StarSystem[];
    const registry = new GalacticRegistry(systems, []);

    const scene = (await makeScene()) as SceneWithRegistry;
    scene.gameEngine = {
      getInfoRegistry: () => registry,
      galaxy: { systems, gameDays: 10 },
      player: { currentSystemId: "A" },
    };
    scene.activeTab = "objects";
    scene.objectsQuery = "нигдешния";
    scene.runObjectsSearch();

    expect(scene.objectsResults).toEqual([]);
  });
});
