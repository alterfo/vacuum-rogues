import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => {
  class Container {
    children: unknown[] = [];
    x = 0;
    y = 0;
    alpha = 1;
    eventMode = "auto";
    cursor = "pointer";
    destroyed = false;
    private handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    addChild<T>(c: T): T {
      this.children.push(c);
      return c;
    }
    removeChild<T>(c: T): T {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    }
    on(ev: string, fn: (...a: unknown[]) => void): this {
      (this.handlers[ev] ??= []).push(fn);
      return this;
    }
    emit(ev: string, ...args: unknown[]): void {
      for (const fn of this.handlers[ev] ?? []) fn(...args);
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class Graphics extends Container {
    rect(): this {
      return this;
    }
    roundRect(): this {
      return this;
    }
    circle(): this {
      return this;
    }
    fill(): this {
      return this;
    }
    stroke(): this {
      return this;
    }
  }
  class Text extends Container {
    text: string;
    width = 0;
    height = 0;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
    }
  }
  return { Container, Graphics, Text, Rectangle: class {} };
});

import { Text } from "pixi.js";
import { NpcContactPanel } from "@/presentation/NpcContactPanel";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import { FACTION_LABEL, factionDisplayLabel } from "@/config/factionConfig";
import { translate } from "@/i18n/i18n";

function makeOvermindNpc(): NpcShip {
  const npc = new NpcShip({
    id: "ov_label_1",
    name: "Жнец ov_label_1",
    race: FactionType.OUTLANDERS,
    faction: Faction.OVERMIND,
    role: NpcRole.OVERMIND,
    hullHP: 160,
    maxHull: 160,
    shields: 80,
    speed: 0.1,
    damage: 28,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
  npc.markHostile();
  return npc;
}

function panelLabels(panel: NpcContactPanel): string[] {
  return (panel.container.children as unknown[])
    .filter((c): c is Text => c instanceof Text)
    .map((t) => t.text);
}

const NOOP_CALLBACKS = {
  onHail: () => {},
  onTrade: () => {},
  onAttack: () => {},
  onApproach: () => {},
  onClose: () => {},
};

describe("Overmind faction label converges on FACTION_LABEL across surfaces", () => {
  it("i18n faction.OVERMIND (RU) matches the canonical FACTION_LABEL, not «Предтечи»", () => {
    expect(translate("ru", "faction.OVERMIND")).toBe(
      FACTION_LABEL[Faction.OVERMIND],
    );
    expect(translate("ru", "faction.OVERMIND")).toBe("Сверхразум");
  });

  it('i18n faction.OVERMIND (EN) is the concept-matching "Overmind", not "Precursors"', () => {
    expect(translate("en", "faction.OVERMIND")).toBe("Overmind");
  });

  it("NpcContactPanel renders «Сверхразум» in the alliance line (default RU)", () => {
    const panel = new NpcContactPanel(makeOvermindNpc(), 800, 600, {
      ...NOOP_CALLBACKS,
    });
    const labels = panelLabels(panel);
    expect(labels.some((l) => l.includes("Сверхразум"))).toBe(true);
    expect(labels.some((l) => l.includes("Предтечи"))).toBe(false);
    panel.destroy();
  });

  it("factionDisplayLabel (GovernmentScene/PlanetScene seam) resolves every Faction via FACTION_LABEL", () => {
    for (const value of Object.values(Faction)) {
      expect(factionDisplayLabel(value)).toBe(FACTION_LABEL[value]);
    }
  });

  it("factionDisplayLabel falls back to the raw id for an unknown faction string", () => {
    expect(factionDisplayLabel("NOT_A_FACTION")).toBe("NOT_A_FACTION");
  });

  it("all three surfaces render the identical string for Faction.OVERMIND", () => {
    const contactPanelLabel = translate("ru", "faction.OVERMIND");
    const sceneLabel = factionDisplayLabel(Faction.OVERMIND);
    const canonical = FACTION_LABEL[Faction.OVERMIND];
    expect(contactPanelLabel).toBe(canonical);
    expect(sceneLabel).toBe(canonical);
  });
});
