import { describe, it, expect } from "vitest";
import {
  shopRowAction,
  type ShopRowState,
} from "@/presentation/equipment/shopRowAction";

/**
 * Pure label/action selection for an equipment-shop listing's right-hand
 * control. The bug being fixed: owned-but-uninstalled gear rendered a dead
 * "Есть" badge with no action — these tests pin the four meaningful states
 * (buy / owned / installed / no-funds) plus the owned→installable upgrade.
 */
describe("shopRowAction", () => {
  const base: ShopRowState = {
    isInstalled: false,
    owned: false,
    installable: false,
    canAfford: false,
  };

  it("affordable, not owned → actionable buy control", () => {
    const a = shopRowAction({ ...base, canAfford: true });
    expect(a.label).toBe("[Купить]");
    expect(a.actionable).toBe(true);
    expect(a.action).toBe("buy");
  });

  it("not affordable, not owned → non-actionable no-funds badge", () => {
    const a = shopRowAction({ ...base, canAfford: false });
    expect(a.label).toBe("Мало₡");
    expect(a.actionable).toBe(false);
    expect(a.action).toBeUndefined();
  });

  it("installed → non-actionable installed badge", () => {
    const a = shopRowAction({ ...base, isInstalled: true });
    expect(a.label).toBe("Установлен");
    expect(a.actionable).toBe(false);
  });

  it("owned + fits the hull → actionable install control (never dead 'Есть')", () => {
    const a = shopRowAction({ ...base, owned: true, installable: true });
    expect(a.label).toBe("[Установить]");
    expect(a.actionable).toBe(true);
    expect(a.action).toBe("install");
  });

  it("owned but can't fit now → clear 'В трюме' status, not a dead 'Есть'", () => {
    const a = shopRowAction({ ...base, owned: true, installable: false });
    expect(a.label).toBe("В трюме");
    expect(a.actionable).toBe(false);
  });

  it("no state renders the old dead 'Есть' label", () => {
    const states: ShopRowState[] = [
      { ...base },
      { ...base, canAfford: true },
      { ...base, isInstalled: true },
      { ...base, owned: true },
      { ...base, owned: true, installable: true },
      { ...base, owned: true, canAfford: true },
    ];
    for (const s of states) {
      expect(shopRowAction(s).label).not.toBe("Есть");
    }
  });

  it("precedence: installed > installable > owned > affordable", () => {
    // installed wins even if owned/affordable also set
    expect(
      shopRowAction({
        isInstalled: true,
        owned: true,
        installable: true,
        canAfford: true,
      }).label,
    ).toBe("Установлен");
    // installable wins over a plain owned/affordable row
    expect(
      shopRowAction({
        isInstalled: false,
        owned: true,
        installable: true,
        canAfford: true,
      }).label,
    ).toBe("[Установить]");
    // owned (but not installable) outranks affordability → never offers "[Купить]"
    expect(
      shopRowAction({
        isInstalled: false,
        owned: true,
        installable: false,
        canAfford: true,
      }).label,
    ).toBe("В трюме");
  });

  it("every actionable result carries an action; every status result does not", () => {
    const states: ShopRowState[] = [
      { ...base },
      { ...base, canAfford: true },
      { ...base, isInstalled: true },
      { ...base, owned: true, installable: false },
      { ...base, owned: true, installable: true },
    ];
    for (const s of states) {
      const a = shopRowAction(s);
      expect(a.actionable).toBe(a.action !== undefined);
    }
  });
});
