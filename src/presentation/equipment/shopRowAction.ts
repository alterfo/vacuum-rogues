export interface ShopRowState {
  isInstalled: boolean;
  owned: boolean;
  installable: boolean;
  canAfford: boolean;
}

export interface ShopRowAction {
  label: string;
  color: number;
  actionable: boolean;
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
