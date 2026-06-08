import { describe, it, expect, vi } from "vitest";

// PlanetScene imports pixi.js at module load; mock it so the pure helper can be
// imported without a real renderer.
vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
}));

import { visiblePlanetServices } from "@/presentation/PlanetScene";

const ALL = [
  { label: "Губернатор" },
  { label: "Верфь" },
  { label: "Маркет" },
  { label: "Исследования" },
  { label: "Взлёт" },
];

describe("visiblePlanetServices (US-070 #12)", () => {
  it("shows the full service set on inhabited worlds", () => {
    expect(visiblePlanetServices(true, ALL)).toEqual(ALL);
  });

  it("shows only take-off on uninhabited worlds (no garage/research/market)", () => {
    const visible = visiblePlanetServices(false, ALL);
    expect(visible.map((b) => b.label)).toEqual(["Взлёт"]);
  });
});
