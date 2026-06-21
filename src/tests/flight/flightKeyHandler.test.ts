/**
 * Direct unit tests for the pure flight-scene key router
 * (`src/presentation/flight/flightKeyHandler.ts`), extracted from
 * `SpaceFlightScene.onKeyDown` precisely so its routing is testable without the
 * PixiJS scene.
 *
 * `spaceRunsTurn.test.ts` exercises the Space branch through the live scene but
 * only covers the *terminal* Esc branch (cancel a planned route). The Esc
 * handler is a 5-way priority chain (combat pause → contact panel → quest
 * journal → planet info → route cancel); a reorder or a dropped branch would
 * ship green without these tests. This file pins each branch + the ordering.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleFlightKey,
  type FlightKeyContext,
} from "@/presentation/flight/flightKeyHandler";

type Ctx = FlightKeyContext & {
  combatPause: { paused: boolean; resume: ReturnType<typeof vi.fn> };
  npcManager: {
    isContactPanelOpen: boolean;
    closeContactPanel: ReturnType<typeof vi.fn>;
  };
  hud: {
    isQuestJournalOpen: ReturnType<typeof vi.fn>;
    closeQuestJournal: ReturnType<typeof vi.fn>;
    toggleQuestJournal: ReturnType<typeof vi.fn>;
    showMessage: ReturnType<typeof vi.fn>;
  };
  planetManager: {
    hasInfoPanel: boolean;
    closeInfoPanel: ReturnType<typeof vi.fn>;
  };
  clearPlannedRoute: ReturnType<typeof vi.fn>;
  executeRouteTo: ReturnType<typeof vi.fn>;
  openInventory: ReturnType<typeof vi.fn>;
};

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    combatPause: { paused: false, resume: vi.fn() },
    npcManager: { isContactPanelOpen: false, closeContactPanel: vi.fn() },
    hud: {
      isQuestJournalOpen: vi.fn().mockReturnValue(false),
      closeQuestJournal: vi.fn(),
      toggleQuestJournal: vi.fn(),
      showMessage: vi.fn(),
    },
    planetManager: { hasInfoPanel: false, closeInfoPanel: vi.fn() },
    plannedRoute: null,
    isTurnRunning: false,
    clearPlannedRoute: vi.fn(),
    executeRouteTo: vi.fn(),
    openInventory: vi.fn(),
    ...overrides,
  } as Ctx;
}

const esc = () => new KeyboardEvent("keydown", { key: "Escape" });
const space = (init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key: " ", ...init });

describe("handleFlightKey — Esc priority chain", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it("resumes combat pause first, ahead of every other open surface", () => {
    ctx.combatPause.paused = true;
    ctx.npcManager.isContactPanelOpen = true;
    ctx.hud.isQuestJournalOpen.mockReturnValue(true);
    ctx.planetManager.hasInfoPanel = true;
    ctx.plannedRoute = { x: 1, y: 2 };

    handleFlightKey(esc(), ctx);

    expect(ctx.combatPause.resume).toHaveBeenCalledTimes(1);
    expect(ctx.npcManager.closeContactPanel).not.toHaveBeenCalled();
    expect(ctx.hud.closeQuestJournal).not.toHaveBeenCalled();
    expect(ctx.planetManager.closeInfoPanel).not.toHaveBeenCalled();
    expect(ctx.clearPlannedRoute).not.toHaveBeenCalled();
  });

  it("closes the contact panel ahead of journal / planet info / route", () => {
    ctx.npcManager.isContactPanelOpen = true;
    ctx.hud.isQuestJournalOpen.mockReturnValue(true);
    ctx.planetManager.hasInfoPanel = true;
    ctx.plannedRoute = { x: 1, y: 2 };

    handleFlightKey(esc(), ctx);

    expect(ctx.npcManager.closeContactPanel).toHaveBeenCalledTimes(1);
    expect(ctx.hud.closeQuestJournal).not.toHaveBeenCalled();
    expect(ctx.planetManager.closeInfoPanel).not.toHaveBeenCalled();
    expect(ctx.clearPlannedRoute).not.toHaveBeenCalled();
  });

  it("closes the quest journal ahead of planet info / route", () => {
    ctx.hud.isQuestJournalOpen.mockReturnValue(true);
    ctx.planetManager.hasInfoPanel = true;
    ctx.plannedRoute = { x: 1, y: 2 };

    handleFlightKey(esc(), ctx);

    expect(ctx.hud.closeQuestJournal).toHaveBeenCalledTimes(1);
    expect(ctx.planetManager.closeInfoPanel).not.toHaveBeenCalled();
    expect(ctx.clearPlannedRoute).not.toHaveBeenCalled();
  });

  it("closes the planet info panel ahead of cancelling the route", () => {
    ctx.planetManager.hasInfoPanel = true;
    ctx.plannedRoute = { x: 1, y: 2 };

    handleFlightKey(esc(), ctx);

    expect(ctx.planetManager.closeInfoPanel).toHaveBeenCalledTimes(1);
    expect(ctx.clearPlannedRoute).not.toHaveBeenCalled();
  });

  it("cancels the planned route only when nothing else is open", () => {
    ctx.plannedRoute = { x: 1, y: 2 };

    handleFlightKey(esc(), ctx);

    expect(ctx.clearPlannedRoute).toHaveBeenCalledTimes(1);
    expect(ctx.hud.showMessage).toHaveBeenCalledWith(
      "Маршрут отменён",
      0xffaa00,
    );
  });

  it("is a silent no-op on Esc when nothing is open and no route is planned", () => {
    handleFlightKey(esc(), ctx);

    expect(ctx.combatPause.resume).not.toHaveBeenCalled();
    expect(ctx.npcManager.closeContactPanel).not.toHaveBeenCalled();
    expect(ctx.hud.closeQuestJournal).not.toHaveBeenCalled();
    expect(ctx.planetManager.closeInfoPanel).not.toHaveBeenCalled();
    expect(ctx.clearPlannedRoute).not.toHaveBeenCalled();
    expect(ctx.hud.showMessage).not.toHaveBeenCalled();
  });
});

describe("handleFlightKey — Space launch guards", () => {
  it("does not launch the turn while a contact panel is open", () => {
    const ctx = makeCtx({
      plannedRoute: { x: 5, y: 5 },
      npcManager: { isContactPanelOpen: true, closeContactPanel: vi.fn() },
    });

    handleFlightKey(space(), ctx);

    expect(ctx.executeRouteTo).not.toHaveBeenCalled();
  });

  it("does not launch the turn while a planet info panel is open", () => {
    const ctx = makeCtx({
      plannedRoute: { x: 5, y: 5 },
      planetManager: { hasInfoPanel: true, closeInfoPanel: vi.fn() },
    });

    handleFlightKey(space(), ctx);

    expect(ctx.executeRouteTo).not.toHaveBeenCalled();
  });

  it("calls preventDefault on Space even when the launch is suppressed", () => {
    const ctx = makeCtx({
      npcManager: { isContactPanelOpen: true, closeContactPanel: vi.fn() },
    });
    const ev = space();
    const prevent = vi.spyOn(ev, "preventDefault");

    handleFlightKey(ev, ctx);

    expect(prevent).toHaveBeenCalledTimes(1);
  });

  it("launches the planned route once when no panel is open", () => {
    const ctx = makeCtx({ plannedRoute: { x: 7, y: 8 } });

    handleFlightKey(space(), ctx);

    expect(ctx.executeRouteTo).toHaveBeenCalledTimes(1);
    expect(ctx.executeRouteTo).toHaveBeenCalledWith(7, 8);
  });
});
