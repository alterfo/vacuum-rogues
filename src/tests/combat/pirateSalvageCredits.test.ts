import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import { pirateSalvageAmount } from "@/systems/combat/pirateSalvage";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { setupPlayerBanking } from "@/systems/banking/economy";
import { PlayerService } from "@/core/services/PlayerService";
import { FactionType } from "@/types";
import { BALANCE_EPSILON } from "@/domain/banking/Ledger";
import { GAME_BALANCE } from "@/config/balance";
import { PlayerSchema } from "@/validation/schemas";

describe("pirateSalvageAmount — pure salvage math + anti-farm cap", () => {
  it("awards a whole-credit fraction of the wreck's cash (floored)", () => {
    expect(pirateSalvageAmount(1000, 0.5, 0, 10_000)).toBe(500);
    expect(pirateSalvageAmount(999, 0.5, 0, 10_000)).toBe(499);
    expect(Number.isInteger(pirateSalvageAmount(777, 0.5, 0, 10_000))).toBe(
      true,
    );
  });

  it("never pays negative for an empty/negative wreck", () => {
    expect(pirateSalvageAmount(0, 0.5, 0, 10_000)).toBe(0);
    expect(pirateSalvageAmount(-100, 0.5, 0, 10_000)).toBe(0);
  });

  it("clamps to the remaining daily budget (anti-farm cap)", () => {
    expect(pirateSalvageAmount(1000, 0.5, 800, 1000)).toBe(200);
    expect(pirateSalvageAmount(1000, 0.5, 1000, 1000)).toBe(0);
    expect(pirateSalvageAmount(1000, 0.5, 1200, 1000)).toBe(0);
  });
});

function makeHarness(startingMoney = 1000): {
  manager: NpcShipManager;
  engine: GameEngine;
  player: import("@/domain/Player").Player;
  service: BankingService;
  galaxy: { npcShips: unknown[]; id: string; gameDays: number };
  messages: string[];
  renderer: Renderer;
  deps: NpcShipManagerDeps;
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
  (player as unknown as { currentSystemId: string }).currentSystemId =
    "core_sys";

  const galaxy = { npcShips: [] as unknown[], id: "g1", gameDays: 0 };
  const messages: string[] = [];
  const engine = {
    galaxy,
    player,
    bank: { bus, service },
    transitionTo: () => {},
    showGameOutcomeScreen: () => {},
  } as unknown as GameEngine;

  const deps: NpcShipManagerDeps = {
    getShipPhysics: () => null,
    getPlanetSprites: () => [],
    getStarCenter: () => ({ x: 400, y: 300 }),
    isTurnRunning: () => true,
    showMessage: (m: string) => messages.push(m),
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
  return { manager, engine, player, service, galaxy, messages, renderer, deps };
}

function spawnPirateSprite(
  manager: NpcShipManager,
  id: string,
  credits: number,
): NpcShipSprite {
  (
    manager as unknown as { spawnOvermindCoreCombatant(): void }
  ).spawnOvermindCoreCombatant();
  const sprites = (manager as unknown as { npcSprites: NpcShipSprite[] })
    .npcSprites;
  const sprite = sprites[sprites.length - 1];
  (sprite as unknown as { npc: { id: string; credits: number } }).npc.id = id;
  (sprite as unknown as { npc: { credits: number } }).npc.credits = credits;
  return sprite;
}

describe("salvage through handleInFlightDeath — ledger payout, not direct mutation", () => {
  it("pays a fraction of the wreck via the ledger (player.credits rises by the salvage; books balanced; whole credits)", () => {
    const { manager, player, service, messages } = makeHarness(1000);
    const before = player.credits;

    const sprite = spawnPirateSprite(manager, "pirate_1", 1000);
    manager.handleInFlightDeath(sprite, () => 0.99); // 0.99 ⇒ no loot drop

    const expected = Math.floor(1000 * GAME_BALANCE.pirateSalvageFraction);
    expect(expected).toBeGreaterThan(0);
    expect(player.credits).toBe(before + expected);
    expect(Number.isInteger(player.credits)).toBe(true);
    expect(PlayerSchema.shape.credits.safeParse(player.credits).success).toBe(
      true,
    );
    expect(Math.abs(service.getLedger().totalBalance())).toBeLessThanOrEqual(
      BALANCE_EPSILON,
    );
    expect(player.credits).toBe(service.balanceOf(player.currentAccountId));
    expect(messages.some((m) => m.includes(String(expected)))).toBe(true);

    manager.destroy();
  });

  it("pays NO salvage for an NPC-vs-NPC crossfire kill (killedByPlayer=false)", () => {
    const { manager, player, messages } = makeHarness(1000);
    const before = player.credits;
    const sprite = spawnPirateSprite(manager, "pirate_crossfire", 1000);
    manager.handleInFlightDeath(sprite, () => 0.99, false);
    expect(player.credits).toBe(before);
    expect(messages.some((m) => m.includes("Трофей"))).toBe(false);
    manager.destroy();
  });

  it("does not pay for a wreck with no credits", () => {
    const { manager, player } = makeHarness(1000);
    const before = player.credits;
    const sprite = spawnPirateSprite(manager, "pirate_broke", 0);
    manager.handleInFlightDeath(sprite, () => 0.99);
    expect(player.credits).toBe(before);
    manager.destroy();
  });

  it("caps salvage per galaxy day, then resets when the day advances", () => {
    const { manager, engine, player, galaxy } = makeHarness(0);
    const cap = GAME_BALANCE.pirateSalvageDailyCap;
    const fraction = GAME_BALANCE.pirateSalvageFraction;

    for (let i = 0; i < 30; i++) {
      const sprite = spawnPirateSprite(manager, `pirate_d0_${i}`, 1000);
      manager.handleInFlightDeath(sprite, () => 0.99);
    }
    expect(player.credits).toBe(cap);

    galaxy.gameDays = 1;
    const sprite = spawnPirateSprite(manager, "pirate_d1", 1000);
    manager.handleInFlightDeath(sprite, () => 0.99);
    expect(player.credits).toBe(cap + Math.floor(1000 * fraction));

    void engine;
    manager.destroy();
  });

  it("cap survives a scene rebuild (warp / land→take-off) — not a per-system faucet", () => {
    const { manager, engine, player, galaxy, renderer, deps } = makeHarness(0);
    const cap = GAME_BALANCE.pirateSalvageDailyCap;

    for (let i = 0; i < 30; i++) {
      const sprite = spawnPirateSprite(manager, `pirate_a_${i}`, 1000);
      manager.handleInFlightDeath(sprite, () => 0.99);
    }
    expect(player.credits).toBe(cap);
    manager.destroy();

    const manager2 = new NpcShipManager(
      renderer,
      engine,
      (renderer as unknown as { gameLayer: Container }).gameLayer,
      (renderer as unknown as { uiLayer: Container }).uiLayer,
      deps,
    );
    manager2.initialize();
    const after = player.credits;
    const sprite = spawnPirateSprite(manager2, "pirate_b", 1000);
    manager2.handleInFlightDeath(sprite, () => 0.99);
    expect(player.credits).toBe(after); // still capped — no per-system reset

    galaxy.gameDays = 1;
    const sprite2 = spawnPirateSprite(manager2, "pirate_b_d1", 1000);
    manager2.handleInFlightDeath(sprite2, () => 0.99);
    expect(player.credits).toBe(
      cap + Math.floor(1000 * GAME_BALANCE.pirateSalvageFraction),
    );

    manager2.destroy();
  });
});
