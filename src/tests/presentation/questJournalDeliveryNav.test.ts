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
const NEIGHBOUR = "planet_neighbour";
const SYS = "sys_home";

const galaxy: QuestDestinationGalaxyLike = {
  systems: [
    {
      id: SYS,
      name: "Дом",
      planets: [
        { id: ISSUER, name: "Гавань" },
        { id: NEIGHBOUR, name: "Окраина" },
      ],
    },
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

function localDeliveryQuest() {
  return {
    id: "q-local",
    title: "Местный подряд",
    type: "DELIVERY",
    isCompleted: false,
    isFailed: false,
    deadline: 0,
    planetId: ISSUER,
    targetSystemId: SYS,
    targetPlanetId: NEIGHBOUR,
    objectives: [
      {
        id: "q-local_collect",
        type: "COLLECT_ITEM",
        description: "Загрузить медикаменты",
        completed: false,
        currentAmount: 0,
        targetAmount: 8,
        itemType: "MEDICINE",
      },
    ],
    reward: { credits: 150, experience: 60, items: [] },
  };
}

function service(quest: unknown): IQuestService {
  return {
    getActiveQuests: vi.fn().mockReturnValue([quest]),
    getCompletedQuestIds: vi.fn().mockReturnValue([]),
  } as unknown as IQuestService;
}

describe("QuestJournalUI local-delivery navigation (Task 4)", () => {
  it("routes the cargo objective to the NEIGHBOUR planet, not the issuer or the bare system", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const onNavigate = vi.fn();
    const ui = new QuestJournalUI(
      service(localDeliveryQuest()),
      1280,
      720,
      vi.fn(),
      onNavigate,
      0,
      resolveName,
      undefined,
      galaxy,
      SYS, // player is in the home system → in-system approach
    );

    const root = ui.container as unknown as MockNode;
    const navBtn = findButton(root, "Лететь к цели");
    expect(navBtn).not.toBeNull();

    clickButton(navBtn!);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(NEIGHBOUR);
    expect(onNavigate).not.toHaveBeenCalledWith(ISSUER);
    expect(onNavigate).not.toHaveBeenCalledWith(SYS);
  });

  it("names the delivery neighbour with a 'Куда' highlight distinct from the issuer", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const ui = new QuestJournalUI(
      service(localDeliveryQuest()),
      1280,
      720,
      vi.fn(),
      vi.fn(),
      0,
      resolveName,
      undefined,
      galaxy,
      SYS,
    );
    const texts = collectTexts(ui.container as unknown as MockNode);

    const kuda = texts.find((t) => t.includes("Куда:"));
    expect(kuda).toBeDefined();
    expect(kuda).toContain("Окраина"); // the neighbour
    const vydan = texts.find((t) => t.includes("Выдан:"));
    expect(vydan).toBeDefined();
    expect(vydan).toContain("Гавань");
  });

  it("offers no route when no galaxy is wired (back-compat: descriptor unresolved)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const onNavigate = vi.fn();
    const ui = new QuestJournalUI(
      service(localDeliveryQuest()),
      1280,
      720,
      vi.fn(),
      onNavigate,
    );
    const root = ui.container as unknown as MockNode;
    expect(findButton(root, "Лететь к цели")).toBeNull();
    expect(collectTexts(root).find((t) => t.includes("Куда:"))).toBeUndefined();
  });

  it("a cross-system delivery still routes via its own VISIT_LOCATION objective (no duplicate courier route)", async () => {
    const { QuestJournalUI } = await import("@/presentation/QuestJournalUI");
    const onNavigate = vi.fn();
    const crossSystem = {
      ...localDeliveryQuest(),
      id: "q-cross",
      title: "Доставка",
      objectives: [
        {
          id: "q-cross_collect",
          type: "COLLECT_ITEM",
          description: "Загрузить руду",
          completed: false,
          currentAmount: 0,
          targetAmount: 5,
          itemType: "ORE",
        },
        {
          id: "q-cross_deliver",
          type: "VISIT_LOCATION",
          description: "Доставить",
          completed: false,
          currentAmount: 0,
          targetAmount: 1,
          locationId: NEIGHBOUR,
        },
      ],
    };
    const ui = new QuestJournalUI(
      service(crossSystem),
      1280,
      720,
      vi.fn(),
      onNavigate,
      0,
      resolveName,
      undefined,
      galaxy,
      SYS,
    );
    const root = ui.container as unknown as MockNode;
    const navBtn = findButton(root, "Лететь к цели");
    expect(navBtn).not.toBeNull();
    clickButton(navBtn!);
    expect(onNavigate).toHaveBeenCalledWith(NEIGHBOUR);
    expect(collectTexts(root).find((t) => t.includes("Куда:"))).toBeUndefined();
  });
});
