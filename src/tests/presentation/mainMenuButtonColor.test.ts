/**
 * UX finding #12: the «Новая игра» primary button used the `createButton`
 * default green (0x00ff00), clashing with the cyan accent family every other
 * menu button uses. It must render in the cyan family (high blue channel), not
 * green (zero blue), so the menu reads as one consistent accent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { Text } from "pixi.js";
import { t } from "@/i18n/i18n";

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
    // Unlike mainMenuVisuals' mock, keep the passed style so we can read `fill`.
    Text: vi
      .fn()
      .mockImplementation((opts?: { text?: string; style?: unknown }) => ({
        ...node(),
        text: opts?.text ?? "",
        style: opts?.style ?? {},
      })),
  };
});

vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(undefined),
  pickVariantKey: vi.fn().mockReturnValue(undefined),
  tex: vi.fn().mockReturnValue(undefined),
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

describe("MainMenuScene — «Новая игра» button color", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the primary button in the cyan family, not green", () => {
    const scene = new MainMenuScene(makeRenderer());
    scene.initialize({});

    const opts = vi
      .mocked(Text)
      .mock.calls.map(
        (c) => c[0] as unknown as { text?: string; style?: { fill?: number } },
      )
      .find((o) => o?.text === t("menu.newGame"));
    expect(opts).toBeDefined();

    const fill = opts!.style?.fill;
    expect(typeof fill).toBe("number");

    // Green 0x00ff00 has a zero blue channel; a cyan-family accent has a strong
    // blue channel. Assert the button is not green and is cyan.
    const blue = (fill as number) & 0xff;
    const green = ((fill as number) >> 8) & 0xff;
    expect(fill).not.toBe(0x00ff00);
    expect(blue).toBeGreaterThanOrEqual(0x88); // strong blue → cyan, not green
    expect(green).toBeGreaterThanOrEqual(0x88); // still bright (cyan, not pure blue)

    scene.destroy();
  });
});
