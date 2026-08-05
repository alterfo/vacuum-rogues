import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { setupPlayerBanking } from "@/systems/banking/economy";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType } from "@/types";
import { PIRATE_FACTION_ID } from "@/systems/galaxy/landingAccess";
import { PIRATE_TRIBUTE_REP_GAIN } from "@/config/balance";

function makeManager(startingMoney: number): {
  manager: NpcShipManager;
  player: import("@/domain/Player").Player;
} {
  const stage = new Container();
  const uiLayer = new Container();
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage,
    uiLayer,
    gameLayer,
  } as unknown as Renderer;

  const bus = new BankBus();
  const service = new BankingService(bus, { startDate: 1 });
  const player = new PlayerService().createPlayer({
    factionType: FactionType.OUTLANDERS,
    captainName: "Captain",
    startingMoney,
  });
  setupPlayerBanking(bus, service, player);

  const engine = {
    galaxy: { npcShips: [], id: "g1", gameDays: 0 },
    player,
    bank: { bus, service },
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    executeRouteTo: () => {},
    clearRouteTarget: () => {},
    endTurn: () => {},
    startInFlightCombat: () => {},
    selectCombatTarget: () => {},
  };

  const manager = new NpcShipManager(
    renderer,
    engine,
    gameLayer,
    uiLayer,
    deps,
  );
  manager.initialize();
  return { manager, player };
}

function payTributeTo(manager: NpcShipManager, id: string): void {
  const npc = { id, name: "Бандит", credits: 200 } as unknown as NpcShip;
  (manager as unknown as { onPayTribute(n: NpcShip): void }).onPayTribute(npc);
}

describe("onPayTribute — pirate standing is bought, not free", () => {
  it("a penniless player (tribute 0) gains NO pirate rep", () => {
    const { manager, player } = makeManager(0);
    const before = player.getReputation(PIRATE_FACTION_ID);
    payTributeTo(manager, "pirate_broke");
    expect(player.getReputation(PIRATE_FACTION_ID)).toBe(before);
    manager.destroy();
  });

  it("a real (non-zero) payoff raises pirate rep by the fixed gain", () => {
    const { manager, player } = makeManager(1000);
    const before = player.getReputation(PIRATE_FACTION_ID);
    payTributeTo(manager, "pirate_paid");
    expect(player.getReputation(PIRATE_FACTION_ID)).toBe(
      before + PIRATE_TRIBUTE_REP_GAIN,
    );
    manager.destroy();
  });
});
