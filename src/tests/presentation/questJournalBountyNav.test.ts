/**
 * Task 5 (Bug 5): a BOUNTY («Охота») quest has only a DEFEAT_ENEMY objective —
 * no VISIT objective — so it never got a "→ Лететь к цели" route button. It
 * must route like the local-courier case: same-system + concrete target
 * planet → the planet id (in-system approach); cross-system, or no concrete
 * target planet at all → the target system id (star-map warp). Mocks
 * pixi.js — no WebGL needed.
 */
import { describe, it, expect, vi } from "vitest";
import type { IQuestService } from "@/core/ports/IQuestService";
import type { QuestDestinationGalaxyLike } from "@/systems/quests/questDestination";

vi.mock("pixi.js", () => {
  const makeContainer = () => {
    const node: Record<string, unknown> = {
      children: [] as unknown[],
      eventMode: "auto",
      cursor: "pointer",
      x: 0,
      y: 0,
      text: "",
      anchor: { set: vi.fn() },
      on: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
      parent: null,
    };
    node.addChild = vi.fn((...kids: unknown[]) => {
      (node.children as unknown[]).push(...kids);
      return kids[0];
    });
    node.removeChild = vi.fn();
    return node;
  };
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      rect: vi.fn().mockReturnThis(),
      roundRect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
    })),
    Text: vi.fn().mockImplementation((opts?: { text?: unknown }) => {
      const node = makeContainer();
      node.text = opts?.text != null ? String(opts.text) : "";
      return node;
    }),
  };
});

type MockNode = {
  text: string;
  eventMode: string;
  on: ReturnType<typeof vi.fn>;
  children: MockNode[];
};

function collectTexts(node: MockNode): string[] {
  const out: string[] = [];
  if (typeof node.text === "string" && node.text) out.push(node.text);
  for (const child of node.children ?? []) out.push(...collectTexts(child));
  return out;
}

function findButton(node: MockNode, needle: string): MockNode | null {
  for (const child of node.children ?? []) {
    if (
      child.eventMode === "static" &&
      collectTexts(child).some((t) => t.includes(needle))
    ) {
      return child;
    }
    const found = findButton(child, needle);
    if (found) return found;
  }
  return null;
}

function clickButton(btn: MockNode): void {
  const pd = btn.on.mock.calls.find((c: unknown[]) => c[0] === "pointerdown");
  expect(pd).toBeDefined();
  (pd![1] as (e: { stopPropagation: () => void }) => void)({
    stopPropagation: vi.fn(),
  });
}

const ISSUER = "planet_issuer";
const HOME = "sys_home";
const TARGET_WITH_PLANET = "sys_target_planet";
const TARGET_NO_PLANET = "sys_target_empty";
const BOUNTY_PLANET = "planet_bounty";

const galaxy: QuestDestinationGalaxyLike = {
  systems: [
    { id: HOME, name: "Дом", planets: [{ id: ISSUER, name: "Гавань" }] },
    {
      id: TARGET_WITH_PLANET,
      name: "Рубеж",
      planets: [{ id: BOUNTY_PLANET, name: "Форпост" }],
    },
    { id: TARGET_NO_PLANET, name: "Пустошь", planets: [] },
  ],
};

function resolveName(id: string): string {
  for (const s of galaxy.systems) {
    if (s.id === id) return s.name;
    const p = s.planets.find((pl) => pl.id === id);
    if (p) return p.name;
  }
  return id;
}

function bountyQuest(
  targetSystemId: string,
  targetPlanetId: string | null,
): unknown {
  return {
    id: "q-bounty",
    title: "Охота: Форпост",
    type: "BOUNTY",
    isCompleted: false,
    isFailed: false,
    deadline: 0,
    planetId: ISSUER,
    targetSystemId,
    targetPlanetId,
    objectives: [
      {
        id: "q-bounty_kill",
        type: "DEFEAT_ENEMY",
        description: "Уничтожить корабль «Тень»",
        completed: false,
        currentAmount: 0,
        targetAmount: 1,
      },
    ],
    reward: { credits: 300, experience: 90, items: [] },
  };
}

function service(quest: unknown): IQuestService {
  return {
    getActiveQuests: vi.fn().mockReturnValue([quest]),
    getCompletedQuestIds: vi.fn().mockReturnValue([]),
  } as unknown as IQuestService;
}

describe("QuestJournalUI BOUNTY navigation (Task 5 / Bug 5)", () => {
  it("routes a same-system bounty to the concrete target planet", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const onNavigate = vi.fn();
    const ui = new QuestJournalUI(
      service(bountyQuest(TARGET_WITH_PLANET, BOUNTY_PLANET)),
      1280,
      720,
      vi.fn(),
      onNavigate,
      0,
      resolveName,
      undefined,
      galaxy,
      TARGET_WITH_PLANET, // player already in the target system
    );

    const root = ui.container as unknown as MockNode;
    const navBtn = findButton(root, "Лететь к цели");
    expect(navBtn).not.toBeNull();

    clickButton(navBtn!);
    expect(onNavigate).toHaveBeenCalledWith(BOUNTY_PLANET);
  });

  it("routes a cross-system bounty (with a concrete planet) to the system, not the planet", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const onNavigate = vi.fn();
    const ui = new QuestJournalUI(
      service(bountyQuest(TARGET_WITH_PLANET, BOUNTY_PLANET)),
      1280,
      720,
      vi.fn(),
      onNavigate,
      0,
      resolveName,
      undefined,
      galaxy,
      HOME, // player is elsewhere
    );

    const root = ui.container as unknown as MockNode;
    const navBtn = findButton(root, "Лететь к цели");
    expect(navBtn).not.toBeNull();

    clickButton(navBtn!);
    expect(onNavigate).toHaveBeenCalledWith(TARGET_WITH_PLANET);
    expect(onNavigate).not.toHaveBeenCalledWith(BOUNTY_PLANET);
  });

  it("routes a bounty with no concrete target planet to the system", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const onNavigate = vi.fn();
    const ui = new QuestJournalUI(
      service(bountyQuest(TARGET_NO_PLANET, null)),
      1280,
      720,
      vi.fn(),
      onNavigate,
      0,
      resolveName,
      undefined,
      galaxy,
      HOME,
    );

    const root = ui.container as unknown as MockNode;
    const navBtn = findButton(root, "Лететь к цели");
    expect(navBtn).not.toBeNull();

    clickButton(navBtn!);
    expect(onNavigate).toHaveBeenCalledWith(TARGET_NO_PLANET);
  });

  it("still routes to the bare target system when no galaxy is wired (no in-system approach decision possible)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const onNavigate = vi.fn();
    const ui = new QuestJournalUI(
      service(bountyQuest(TARGET_WITH_PLANET, BOUNTY_PLANET)),
      1280,
      720,
      vi.fn(),
      onNavigate,
    );
    const root = ui.container as unknown as MockNode;
    const navBtn = findButton(root, "Лететь к цели");
    expect(navBtn).not.toBeNull();

    clickButton(navBtn!);
    expect(onNavigate).toHaveBeenCalledWith(TARGET_WITH_PLANET);
  });
});
