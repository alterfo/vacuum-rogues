import { describe, it, expect } from "vitest";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionType, type GameMode } from "@/types";
import { PlayerSchema } from "@/validation/schemas";
import { MigrationPipeline } from "@/data/MigrationPipeline";
import type { SaveState } from "@/domain/SaveState";

function makePlayer(): Player {
  return new Player(
    "player",
    "Captain",
    FactionType.OUTLANDERS,
    0,
    1,
    new SkillTree([]),
    {},
    { activeQuests: [], completedQuests: [] },
    { entries: [] },
    1000,
    new PlayerShip(
      "Ranger-1",
      "Ranger-1",
      100,
      100,
      50,
      50,
      100,
      100,
      1.0,
      0.8,
      FactionType.OUTLANDERS,
    ),
    new Inventory(),
    "",
  );
}

describe("Player.gameMode", () => {
  it("defaults to NORMAL on a freshly constructed player", () => {
    expect(makePlayer().gameMode).toBe("NORMAL");
  });

  it("is mutated only via setGameMode", () => {
    const player = makePlayer();
    player.setGameMode("GOD");
    expect(player.gameMode).toBe("GOD");
    player.setGameMode("HARD");
    expect(player.gameMode).toBe("HARD");
  });

  it("setGameMode accepts every GameMode value", () => {
    const modes: GameMode[] = ["GOD", "NORMAL", "HARD"];
    for (const mode of modes) {
      const player = makePlayer();
      player.setGameMode(mode);
      expect(player.gameMode).toBe(mode);
    }
  });
});

describe("PlayerSchema.gameMode persistence", () => {
  it("round-trips a chosen mode through serialize → parse", () => {
    const player = makePlayer();
    player.setGameMode("GOD");

    // Mirror SaveState.serialize/deserialize: JSON stringify then parse.
    const json = JSON.parse(JSON.stringify(player));
    expect(json.gameMode).toBe("GOD");

    const parsed = PlayerSchema.parse(json);
    expect(parsed.gameMode).toBe("GOD");
  });

  it("defaults to NORMAL when the field is absent (old player JSON)", () => {
    const player = makePlayer();
    const json = JSON.parse(JSON.stringify(player)) as Record<string, unknown>;
    delete json.gameMode;

    const parsed = PlayerSchema.parse(json);
    expect(parsed.gameMode).toBe("NORMAL");
  });

  it("rejects an unknown mode value", () => {
    const player = makePlayer();
    const json = JSON.parse(JSON.stringify(player)) as Record<string, unknown>;
    json.gameMode = "INSANE";
    expect(() => PlayerSchema.parse(json)).toThrow();
  });
});

describe("MigrationPipeline gameMode default", () => {
  it("backfills gameMode = NORMAL on a save that predates the field", () => {
    const player = makePlayer();
    const playerJson = JSON.parse(JSON.stringify(player)) as Record<
      string,
      unknown
    >;
    delete playerJson.gameMode;
    expect(playerJson.gameMode).toBeUndefined();

    const state = {
      version: 26,
      timestamp: 1_000_000,
      persistentDialogs: [],
      galaxy: {},
      player: playerJson,
    } as unknown as SaveState;

    const migrated = MigrationPipeline.migrate(state);
    expect(migrated.version).toBe(MigrationPipeline.CURRENT_VERSION);
    expect((migrated.player as unknown as { gameMode?: string }).gameMode).toBe(
      "NORMAL",
    );
  });

  it("leaves an already-set gameMode untouched (idempotent)", () => {
    const player = makePlayer();
    player.setGameMode("HARD");
    const playerJson = JSON.parse(JSON.stringify(player));

    const state = {
      version: 26,
      timestamp: 1_000_000,
      persistentDialogs: [],
      galaxy: {},
      player: playerJson,
    } as unknown as SaveState;

    const migrated = MigrationPipeline.migrate(state);
    expect((migrated.player as unknown as { gameMode?: string }).gameMode).toBe(
      "HARD",
    );
  });
});
