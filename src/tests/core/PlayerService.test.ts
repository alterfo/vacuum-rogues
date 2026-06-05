import { describe, it, expect, beforeEach } from "vitest";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType } from "@/types";

describe("PlayerService", () => {
  let service: PlayerService;

  beforeEach(() => {
    service = new PlayerService();
  });

  it("should create a player with default values", () => {
    const player = service.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });

    expect(player).toBeDefined();
    expect(player.name).toBe("Captain");
    expect(player.credits).toBe(1000);
    expect(player.faction).toBe(FactionType.OUTLANDERS);
    expect(player.currentSystemId).toBe("");
  });

  it("should create a player with custom settings", () => {
    const player = service.createPlayer({
      factionType: FactionType.BASTIONS,
      captainName: "Korg",
      startingMoney: 5000,
    });

    expect(player.name).toBe("Korg");
    expect(player.credits).toBe(5000);
    expect(player.faction).toBe(FactionType.BASTIONS);
  });

  it("should return created player via getPlayer", () => {
    const player = service.createPlayer({ factionType: FactionType.SYNDICATE });
    expect(service.getPlayer()).toBe(player);
  });

  it("should return null when no player exists", () => {
    expect(service.getPlayer()).toBeNull();
  });

  it("should update player", () => {
    const player = service.createPlayer({
      factionType: FactionType.OUTLANDERS,
    });
    player.credits = 9999;
    service.updatePlayer(player);

    expect(service.getPlayer()!.credits).toBe(9999);
  });

  it("should delete player", () => {
    service.createPlayer({ factionType: FactionType.OUTLANDERS });
    service.deletePlayer();

    expect(service.getPlayer()).toBeNull();
  });
});
