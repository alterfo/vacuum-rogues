import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "pixi.js";

const pickVariant = vi.fn().mockReturnValue(null);
vi.mock("@/presentation/textures", () => ({
  pickVariant: (...args: unknown[]) => pickVariant(...args),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));

import { resolveHullArtKey } from "@/presentation/flight/hullArtAlias";
import { PlayerShipRenderer } from "@/presentation/flight/PlayerShipRenderer";
import { ShipPhysics } from "@/systems/ShipPhysics";
import type { Renderer } from "@/presentation/Renderer";

describe("heavy_freighter art alias (interim, pending art regeneration)", () => {
  beforeEach(() => {
    pickVariant.mockClear();
  });

  it("resolveHullArtKey aliases heavy_freighter to transport and leaves others untouched", () => {
    expect(resolveHullArtKey("heavy_freighter")).toBe("transport");
    expect(resolveHullArtKey("cruiser")).toBe("destroyer");
    expect(resolveHullArtKey("scout")).toBe("scout");
  });

  it("PlayerShipRenderer resolves hull_freighter art through the alias, not heavy_freighter/ranger", () => {
    const gameLayer = new Container();
    const renderer = {
      app: { screen: { width: 800, height: 600 } },
      gameLayer,
    } as unknown as Renderer;
    const physics = new ShipPhysics(0, 0, 0.1);

    const ship = new PlayerShipRenderer(
      renderer,
      gameLayer,
      physics,
      "HEAVY_FREIGHTER",
    );
    ship.initialize();

    const [category, key] = pickVariant.mock.calls[0];
    expect(category).toBe("player_ships");
    expect(key).toBe("transport");
    expect(key).not.toBe("heavy_freighter");
    expect(key).not.toBe("ranger");

    ship.destroy();
  });
});
