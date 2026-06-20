/**
 * Pure selector for an equipment-shop listing's right-hand control: the label,
 * colour, and whether it is an interactive action vs. a static status badge.
 *
 * Extracted from {@link EquipmentShopScene} so the buy/own/install/no-funds
 * branching is unit-testable without PixiJS. The key fix it encodes: an owned
 * but uninstalled item must never render a dead "Есть" — it is either
 * actionably installable (it fits the hull now → "[Установить]") or it sits in
 * the hold, which the row states plainly ("В трюме") and the ТРЮМ strip manages.
 *
 * Precedence (most → least specific): installed > installable > owned >
 * affordable > unaffordable. `installable` implies `owned`.
 */
export interface ShopRowState {
  /** Gear is fitted in the canonical loadout. */
  isInstalled: boolean;
  /** Gear is owned but not installed (in either the canonical store or the legacy bag). */
  owned: boolean;
  /** Owned in the canonical ownedGearIds store AND fits the current hull now. */
  installable: boolean;
  /** Player can afford the listing price. */
  canAfford: boolean;
}

export interface ShopRowAction {
  label: string;
  /** Raw, semantic colour (already legible — passed with `rawColor: true`). */
  color: number;
  /** Interactive control (button) when true; a static status badge when false. */
  actionable: boolean;
  /** What clicking does, when actionable. */
  action?: "buy" | "install";
}

export function shopRowAction(state: ShopRowState): ShopRowAction {
  if (state.isInstalled) {
    return { label: "Установлен", color: 0x44ff88, actionable: false };
  }
  if (state.installable) {
    return {
      label: "[Установить]",
      color: 0x66ccff,
      actionable: true,
      action: "install",
    };
  }
  if (state.owned) {
    // Owned but can't be fitted right now (no slot / over mass, or only in the
    // legacy bag) — a clear, non-dead status that points at the ТРЮМ strip.
    return { label: "В трюме", color: 0x88aa44, actionable: false };
  }
  if (state.canAfford) {
    return {
      label: "[Купить]",
      color: 0x00ff88,
      actionable: true,
      action: "buy",
    };
  }
  return { label: "Мало₡", color: 0x445544, actionable: false };
}
