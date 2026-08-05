import { describe, it, expect } from "vitest";
import { WarpPath } from "@/domain/WarpPath";
import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import { travelDays } from "@/systems/npc/npcTravel";

const sys = (
  id: string,
  q: number,
  r: number,
  connections: WarpPath[] = [],
): StarSystem =>
  ({ id, coordinates: { q, r }, connections }) as unknown as StarSystem;

const galaxyOf = (systems: StarSystem[]): Galaxy =>
  ({ systems }) as unknown as Galaxy;

describe("travelDays", () => {
  it("uses the rounded warp fuel cost when the systems are connected", () => {
    const g = galaxyOf([
      sys("a", 0, 0, [new WarpPath("a", "b", 3.4)]),
      sys("b", 100, 0),
    ]);
    expect(travelDays(g, "a", "b")).toBe(3);
  });

  it("floors the connected-path cost at 1 day for a sub-1 fuel cost", () => {
    const g = galaxyOf([
      sys("a", 0, 0, [new WarpPath("a", "b", 0.2)]),
      sys("b", 100, 0),
    ]);
    expect(travelDays(g, "a", "b")).toBe(1);
  });

  it("falls back to rounded coordinate distance / 10 when not warp-connected", () => {
    const g = galaxyOf([sys("a", 0, 0), sys("b", 50, 0)]);
    expect(travelDays(g, "a", "b")).toBe(5);
  });

  it("floors the distance fallback at 1 day for adjacent coordinates", () => {
    const g = galaxyOf([sys("a", 0, 0), sys("b", 1, 0)]);
    expect(travelDays(g, "a", "b")).toBe(1);
  });

  it("returns 1 when the source system id is unknown", () => {
    const g = galaxyOf([sys("b", 50, 0)]);
    expect(travelDays(g, "missing", "b")).toBe(1);
  });

  it("returns 1 when the destination system id is unknown and no connection exists", () => {
    const g = galaxyOf([sys("a", 0, 0)]);
    expect(travelDays(g, "a", "missing")).toBe(1);
  });
});
