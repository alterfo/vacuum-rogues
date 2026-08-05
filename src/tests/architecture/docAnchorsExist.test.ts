import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "..", "..");

const ANCHORS: Readonly<Record<string, readonly string[]>> = {
  "systems/GameEngine.ts": [
    "GameEngineDIDependencies",
    "transitionTo",
    "startGameLoop",
    "gameLoop",
    "startBackgroundTicker",
    "saveGame",
    "loadGame",
    "setupPlayerBanking",
    "bankBus",
    "bankingService",
  ],
  "systems/DayTickController.ts": [
    "class DayTickController",
    "run()",
    "advanceOvermindArc",
    "RunEndOfDay",
  ],
  "systems/banking/bus.ts": [
    "class BankBus",
    "dispatch",
    "publish",
    "subscribe",
    "observeCommands",
    "setHandler",
    "BANK_BUS_HANDLER_SET",
    "BANK_BUS_NO_HANDLER",
  ],
  "systems/banking/economy.ts": [
    "adjustPlayerCredits",
    "transfer",
    "bindCreditsProjection",
    "GL_COUNTERPARTY",
  ],
  "systems/banking/BankingService.ts": ["class BankingService", "setHandler"],
  "systems/campaign/escalationNotices.ts": ["EscalationNoticeTracker"],
  "presentation/flight/QuestCompletion.ts": [
    "bountyByNpcKill",
    "explorationBySystemEntry",
  ],
  "domain/Galaxy.ts": ["addNewsEvent", "newsFeed"],
  "core/ports/IOverlayPresenter.ts": ["dismissAll"],
  "core/ports/IAutopilotStateProvider.ts": ["isEngaged", "resume"],
  "core/ports/IQuestService.ts": ["updateQuestProgress", "attachBank"],
  "core/adapters/NoOpOverlayPresenter.ts": ["NoOpOverlayPresenter"],
  "core/adapters/NoOpAutopilotStateProvider.ts": ["NoOpAutopilotStateProvider"],
  "data/MigrationPipeline.ts": ["CURRENT_VERSION"],
};

describe("architecture docs anchor only symbols that still exist", () => {
  for (const [rel, symbols] of Object.entries(ANCHORS)) {
    it(`${rel} still defines every symbol the docs cite`, () => {
      const source = readFileSync(resolve(SRC, rel), "utf8");
      const missing = symbols.filter((s) => !source.includes(s));
      expect(
        missing,
        `docs/architecture/*.md reference these symbols in ${rel}, but they no ` +
          `longer appear there. Update the docs (and this list) to match.\n` +
          missing.join("\n"),
      ).toHaveLength(0);
    });
  }
});
