import { describe, it, expect, vi } from "vitest";

// PixiJS is mocked with lightweight class stubs so the panel constructs headless
// in jsdom (no canvas text measurement). Real classes (not vi.fn factories) keep
// `instanceof Text` working, and addChild tracks children so the rendered button
// labels can be inspected. Event handlers are stored so a button's pointerdown
// can be replayed to assert its wired callback fires.
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

type NpcOpts = { role?: NpcRole; faction?: Faction; hostile?: boolean };

function makeNpc(id: string, opts: NpcOpts = {}): NpcShip {
  const npc = new NpcShip({
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: opts.faction ?? Faction.INDEPENDENT,
    role: opts.role ?? NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
  if (opts.hostile) npc.markHostile();
  return npc;
}

/** Visible text labels rendered in the panel (stat readouts + button captions). */
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

describe("NpcContactPanel always offers Атаковать to a hostile/Overmind contact", () => {
  it("an in-range Overmind hail offers Атаковать despite returning only gibberish", () => {
    const npc = makeNpc("ov_1", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hostile: true,
    });
    const panel = new NpcContactPanel(npc, 800, 600, { ...NOOP_CALLBACKS });

    const labels = panelLabels(panel);
    expect(labels).toContain("Атаковать");
    // The Overmind drops the standing hail/scan affordances (gibberish context).
    expect(labels).not.toContain("Связаться");
    expect(labels).not.toContain("Сканировать");
    panel.destroy();
  });

  it("clicking the Атаковать button invokes the onAttack callback", () => {
    const npc = makeNpc("ov_2", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hostile: true,
    });
    let attacked = false;
    const panel = new NpcContactPanel(npc, 800, 600, {
      ...NOOP_CALLBACKS,
      onAttack: () => {
        attacked = true;
      },
    });

    const children = panel.container.children as Array<
      Text & { emit?: (ev: string, ...a: unknown[]) => void }
    >;
    const label = children.find(
      (c) => c instanceof Text && c.text === "Атаковать",
    );
    expect(label).toBeTruthy();
    // The clickable button Graphics sits immediately before its caption Text.
    const btn = children[children.indexOf(label!) - 1] as {
      emit: (ev: string, ...a: unknown[]) => void;
    };
    btn.emit("pointerdown", { stopPropagation: () => {} });
    expect(attacked).toBe(true);
    panel.destroy();
  });

  it("an out-of-range hostile contact still offers Атаковать (beyond-radar branch)", () => {
    const npc = makeNpc("ov_3", {
      role: NpcRole.PATROL,
      faction: Faction.OVERMIND,
      hostile: true,
    });
    const panel = new NpcContactPanel(
      npc,
      800,
      600,
      { ...NOOP_CALLBACKS },
      false, // out of radar range
    );
    expect(panelLabels(panel)).toContain("Атаковать");
    panel.destroy();
  });

  it("a neutral contact still lists its full action set (unchanged)", () => {
    const npc = makeNpc("trader_1", { role: NpcRole.TRADER });
    const panel = new NpcContactPanel(
      npc,
      800,
      600,
      {
        ...NOOP_CALLBACKS,
        onHire: () => {},
        onAlly: () => {},
      },
      true,
    );
    const labels = panelLabels(panel);
    expect(labels).toContain("Связаться");
    expect(labels).toContain("Торговать");
    expect(labels).toContain("Атаковать");
    expect(labels).toContain("Сканировать");
    panel.destroy();
  });
});
