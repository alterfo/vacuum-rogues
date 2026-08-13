import type { GameEngine } from "@/systems/GameEngine";
import type { StarSystem } from "@/domain/StarSystem";
import {
  getEconomyOverrides,
  setEconomyOverride,
  resetEconomyOverrides,
  bumpShopRerollNonce,
  type EconomyOverrides,
} from "@/config/economyOverrides";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";
import { TECH_UPLIFT_CAP } from "@/config/balance";

export const ECONOMY_ADMIN_HOTKEY_CODE = "F9";

export interface EconomyAdminPanelHandle {
  toggle(): void;
  dispose(): void;
  readonly visible: boolean;
}

interface OverrideField {
  readonly key: keyof EconomyOverrides;
  readonly label: string;
  readonly step: number;
}

const OVERRIDE_FIELDS: OverrideField[] = [
  { key: "techUpliftDays", label: "Дней на +1 tech", step: 10 },
  { key: "techUpliftCap", label: "Потолок tech", step: 1 },
  { key: "rareStockFactor", label: "Множитель редкости", step: 0.1 },
  { key: "hullTradeInRate", label: "Ставка trade-in корпуса", step: 0.05 },
  { key: "minDayReduction", label: "Сдвиг minDay (дней)", step: 30 },
];

function currentSystem(engine: GameEngine): StarSystem | null {
  const galaxy = engine.galaxy;
  const player = engine.player;
  if (!galaxy || !player?.currentSystemId) return null;
  return galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;
}

export function installEconomyAdminPanel(
  engine: GameEngine,
): EconomyAdminPanelHandle {
  if (typeof document === "undefined") {
    return { toggle() {}, dispose() {}, visible: false };
  }

  let visible = false;
  let root: HTMLDivElement | null = null;

  function ensureRoot(): HTMLDivElement {
    if (root) return root;
    root = document.createElement("div");
    root.id = "economy-admin-panel";
    root.style.cssText = [
      "position:fixed",
      "top:8px",
      "right:8px",
      "z-index:99999",
      "width:280px",
      "padding:10px 12px",
      "border-radius:8px",
      "font:12px/1.5 monospace",
      "color:#cfe8ff",
      "background:rgba(6,10,18,0.92)",
      "border:1px solid #2f5d7d",
      "display:none",
    ].join(";");
    document.body.appendChild(root);
    return root;
  }

  function button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = [
      "margin:2px",
      "padding:2px 6px",
      "font:11px monospace",
      "cursor:pointer",
      "background:#123049",
      "color:#cfe8ff",
      "border:1px solid #2f5d7d",
      "border-radius:4px",
    ].join(";");
    btn.addEventListener("click", () => {
      onClick();
      render();
    });
    return btn;
  }

  function addCredits(amount: number): void {
    if (!engine.player) return;
    adjustPlayerCredits(
      engine.bank,
      engine.player,
      amount,
      GL_COUNTERPARTY.DEV_ADMIN,
      "Dev economy admin panel",
    );
  }

  function advanceDays(count: number): void {
    for (let i = 0; i < count; i++) engine.advanceGalaxyDay();
  }

  function adjustSystemTech(delta: number): void {
    const sys = currentSystem(engine);
    if (!sys) return;
    sys.techLevel = Math.max(
      1,
      Math.min(TECH_UPLIFT_CAP, sys.techLevel + delta),
    );
  }

  function adjustOverride(field: OverrideField, delta: number): void {
    const overrides = getEconomyOverrides();
    const base = overrides[field.key] ?? 0;
    setEconomyOverride(field.key, Math.round((base + delta) * 1000) / 1000);
  }

  function render(): void {
    if (!root) return;
    root.innerHTML = "";

    const title = document.createElement("div");
    title.textContent = "⚙ ЭКОНОМИКА (dev)";
    title.style.cssText = "font-weight:700;margin-bottom:6px;color:#7cc4fc";
    root.appendChild(title);

    const credits = document.createElement("div");
    credits.textContent = `Кредиты: ${engine.player?.credits ?? "—"}`;
    root.appendChild(credits);
    const creditsRow = document.createElement("div");
    creditsRow.appendChild(button("+1000", () => addCredits(1000)));
    creditsRow.appendChild(button("+10000", () => addCredits(10000)));
    creditsRow.appendChild(button("-1000", () => addCredits(-1000)));
    root.appendChild(creditsRow);

    const day = document.createElement("div");
    day.textContent = `День: ${engine.galaxy?.gameDays ?? "—"}`;
    day.style.cssText = "margin-top:6px";
    root.appendChild(day);
    const dayRow = document.createElement("div");
    dayRow.appendChild(button("+1 день", () => advanceDays(1)));
    dayRow.appendChild(button("+7 дней", () => advanceDays(7)));
    dayRow.appendChild(button("+30 дней", () => advanceDays(30)));
    root.appendChild(dayRow);

    const sys = currentSystem(engine);
    const tech = document.createElement("div");
    tech.textContent = sys
      ? `Тех. уровень (${sys.name}): ${sys.techLevel}`
      : "Тех. уровень: нет системы";
    tech.style.cssText = "margin-top:6px";
    root.appendChild(tech);
    const techRow = document.createElement("div");
    techRow.appendChild(button("-1", () => adjustSystemTech(-1)));
    techRow.appendChild(button("+1", () => adjustSystemTech(1)));
    root.appendChild(techRow);

    const shopRow = document.createElement("div");
    shopRow.style.cssText = "margin-top:6px";
    shopRow.appendChild(
      button("Обновить магазины", () => bumpShopRerollNonce()),
    );
    shopRow.appendChild(
      button("Сбросить override'ы", () => resetEconomyOverrides()),
    );
    root.appendChild(shopRow);

    const overrides = getEconomyOverrides();
    for (const field of OVERRIDE_FIELDS) {
      const row = document.createElement("div");
      row.style.cssText = "margin-top:6px";
      const value = overrides[field.key];
      const label = document.createElement("span");
      label.textContent = `${field.label}: ${value === undefined ? "база" : value}`;
      row.appendChild(label);
      row.appendChild(document.createElement("br"));
      row.appendChild(button("-", () => adjustOverride(field, -field.step)));
      row.appendChild(button("+", () => adjustOverride(field, field.step)));
      root.appendChild(row);
    }
  }

  function show(): void {
    visible = true;
    ensureRoot().style.display = "block";
    render();
  }

  function hide(): void {
    visible = false;
    if (root) root.style.display = "none";
  }

  function toggle(): void {
    if (visible) hide();
    else show();
  }

  const handler = (e: KeyboardEvent): void => {
    if (e.code !== ECONOMY_ADMIN_HOTKEY_CODE) return;
    toggle();
  };
  window.addEventListener("keydown", handler);

  return {
    toggle,
    dispose(): void {
      window.removeEventListener("keydown", handler);
      root?.remove();
      root = null;
      visible = false;
    },
    get visible(): boolean {
      return visible;
    },
  };
}
