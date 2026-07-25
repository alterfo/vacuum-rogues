/**
 * Task 11b — customs-inspection modal seam (autopilot behavior when caught with
 * contraband). The customs modal used to be a plain local variable in
 * `showCustomsModal`, so the dev autopilot's `dismissBlockingModal()` had no way
 * to detect or resolve it — a human saw a blocking modal while the autopilot kept
 * acting underneath it (live report 2026-07-19).
 *
 * These tests lock the scene-state seam (`isCustomsModalOpen` /
 * `customsBribeCost` / `applyCustomsChoice`) and the shared resolution logic
 * behind both the modal's buttons and the autopilot. The autopilot wiring on top
 * of this seam is covered by `installAutopilotHook.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";

// PlanetScene imports pixi.js at module load; mock it so the scene can be
// imported without a real renderer. The seam methods under test never construct
// display objects (showMessage/refreshCreditsHud early-return without a
// uiContainer/creditsHudText), and the modal is a hand-built stand-in.
vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
  Sprite: vi.fn(),
  Rectangle: vi.fn(),
}));

import { PlanetScene } from "@/presentation/PlanetScene";

type CustomsChoice = "pay" | "bribe" | "dump";

interface FakeModal {
  destroyed: boolean;
  destroy: ReturnType<typeof vi.fn>;
}

function makeScene(opts: {
  credits: number;
  penalty: number;
  bribeCost: number;
  illegalGoods?: { type: string; amount: number }[];
  open?: boolean;
}): {
  isCustomsModalOpen: () => boolean;
  customsBribeCost: () => number | null;
  applyCustomsChoice: (c: CustomsChoice) => boolean;
  player: {
    credits: number;
    inventory: { resources: { type: string; amount: number }[] };
    contrabandGoods: string[];
  };
  modal: FakeModal;
} {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const illegal = opts.illegalGoods ?? [{ type: "DRUGS", amount: 5 }];
  const player = {
    credits: opts.credits,
    inventory: { resources: illegal.map((g) => ({ ...g })) },
    contrabandGoods: illegal.map((g) => g.type),
  };
  const modal: FakeModal = { destroyed: false, destroy: vi.fn() };
  // Faithful to PixiJS Container.destroy: flip `destroyed` so the seam's
  // `!customsModal.destroyed` guard is exercised, not just the null-reference path.
  modal.destroy.mockImplementation(() => {
    modal.destroyed = true;
  });
  const fields = scene as unknown as Record<string, unknown>;
  fields.gameEngine = { player, bank: undefined };
  fields.uiContainer = null; // showMessage no-ops
  fields.creditsHudText = null; // refreshCreditsHud no-ops
  fields.customsModal = opts.open === false ? null : modal;
  fields.customsContext =
    opts.open === false
      ? null
      : {
          illegalGoods: player.inventory.resources,
          penalty: opts.penalty,
          bribeCost: opts.bribeCost,
          faction: "INDEPENDENT",
        };
  return {
    isCustomsModalOpen: () =>
      (scene as unknown as { isCustomsModalOpen: boolean }).isCustomsModalOpen,
    customsBribeCost: () =>
      (scene as unknown as { customsBribeCost: number | null })
        .customsBribeCost,
    applyCustomsChoice: (c) =>
      (
        scene as unknown as {
          applyCustomsChoice(c: CustomsChoice): boolean;
        }
      ).applyCustomsChoice(c),
    player,
    modal,
  };
}

describe("PlanetScene customs seam (Task 11b)", () => {
  it("isCustomsModalOpen / customsBribeCost expose the open modal", () => {
    const s = makeScene({ credits: 5000, penalty: 1500, bribeCost: 900 });
    expect(s.isCustomsModalOpen()).toBe(true);
    expect(s.customsBribeCost()).toBe(900);
  });

  it("reports closed and null bribe cost when no modal is open", () => {
    const s = makeScene({
      credits: 5000,
      penalty: 1500,
      bribeCost: 900,
      open: false,
    });
    expect(s.isCustomsModalOpen()).toBe(false);
    expect(s.customsBribeCost()).toBeNull();
    expect(s.applyCustomsChoice("bribe")).toBe(false);
  });

  it("bribe deducts the bribe cost and clears the modal when affordable", () => {
    const s = makeScene({ credits: 5000, penalty: 1500, bribeCost: 900 });
    const ok = s.applyCustomsChoice("bribe");
    expect(ok).toBe(true);
    expect(s.player.credits).toBe(4100);
    expect(s.modal.destroy).toHaveBeenCalledTimes(1);
    expect(s.isCustomsModalOpen()).toBe(false);
  });

  it("bribe leaves the modal open and takes no credits when unaffordable", () => {
    const s = makeScene({ credits: 500, penalty: 1500, bribeCost: 900 });
    const ok = s.applyCustomsChoice("bribe");
    expect(ok).toBe(false);
    expect(s.player.credits).toBe(500);
    expect(s.modal.destroy).not.toHaveBeenCalled();
    expect(s.isCustomsModalOpen()).toBe(true);
  });

  it("pay deducts the full penalty and clears the modal when affordable", () => {
    const s = makeScene({ credits: 5000, penalty: 1500, bribeCost: 900 });
    const ok = s.applyCustomsChoice("pay");
    expect(ok).toBe(true);
    expect(s.player.credits).toBe(3500);
    expect(s.isCustomsModalOpen()).toBe(false);
  });

  it("pay leaves the modal open and takes no credits when unaffordable", () => {
    const s = makeScene({ credits: 500, penalty: 1500, bribeCost: 900 });
    const ok = s.applyCustomsChoice("pay");
    expect(ok).toBe(false);
    expect(s.player.credits).toBe(500);
    expect(s.modal.destroy).not.toHaveBeenCalled();
    expect(s.isCustomsModalOpen()).toBe(true);
  });

  it("dump zeroes the contraband stacks and clears the modal (no credit cost)", () => {
    const s = makeScene({
      credits: 100,
      penalty: 1500,
      bribeCost: 900,
      illegalGoods: [{ type: "DRUGS", amount: 5 }],
    });
    const ok = s.applyCustomsChoice("dump");
    expect(ok).toBe(true);
    expect(s.player.credits).toBe(100);
    expect(s.player.inventory.resources[0].amount).toBe(0);
    expect(s.player.contrabandGoods).not.toContain("DRUGS");
    expect(s.isCustomsModalOpen()).toBe(false);
  });

  it("reports closed via the destroyed guard even while the modal reference lingers", () => {
    const s = makeScene({ credits: 5000, penalty: 1500, bribeCost: 900 });
    expect(s.isCustomsModalOpen()).toBe(true);
    // Modal destroyed but reference not yet nulled — the `!customsModal.destroyed`
    // guard (not the null check) must report it closed.
    s.modal.destroyed = true;
    expect(s.isCustomsModalOpen()).toBe(false);
  });
});
