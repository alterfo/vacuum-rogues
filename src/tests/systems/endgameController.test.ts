import { describe, it, expect, vi } from "vitest";
import {
  EndgameController,
  type EndgameControllerDeps,
} from "@/systems/EndgameController";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { Galaxy } from "@/domain/Galaxy";
import { StarSystem } from "@/domain/StarSystem";
import { Overmind } from "@/domain/Overmind";
import { StarType, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { BankBus } from "@/systems/banking/bus";
import { BankingService } from "@/systems/banking/BankingService";
import { FlightSessionState } from "@/systems/FlightSessionState";
import { MusicDriver } from "@/systems/audio/musicDriver";
import { HullAlarm } from "@/systems/audio/sfxCues";
import {
  MockGalaxyService,
  MockPlayerService,
  MockQuestService,
} from "@/tests/mocks";

function makeSystem(id: string): StarSystem {
  return new StarSystem(
    id,
    `System ${id}`,
    { q: 0, r: 0 },
    StarType.YELLOW_DWARF,
    [],
    Faction.INDEPENDENT,
    [],
  );
}

function makeGalaxy(): Galaxy {
  return new Galaxy(
    "g_endgame",
    [makeSystem("core"), makeSystem("home")],
    new Overmind(),
    [],
    [],
    ["core"], // overmindSystems
    "core", // overmindCoreSystemId
  );
}

function makePlayer(
  overrides: { rank?: number; alliedFactions?: number } = {},
): Player {
  const player = new Player(
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
  player.rank = overrides.rank ?? 2;
  const factions = Object.values(FactionType).filter(
    (f) => f !== FactionType.OUTLANDERS,
  );
  const allied = overrides.alliedFactions ?? factions.length;
  for (let i = 0; i < allied; i++) {
    (player.reputation as Record<string, number>)[factions[i]] = 80;
  }
  return player;
}

function makeDeps(
  overrides: Partial<EndgameControllerDeps> = {},
): EndgameControllerDeps & {
  state: { player: Player | null; galaxy: Galaxy | null };
} {
  const bankBus = new BankBus();
  const bankingService = new BankingService(bankBus);
  const state: { player: Player | null; galaxy: Galaxy | null } = {
    player: null,
    galaxy: null,
  };
  const deps: EndgameControllerDeps = {
    getPlayer: () => state.player,
    setPlayer: (p) => {
      state.player = p;
    },
    setPlayerLoadout: vi.fn(),
    getGalaxy: () => state.galaxy,
    setGalaxy: (g) => {
      state.galaxy = g;
    },
    galaxyService: new MockGalaxyService(),
    playerService: new MockPlayerService(),
    questManager: new MockQuestService(),
    bankingService,
    sessionState: new FlightSessionState(),
    music: new MusicDriver(),
    hullAlarm: new HullAlarm(),
    clearFlightPositions: vi.fn(),
    clearCombatStateProvider: vi.fn(),
    overlay: {
      showError: vi.fn(),
      showLoading: vi.fn(),
      hideLoading: vi.fn(),
      showGameOutcome: vi.fn(),
      dismissAll: vi.fn(),
    },
    hasRenderer: () => true,
    getPlayerDeathCallback: () => undefined,
    transitionToMainMenu: vi.fn().mockResolvedValue(undefined),
    transitionToSpaceFlight: vi.fn().mockResolvedValue(undefined),
    transitionToGameOver: vi.fn().mockResolvedValue(undefined),
    transitionToRaceSelection: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return Object.assign(deps, { state });
}

describe("EndgameController.checkWinCondition", () => {
  it("false with no player", () => {
    const deps = makeDeps();
    expect(new EndgameController(deps).checkWinCondition()).toBe(false);
  });

  it("false below veteran rank", () => {
    const deps = makeDeps();
    deps.state.player = makePlayer({ rank: 1 });
    expect(new EndgameController(deps).checkWinCondition()).toBe(false);
  });

  it("false with fewer than 3 allied factions", () => {
    const deps = makeDeps();
    deps.state.player = makePlayer({ rank: 2, alliedFactions: 2 });
    expect(new EndgameController(deps).checkWinCondition()).toBe(false);
  });

  it("true at veteran rank with 3+ allied factions", () => {
    const deps = makeDeps();
    deps.state.player = makePlayer({ rank: 2, alliedFactions: 3 });
    expect(new EndgameController(deps).checkWinCondition()).toBe(true);
  });
});

describe("EndgameController.showGameOutcomeScreen", () => {
  it("liberates the core + flips arc status to won on a win", () => {
    const deps = makeDeps();
    deps.state.galaxy = makeGalaxy();
    new EndgameController(deps).showGameOutcomeScreen(true);
    expect(deps.state.galaxy.overmindSystems).not.toContain("core");
    expect(deps.state.galaxy.overmindArc.status).toBe("won");
    expect(deps.overlay.showGameOutcome).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        onRestart: expect.any(Function),
        onNewGamePlus: expect.any(Function),
      }),
    );
  });

  it("does not offer New Game+ on a loss", () => {
    const deps = makeDeps();
    deps.state.galaxy = makeGalaxy();
    new EndgameController(deps).showGameOutcomeScreen(false);
    expect(deps.overlay.showGameOutcome).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ onNewGamePlus: undefined }),
    );
  });

  it("is idempotent — a second call is a no-op", () => {
    const deps = makeDeps();
    deps.state.galaxy = makeGalaxy();
    const controller = new EndgameController(deps);
    controller.showGameOutcomeScreen(true);
    controller.showGameOutcomeScreen(false);
    expect(deps.overlay.showGameOutcome).toHaveBeenCalledTimes(1);
  });

  it("onRestart resets game state then transitions to the main menu", async () => {
    const deps = makeDeps();
    deps.state.galaxy = makeGalaxy();
    new EndgameController(deps).showGameOutcomeScreen(false);
    const { onRestart } = (
      deps.overlay.showGameOutcome as ReturnType<typeof vi.fn>
    ).mock.calls[0][1];
    onRestart();
    await vi.waitFor(() =>
      expect(deps.transitionToMainMenu).toHaveBeenCalledTimes(1),
    );
    expect(deps.state.player).toBeNull();
  });
});

