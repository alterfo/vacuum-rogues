import { describe, it, expect, vi, beforeEach } from "vitest";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { Sprite } from "pixi.js";
import * as textures from "@/presentation/textures";

vi.mock("pixi.js", () => {
  const node = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    destroy: vi.fn(),
    children: [],
    on: vi.fn(),
    x: 0,
    y: 0,
    rotation: 0,
    eventMode: "auto",
    cursor: "default",
    anchor: { set: vi.fn() },
    scale: { set: vi.fn() },
    alpha: 1,
  });
  return {
    Container: vi.fn().mockImplementation(node),
    Sprite: vi.fn().mockImplementation(node),
    Graphics: vi.fn().mockImplementation(() => ({
      ...node(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation((opts?: { text?: string }) => ({
      ...node(),
      text: opts?.text ?? "",
      style: {},
    })),
  };
});

vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn(),
  pickVariantKey: vi.fn(),
  tex: vi.fn(),
  loadTextureAsync: vi.fn().mockResolvedValue(undefined),
}));

function makeRenderer() {
  const layer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [{}],
  });
  return {
    app: {
      screen: { width: 1280, height: 800 },
      stage: { eventMode: "auto" },
      canvas: undefined,
    },
    uiLayer: layer(),
    gameLayer: layer(),
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;
}

const fakeTexture = { width: 128, height: 128 } as never;

describe("MainMenuScene visual upgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders textured planets and ship sprites when art is available", () => {
    vi.mocked(textures.pickVariant).mockReturnValue(fakeTexture);
    vi.mocked(textures.pickVariantKey).mockReturnValue("nebula/blue_far_01");
    vi.mocked(textures.tex).mockReturnValue(fakeTexture);

    const scene = new MainMenuScene(makeRenderer());
    scene.initialize({});

    expect(vi.mocked(Sprite).mock.calls.length).toBe(6);
    const cats = vi.mocked(textures.pickVariant).mock.calls.map((c) => c[0]);
    expect(cats.filter((c) => c === "planets")).toHaveLength(2);
    expect(cats.filter((c) => c === "ships")).toHaveLength(3);

    scene.destroy();
  });

  it("falls back to procedural graphics when textures are missing", () => {
    vi.mocked(textures.pickVariant).mockReturnValue(undefined);
    vi.mocked(textures.pickVariantKey).mockReturnValue(undefined);
    vi.mocked(textures.tex).mockReturnValue(undefined);

    const scene = new MainMenuScene(makeRenderer());
    expect(() => scene.initialize({})).not.toThrow();
    expect(vi.mocked(Sprite).mock.calls.length).toBe(0); // no art → no sprites

    scene.destroy();
  });

  it("does not mount a stale async nebula after destroy (render-gen guard)", async () => {
    type LoadResult = Awaited<ReturnType<typeof textures.loadTextureAsync>>;
    let resolveLoad: (t: LoadResult) => void = () => {};
    vi.mocked(textures.pickVariant).mockReturnValue(undefined);
    vi.mocked(textures.pickVariantKey).mockReturnValue("nebula/blue_far_01");
    vi.mocked(textures.tex).mockReturnValue(undefined); // not cached → async path
    vi.mocked(textures.loadTextureAsync).mockImplementation(
      () => new Promise<LoadResult>((res) => (resolveLoad = res)),
    );

    const renderer = makeRenderer();
    const scene = new MainMenuScene(renderer);
    scene.initialize({});
    scene.destroy();

    resolveLoad(fakeTexture); // texture arrives AFTER destroy
    await Promise.resolve();

    expect(vi.mocked(Sprite).mock.calls.length).toBe(0);
  });
});
