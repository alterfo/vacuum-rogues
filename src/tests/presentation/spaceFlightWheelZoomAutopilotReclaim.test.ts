import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    blendMode: "normal",
    sortableChildren: false,
    rotation: 0,
    x: 0,
    y: 0,
    alpha: 1,
    zIndex: 0,
    scale: { set: vi.fn() },
    filters: [],
    hitArea: null,
    mask: null,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    FederatedPointerEvent: class {},
  };
});

vi.mock("@/presentation/sphereMesh", () => ({
  buildSphereMesh: vi.fn().mockReturnValue(null),
}));
vi.mock("@/presentation/PlanetSprite", () => ({ PlanetSprite: vi.fn() }));
vi.mock("@/presentation/PlanetInfoPanel", () => ({ PlanetInfoPanel: vi.fn() }));
vi.mock("@/presentation/SystemMiniMap", () => ({ SystemMiniMap: vi.fn() }));
vi.mock("@/presentation/QuestJournalUI", () => ({ QuestJournalUI: vi.fn() }));
vi.mock("@/presentation/NpcShipSprite", () => ({ NpcShipSprite: vi.fn() }));
vi.mock("@/presentation/NpcContactPanel", () => ({ NpcContactPanel: vi.fn() }));
vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));
vi.mock("@/presentation/cursor", () => ({
  installGameCursors: vi.fn(),
  setCanvasCursor: vi.fn(),
}));

import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import {
  AutopilotController,
  type AutopilotScheduler,
} from "@/tests/playtest/letsplay/AutopilotController";
import type { LiveSceneController } from "@/tests/playtest/letsplay/LiveApplier";
import type { PlayerPolicy } from "@/tests/playtest/letsplay/PlayerPolicy";
import type { Observation } from "@/tests/playtest/letsplay/observe";
import type { Renderer } from "@/presentation/Renderer";

const inertScheduler: AutopilotScheduler = { start: () => () => {} };

function makeMockRenderer(): Renderer {
  return {
    app: {
      screen: { width: 800, height: 600 },
      canvas: Object.assign(document.createElement("canvas"), {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        style: {},
      }),
      stage: {
        eventMode: "static",
        hitArea: null,
        addChild: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    gameLayer: {
      addChild: vi.fn(),
      addChildAt: vi.fn(),
      removeChild: vi.fn(),
      children: [],
    },
    uiLayer: {
      addChild: vi.fn(),
      addChildAt: vi.fn(),
      removeChild: vi.fn(),
      children: [],
    },
    stage: { addChild: vi.fn(), addChildAt: vi.fn() },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as Renderer;
}

function primeSceneForWheel(scene: SpaceFlightScene): {
  zoomAtClient: ReturnType<typeof vi.fn>;
} {
  const s = scene as unknown as Record<string, unknown>;
  const zoomAtClient = vi.fn();
  s.camera = { zoomAtClient };
  s.npcManager = { hasOpenModal: () => false };
  s.hud = {
    isQuestJournalOpen: () => false,
    isSettingsPanelOpen: () => false,
    isSystemModalOpen: () => false,
  };
  s.planetManager = { hasInfoPanel: false };
  return { zoomAtClient };
}

describe("SpaceFlightScene.onWheel: handler-level behavior", () => {
  it("stops immediate propagation and forwards the gesture to the camera", () => {
    const scene = new SpaceFlightScene(makeMockRenderer());
    const { zoomAtClient } = primeSceneForWheel(scene);

    const event = {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    } as unknown as WheelEvent;

    (scene as unknown as { onWheel(e: WheelEvent): void }).onWheel(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(zoomAtClient).toHaveBeenCalledWith(-100, 400, 300);
  });

  it("does not stop propagation while a blocking modal is open (journal keeps its own wheel scroll)", () => {
    const scene = new SpaceFlightScene(makeMockRenderer());
    const { zoomAtClient } = primeSceneForWheel(scene);
    (scene as unknown as Record<string, unknown>).hud = {
      isQuestJournalOpen: () => true,
      isSettingsPanelOpen: () => false,
      isSystemModalOpen: () => false,
    };

    const event = {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    } as unknown as WheelEvent;

    (scene as unknown as { onWheel(e: WheelEvent): void }).onWheel(event);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(zoomAtClient).not.toHaveBeenCalled();
  });
});

describe("SpaceFlightScene wheel-zoom vs. the real dev autopilot: DOM integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  function attachRealOnWheel(scene: SpaceFlightScene): () => void {
    const bound = (
      scene as unknown as { onWheel: (e: WheelEvent) => void }
    ).onWheel.bind(scene);
    window.addEventListener("wheel", bound, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", bound, { capture: true });
  }

  it("a real wheel gesture zooms and leaves an ALREADY-ENGAGED autopilot untouched (post-warp listener order)", () => {
    const controller = new AutopilotController({
      observe: () => ({}) as unknown as Observation,
      policy: { decide: vi.fn() } as unknown as PlayerPolicy,
      controller: {} as LiveSceneController,
      scheduler: inertScheduler,
    });
    controller.start();
    expect(controller.isEngaged).toBe(true);

    const scene = new SpaceFlightScene(makeMockRenderer());
    const { zoomAtClient } = primeSceneForWheel(scene);
    const detach = attachRealOnWheel(scene); // registered AFTER the autopilot

    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);

    try {
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          clientX: 400,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(zoomAtClient).toHaveBeenCalledWith(-100, 400, 300);
      expect(controller.isEngaged).toBe(true); // still flying — not reclaimed
    } finally {
      detach();
      controller.stop();
    }
  });
});
