import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  installEconomyAdminPanel,
  ECONOMY_ADMIN_HOTKEY_CODE,
  type EconomyAdminPanelHandle,
} from "@/dev/EconomyAdminPanel";
import { resetEconomyOverrides } from "@/config/economyOverrides";
import type { GameEngine } from "@/systems/GameEngine";

function fakeEngine() {
  const galaxy = {
    gameDays: 10,
    systems: [
      { id: "sys-1", name: "Альфа", techLevel: 3 },
      { id: "sys-2", name: "Бета", techLevel: 5 },
    ],
  };
  const player = {
    credits: 5000,
    currentSystemId: "sys-1",
    currentAccountId: "acc-1",
  };
  let advanceCount = 0;
  const bank = {
    bus: { dispatch: () => {} },
    service: {
      getLedger: () => ({ hasAccount: () => false }),
      balanceOf: () => 0,
    },
  };
  const engine = {
    galaxy,
    player,
    bank,
    advanceGalaxyDay: () => {
      advanceCount++;
      galaxy.gameDays++;
    },
  };
  return {
    engine: engine as unknown as GameEngine,
    galaxy,
    player,
    get advanceCount() {
      return advanceCount;
    },
  };
}

function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

describe("installEconomyAdminPanel — dev-only overlay", () => {
  let handle: EconomyAdminPanelHandle | null = null;

  beforeEach(() => {
    resetEconomyOverrides();
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    resetEconomyOverrides();
  });

  it("starts hidden with no panel rendered", () => {
    const { engine } = fakeEngine();
    handle = installEconomyAdminPanel(engine);
    expect(handle.visible).toBe(false);
    expect(document.getElementById("economy-admin-panel")).toBeNull();
  });

  it("toggles visible via the hotkey and renders panel content", () => {
    const { engine } = fakeEngine();
    handle = installEconomyAdminPanel(engine);

    press(ECONOMY_ADMIN_HOTKEY_CODE);
    expect(handle.visible).toBe(true);
    const el = document.getElementById("economy-admin-panel");
    expect(el).not.toBeNull();
    expect(el?.style.display).toBe("block");
    expect(el?.textContent).toContain("5000");

    press(ECONOMY_ADMIN_HOTKEY_CODE);
    expect(handle.visible).toBe(false);
    expect(el?.style.display).toBe("none");
  });

  it("ignores unrelated keys", () => {
    const { engine } = fakeEngine();
    handle = installEconomyAdminPanel(engine);
    press("KeyA");
    expect(handle.visible).toBe(false);
  });

  it("+1000 credits button adjusts player.credits", () => {
    const { engine, player } = fakeEngine();
    handle = installEconomyAdminPanel(engine);
    handle.toggle();

    const btn = Array.from(
      document.querySelectorAll("#economy-admin-panel button"),
    ).find((b) => b.textContent === "+1000") as HTMLButtonElement;
    expect(btn).toBeDefined();
    btn.click();
    expect(player.credits).toBe(6000);
  });

  it("advance-day button calls engine.advanceGalaxyDay() the right number of times", () => {
    const { engine } = fakeEngine();
    handle = installEconomyAdminPanel(engine);
    handle.toggle();

    const btn = Array.from(
      document.querySelectorAll("#economy-admin-panel button"),
    ).find((b) => b.textContent === "+7 дней") as HTMLButtonElement;
    btn.click();
    expect(engine.galaxy!.gameDays).toBe(17);
  });

  it("tech +/- buttons adjust the current system's techLevel, clamped", () => {
    const { engine, galaxy } = fakeEngine();
    handle = installEconomyAdminPanel(engine);
    handle.toggle();

    const plus = Array.from(
      document.querySelectorAll("#economy-admin-panel button"),
    ).find((b) => b.textContent === "+1") as HTMLButtonElement;
    plus.click();
    expect(galaxy.systems[0].techLevel).toBe(4);
  });

  it("dispose() removes the DOM node and stops listening to the hotkey", () => {
    const { engine } = fakeEngine();
    handle = installEconomyAdminPanel(engine);
    handle.toggle();
    expect(document.getElementById("economy-admin-panel")).not.toBeNull();

    handle.dispose();
    expect(document.getElementById("economy-admin-panel")).toBeNull();
    expect(handle.visible).toBe(false);

    press(ECONOMY_ADMIN_HOTKEY_CODE);
    expect(document.getElementById("economy-admin-panel")).toBeNull();
  });
});