describe("EndgameController.startNewGamePlus", () => {
  it("stages a carry, resets state, and transitions to flight", async () => {
    const deps = makeDeps();
    deps.state.player = makePlayer({ rank: 2, alliedFactions: 3 });
    deps.state.player.credits = 20000;
    const controller = new EndgameController(deps);
    await controller.startNewGamePlus();
    expect(controller.pendingNewGamePlus).not.toBeNull();
    expect(controller.pendingNewGamePlus?.rank).toBe(2);
    expect(deps.state.player).toBeNull(); // reset by generateDefaultGameState
    expect(deps.transitionToSpaceFlight).toHaveBeenCalledTimes(1);
  });

  it("stages no carry when there is no won player", async () => {
    const deps = makeDeps();
    const controller = new EndgameController(deps);
    await controller.startNewGamePlus();
    expect(controller.pendingNewGamePlus).toBeNull();
  });
});

describe("EndgameController.triggerPlayerDeath", () => {
  it("fires the death callback exactly once", () => {
    const cb = vi.fn();
    const deps = makeDeps({ getPlayerDeathCallback: () => cb });
    const controller = new EndgameController(deps);
    controller.triggerPlayerDeath();
    controller.triggerPlayerDeath();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("transitions to GAME_OVER only when a renderer is present", () => {
    const deps = makeDeps({ hasRenderer: () => false });
    new EndgameController(deps).triggerPlayerDeath();
    expect(deps.transitionToGameOver).not.toHaveBeenCalled();
  });

  it("resetPlayerDeathGuard re-arms the guard so death can fire again", () => {
    const cb = vi.fn();
    const deps = makeDeps({ getPlayerDeathCallback: () => cb });
    const controller = new EndgameController(deps);
    controller.triggerPlayerDeath();
    controller.resetPlayerDeathGuard();
    controller.triggerPlayerDeath();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("EndgameController.restartNewGame", () => {
  it("resets game state then transitions to race selection", async () => {
    const deps = makeDeps();
    deps.state.player = makePlayer();
    await new EndgameController(deps).restartNewGame();
    expect(deps.state.player).toBeNull();
    expect(deps.transitionToRaceSelection).toHaveBeenCalledTimes(1);
  });
});

describe("EndgameController.generateDefaultGameState", () => {
  it("clears player/loadout/guards/carry and regenerates the galaxy", async () => {
    const deps = makeDeps();
    deps.state.player = makePlayer();
    const controller = new EndgameController(deps);
    controller.pendingNewGamePlus = {
      credits: 500,
      rank: 3,
      factionType: FactionType.OUTLANDERS,
      gameMode: "HARD",
    };
    const restoreSpy = vi.spyOn(deps.questManager, "restoreState");
    const resetLedgerSpy = vi.spyOn(deps.bankingService, "resetLedger");
    const deletePlayerSpy = vi.spyOn(deps.playerService, "deletePlayer");
    const resetSessionSpy = vi.spyOn(deps.sessionState, "resetForNewSession");
    const musicResetSpy = vi.spyOn(deps.music, "reset");
    const hullAlarmResetSpy = vi.spyOn(deps.hullAlarm, "reset");

    await controller.generateDefaultGameState();

    expect(deps.state.player).toBeNull();
    expect(deps.setPlayerLoadout).toHaveBeenCalledWith(null);
    expect(controller.pendingNewGamePlus).toBeNull();
    expect(restoreSpy).toHaveBeenCalledWith([], []);
    expect(resetLedgerSpy).toHaveBeenCalled();
    expect(deletePlayerSpy).toHaveBeenCalled();
    expect(resetSessionSpy).toHaveBeenCalled();
    expect(musicResetSpy).toHaveBeenCalled();
    expect(hullAlarmResetSpy).toHaveBeenCalled();
    expect(deps.clearFlightPositions).toHaveBeenCalled();
    expect(deps.clearCombatStateProvider).toHaveBeenCalled();
    expect(deps.state.galaxy).not.toBeNull();
  });
});
