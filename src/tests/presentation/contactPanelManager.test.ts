import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "pixi.js";
import {
  ContactPanelManager,
  type ContactPanelDeps,
} from "@/presentation/flight/ContactPanelManager";
import { NpcContactPanel } from "@/presentation/NpcContactPanel";
import type { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";

vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn().mockImplementation(() => ({
    container: new Container(),
    destroy: vi.fn(),
  })),
}));

function makeNpc(id = "npc_1"): NpcShip {
  return {
    id,
    name: id,
    race: FactionType.OUTLANDERS,
    faction: Faction.INDEPENDENT,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 0,
    speed: 0.1,
    damage: 10,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    credits: 0,
  } as unknown as NpcShip;
}

function makeDeps(): ContactPanelDeps {
  const uiLayer = new Container();
  return {
    uiLayer,
    getScreenSize: () => ({ width: 800, height: 600 }),
  };
}

const noopCallbacks = {
  onHail: () => {},
  onTrade: () => {},
  onAttack: () => {},
  onApproach: () => {},
  onClose: () => {},
};

describe("ContactPanelManager", () => {
  let deps: ContactPanelDeps;
  let mgr: ContactPanelManager;

  beforeEach(() => {
    deps = makeDeps();
    mgr = new ContactPanelManager(deps);
  });

  it("starts closed", () => {
    expect(mgr.isOpen).toBe(false);
    expect(mgr.hasOpenModal()).toBe(false);
    expect(mgr.openNpcId).toBeNull();
  });

  it("opens a panel and reports isOpen + openNpcId", () => {
    const npc = makeNpc("npc_a");
    mgr.open(npc, noopCallbacks, true, 0);
    expect(mgr.isOpen).toBe(true);
    expect(mgr.hasOpenModal()).toBe(true);
    expect(mgr.openNpcId).toBe("npc_a");
  });

  it("close() clears state immediately", () => {
    mgr.open(makeNpc(), noopCallbacks, true, 0);
    mgr.close();
    expect(mgr.isOpen).toBe(false);
    expect(mgr.hasOpenModal()).toBe(false);
    expect(mgr.openNpcId).toBeNull();
  });

  it("open() while already open closes the previous panel first", () => {
    mgr.open(makeNpc("npc_1"), noopCallbacks, true, 0);
    mgr.open(makeNpc("npc_2"), noopCallbacks, true, 0);
    // After re-open the new npc id is tracked
    expect(mgr.openNpcId).toBe("npc_2");
    expect(mgr.isOpen).toBe(true);
  });

  it("opening adds the panel container to uiLayer", () => {
    expect(deps.uiLayer.children.length).toBe(0);
    mgr.open(makeNpc(), noopCallbacks, true, 0);
    expect(deps.uiLayer.children.length).toBe(1);
  });

  it("close() with nothing open is a no-op", () => {
    expect(() => mgr.close()).not.toThrow();
    expect(mgr.isOpen).toBe(false);
  });

  it("close() calls panel.destroy() via deferred queueMicrotask", async () => {
    const destroySpy = vi.fn();
    vi.mocked(NpcContactPanel).mockImplementationOnce(
      () => ({ container: new Container(), destroy: destroySpy }) as never,
    );
    mgr.open(makeNpc(), noopCallbacks, true, 0);
    mgr.close();
    // destroy is deferred — must not be called synchronously
    expect(destroySpy).not.toHaveBeenCalled();
    // flush the microtask queue
    await Promise.resolve();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
