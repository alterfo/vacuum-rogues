import { describe, it, expect } from "vitest";
import { NpcShip } from "@/domain/NpcShip";
import { NpcShipSchema } from "@/validation/schemas";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import { deterministicNpcOffset } from "@/systems/npc/npcPlacement";
import { SYSTEM_GEOMETRY } from "@/config/balance";
import { NpcState, NpcRole, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import type { SaveState } from "@/domain/SaveState";

function makeNpc(id: string): NpcShip {
  return new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 50,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_x",
    state: NpcState.IDLE,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("NpcShip persistent world position", () => {
  it("defaults to no world position until placed", () => {
    const npc = makeNpc("npc_1");
    expect(npc.worldX).toBeNull();
    expect(npc.worldY).toBeNull();
    expect(npc.hasWorldPosition()).toBe(false);
  });

  it("mutates position only via the explicit setter", () => {
    const npc = makeNpc("npc_1");
    npc.setWorldPosition(123, -456);
    expect(npc.worldX).toBe(123);
    expect(npc.worldY).toBe(-456);
    expect(npc.hasWorldPosition()).toBe(true);
  });

  it("treats an absent (undefined) position as unplaced — no NaN spawn", () => {
    const npc = makeNpc("npc_1");
    (npc as unknown as { worldX: unknown }).worldX = undefined;
    (npc as unknown as { worldY: unknown }).worldY = undefined;
    expect(npc.hasWorldPosition()).toBe(false);
  });

  it("round-trips the position through the schema (persists)", () => {
    const npc = makeNpc("npc_1");
    npc.setWorldPosition(742.5, -118.25);
    const json = JSON.parse(JSON.stringify(npc));
    const parsed = NpcShipSchema.parse(json);
    expect(parsed.worldX).toBe(742.5);
    expect(parsed.worldY).toBe(-118.25);
  });

  it("validates an old save shape (no world position) to null defaults", () => {
    const npc = makeNpc("npc_1");
    const json = JSON.parse(JSON.stringify(npc)) as Record<string, unknown>;
    delete json.worldX;
    delete json.worldY;
    const parsed = NpcShipSchema.parse(json);
    expect(parsed.worldX).toBeNull();
    expect(parsed.worldY).toBeNull();
  });
});

describe("deterministicNpcOffset", () => {
  it("is reproducible for the same galaxy seed + ship id", () => {
    const a = deterministicNpcOffset("galaxy-seed", "npc_7");
    const b = deterministicNpcOffset("galaxy-seed", "npc_7");
    expect(a).toEqual(b);
  });

  it("differs by ship id and by galaxy seed", () => {
    const base = deterministicNpcOffset("galaxy-seed", "npc_7");
    expect(deterministicNpcOffset("galaxy-seed", "npc_8")).not.toEqual(base);
    expect(deterministicNpcOffset("other-seed", "npc_7")).not.toEqual(base);
  });

  it("places the ship inside the interior wander band", () => {
    const pos = deterministicNpcOffset("galaxy-seed", "npc_7");
    const radius = Math.hypot(pos.x, pos.y);
    expect(radius).toBeGreaterThanOrEqual(SYSTEM_GEOMETRY.innerRadius);
    expect(radius).toBeLessThanOrEqual(SYSTEM_GEOMETRY.outerRadius);
  });
});

describe("MigrationPipeline v23 -> v24 NPC positions", () => {
  function oldSave(): SaveState {
    return {
      version: 23,
      galaxy: {
        id: "galaxy-abc",
        npcShips: [{ id: "npc_a" }, { id: "npc_b" }],
      },
    } as unknown as SaveState;
  }

  it("seeds a deterministic position for ships that lack one", () => {
    const migrated = MigrationPipeline.migrate(oldSave());
    const ships = (
      migrated.galaxy as unknown as {
        npcShips: Array<{ id: string; worldX: number; worldY: number }>;
      }
    ).npcShips;
    const a = deterministicNpcOffset("galaxy-abc", "npc_a");
    const b = deterministicNpcOffset("galaxy-abc", "npc_b");
    expect(ships[0].worldX).toBe(a.x);
    expect(ships[0].worldY).toBe(a.y);
    expect(ships[1].worldX).toBe(b.x);
    expect(ships[1].worldY).toBe(b.y);
  });

  it("is deterministic across repeated migrations (not random)", () => {
    const first = MigrationPipeline.migrate(oldSave());
    const second = MigrationPipeline.migrate(oldSave());
    const pos = (s: SaveState, i: number) =>
      (
        s.galaxy as unknown as {
          npcShips: Array<{ worldX: number; worldY: number }>;
        }
      ).npcShips[i];
    expect(pos(first, 0)).toEqual(pos(second, 0));
    expect(pos(first, 1)).toEqual(pos(second, 1));
  });

  it("preserves a position the ship already has (idempotent)", () => {
    const save = {
      version: 23,
      galaxy: {
        id: "galaxy-abc",
        npcShips: [{ id: "npc_a", worldX: 11, worldY: 22 }],
      },
    } as unknown as SaveState;
    const migrated = MigrationPipeline.migrate(save);
    const ship = (
      migrated.galaxy as unknown as {
        npcShips: Array<{ worldX: number; worldY: number }>;
      }
    ).npcShips[0];
    expect(ship.worldX).toBe(11);
    expect(ship.worldY).toBe(22);
  });

  it("re-seeds an explicit-null position (not just a missing field)", () => {
    const save = {
      version: 23,
      galaxy: {
        id: "galaxy-abc",
        npcShips: [{ id: "npc_a", worldX: null, worldY: null }],
      },
    } as unknown as SaveState;
    const migrated = MigrationPipeline.migrate(save);
    const ship = (
      migrated.galaxy as unknown as {
        npcShips: Array<{ worldX: number; worldY: number }>;
      }
    ).npcShips[0];
    const expected = deterministicNpcOffset("galaxy-abc", "npc_a");
    expect(ship.worldX).toBe(expected.x);
    expect(ship.worldY).toBe(expected.y);
  });

  it("does not crash on a galaxy with no npcShips array", () => {
    const save = {
      version: 23,
      galaxy: { id: "galaxy-abc" },
    } as unknown as SaveState;
    const migrated = MigrationPipeline.migrate(save);
    expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);
  });

  it("does not crash on a save with no galaxy", () => {
    const save = { version: 23 } as unknown as SaveState;
    const migrated = MigrationPipeline.migrate(save);
    expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);
  });
});
