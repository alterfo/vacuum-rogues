import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import type { StarSystem } from "@/domain/StarSystem";
import { SceneType, ResourceType, NpcRole } from "@/types";
import { GearKind } from "@/systems/equipment/GearCatalog";

interface InfoContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

// ── Localisation ────────────────────────────────────────────────────────────

const RESOURCE_RU: Record<ResourceType, string> = {
  [ResourceType.FUEL]: "Топливо",
  [ResourceType.METALS]: "Металлы",
  [ResourceType.CRYSTALS]: "Кристаллы",
  [ResourceType.ORGANICS]: "Органика",
  [ResourceType.ARTIFACTS]: "Артефакты",
  [ResourceType.WEAPONS]: "Оружие (груз)",
  [ResourceType.MEDICINE]: "Медикаменты",
  [ResourceType.ELECTRONICS]: "Электроника",
  [ResourceType.LUXURY]: "Роскошь",
  [ResourceType.DATA_CORES]: "Ядра данных",
};

const GEAR_KIND_RU: Record<GearKind, string> = {
  [GearKind.HULL]: "Корпус",
  [GearKind.WEAPON]: "Оружие",
  [GearKind.EQUIPMENT]: "Снаряжение",
};

const GEAR_KIND_COLOR: Record<GearKind, number> = {
  [GearKind.HULL]: 0x88ccff,
  [GearKind.WEAPON]: 0xff8888,
  [GearKind.EQUIPMENT]: 0x88ffcc,
};

// ── News generation ─────────────────────────────────────────────────────────

interface NewsItem {
  day: number;
  text: string;
  color: number;
}

function buildNews(gameEngine: GameEngine): NewsItem[] {
  const galaxy = gameEngine.galaxy;
  if (!galaxy) return [];

  const registry = gameEngine.getInfoRegistry();
  const day = galaxy.gameDays;
  const systemMap = new Map<string, StarSystem>(
    galaxy.systems.map((s) => [s.id, s]),
  );
  const originId =
    gameEngine.player?.currentSystemId ?? galaxy.systems[0]?.id ?? "";

  const items: NewsItem[] = [];

  if (registry) {
    // Pirate sightings within 3 jumps
    const pirates = registry.findShips({
      originSystemId: originId,
      role: NpcRole.PIRATE,
      maxJumps: 3,
    });
    for (const p of pirates.slice(0, 4)) {
      const sysName = systemMap.get(p.systemId)?.name ?? p.systemId;
      const dist = p.jumps === 0 ? "текущая система" : `${p.jumps} пр.`;
      items.push({
        day,
        text: `[ТРЕВОГА] Пираты в системе "${sysName}" (${dist})`,
        color: 0xff5544,
      });
    }

    // Cheapest commodity deals in the galaxy
    const hotResources: ResourceType[] = [
      ResourceType.FUEL,
      ResourceType.METALS,
      ResourceType.MEDICINE,
      ResourceType.ELECTRONICS,
      ResourceType.CRYSTALS,
    ];
    for (const res of hotResources) {
      const hit = registry.findResource({
        resource: res,
        originSystemId: originId,
        sort: "price",
        limit: 1,
      })[0];
      if (!hit) continue;
      const sysName = systemMap.get(hit.systemId)?.name ?? hit.systemId;
      const dist = hit.jumps === 0 ? "здесь" : `${hit.jumps} пр.`;
      items.push({
        day: day - Math.floor(Math.random() * 3),
        text: `[РЫНОК] ${RESOURCE_RU[res]}: лучшая цена "${sysName}" — ${hit.price} ₡ (${dist})`,
        color: 0x88ddaa,
      });
    }

    // Trader activity
    const traders = registry.findShips({
      originSystemId: originId,
      role: NpcRole.TRADER,
      maxJumps: 2,
    });
    if (traders.length > 0) {
      const sysName =
        systemMap.get(traders[0].systemId)?.name ?? traders[0].systemId;
      items.push({
        day,
        text: `[ТРАФИК] Торговцы активны в системе "${sysName}"`,
        color: 0xaaaaff,
      });
    }

    // Patrol activity
    const patrols = registry.findShips({
      originSystemId: originId,
      role: NpcRole.PATROL,
      maxJumps: 2,
    });
    if (patrols.length > 0) {
      const sysName =
        systemMap.get(patrols[0].systemId)?.name ?? patrols[0].systemId;
      items.push({
        day,
        text: `[ПАТРУЛЬ] Флот охраны обнаружен в системе "${sysName}"`,
        color: 0x88bbff,
      });
    }
  }

  // Static lore filler so the feed is never empty
  const lore: [number, string][] = [
    [day - 1, "Совет Независимых обсуждает нейтральный договор с Бастионом"],
    [day - 2, "Прогрессоры объявили о новой серии кораблей класса «Омега»"],
    [day - 3, "Окраинники расширяют торговые маршруты в южный сектор"],
    [day - 4, "Синдикат отрицает атаки на транспортные конвои"],
    [day - 5, "Бастион увеличил военное производство на 40%"],
    [day - 6, "Парадоксы зафиксированы вблизи запретной зоны R-17"],
    [day - 7, "Рейнджеры сообщают об аномальной активности в туманности"],
  ];
  for (const [d, text] of lore) {
    items.push({ day: d, text: `[НОВОСТИ] ${text}`, color: 0x666677 });
  }

  items.sort((a, b) => b.day - a.day);
  return items;
}

// ── Scene ───────────────────────────────────────────────────────────────────

const ALL_RESOURCES = Object.values(ResourceType);
const ALL_GEAR_KINDS = Object.values(GearKind);

type Tab = "news" | "search";
type SearchCategory = "resource" | "gear";

export class InfoCenterScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;

  private mainContainer: Container | null = null;

  // tab state
  private activeTab: Tab = "news";
  private newsItems: NewsItem[] = [];
  private newsScroll = 0;

  // search state
  private searchCategory: SearchCategory = "resource";
  private selectedResource: ResourceType = ResourceType.FUEL;
  private selectedGearKind: GearKind = GearKind.HULL;
  private searchResults: string[] = [];

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  initialize(context?: object): void {
    const ctx = context as InfoContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;

    if (this.gameEngine) {
      this.newsItems = buildNews(this.gameEngine);
    }

    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.render();
    this.runSearch();

    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);
  }

  update(_dt: number): void {}

  destroy(): void {
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.mainContainer) {
      this.renderer.uiLayer.removeChild(this.mainContainer);
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }
    this.gameEngine = null;
    this.planet = null;
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.mainContainer) return;
    this.mainContainer.removeChildren();

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    // Backdrop
    const bg = new Graphics();
    bg.rect(0, 0, sw, sh);
    bg.fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    this.mainContainer.addChild(bg);

    // Panel
    const PW = Math.min(860, sw - 40);
    const PH = sh - 60;
    const PX = (sw - PW) / 2;
    const PY = 20;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH);
    panel.fill({ color: 0x0a0a1a, alpha: 1 });
    panel.stroke({ color: 0x334455, width: 1 });
    this.mainContainer.addChild(panel);

    // Title
    const title = new Text({
      text: "[ ИНФОЦЕНТР ]",
      style: { fontSize: 22, fill: 0x88ccff, fontFamily: "monospace" },
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 14;
    title.eventMode = "none";
    this.mainContainer.addChild(title);

    // Day counter
    const day = this.gameEngine?.galaxy?.gameDays ?? 0;
    const dayText = new Text({
      text: `День ${day}`,
      style: { fontSize: 13, fill: 0x556677, fontFamily: "monospace" },
    });
    dayText.anchor.set(1, 0);
    dayText.x = PX + PW - 14;
    dayText.y = PY + 16;
    dayText.eventMode = "none";
    this.mainContainer.addChild(dayText);

    // Tabs
    const TAB_Y = PY + 50;
    const tabDefs: { id: Tab; label: string }[] = [
      { id: "news", label: "НОВОСТИ" },
      { id: "search", label: "ПОИСК" },
    ];
    const TAB_W = 130;
    const TAB_H = 30;
    const tabsStartX = PX + 16;

    for (const [i, tab] of tabDefs.entries()) {
      const tx = tabsStartX + i * (TAB_W + 6);
      const isActive = this.activeTab === tab.id;

      const tabBg = new Graphics();
      tabBg.rect(tx, TAB_Y, TAB_W, TAB_H);
      tabBg.fill({ color: isActive ? 0x1a2a3a : 0x0d0d1a });
      tabBg.stroke({ color: isActive ? 0x88ccff : 0x334455, width: 1 });
      tabBg.eventMode = "static";
      tabBg.cursor = "pointer";
      tabBg.on("pointerdown", (e) => {
        e.stopPropagation();
        this.activeTab = tab.id;
        this.render();
        if (tab.id === "search") this.runSearch();
      });
      this.mainContainer.addChild(tabBg);

      const tabLabel = new Text({
        text: tab.label,
        style: {
          fontSize: 13,
          fill: isActive ? 0x88ccff : 0x556677,
          fontFamily: "monospace",
        },
      });
      tabLabel.anchor.set(0.5, 0.5);
      tabLabel.x = tx + TAB_W / 2;
      tabLabel.y = TAB_Y + TAB_H / 2;
      tabLabel.eventMode = "none";
      this.mainContainer.addChild(tabLabel);
    }

    // Content area
    const CONTENT_Y = TAB_Y + TAB_H + 6;
    const CONTENT_H = PH - (CONTENT_Y - PY) - 44;

    const content = new Container();
    content.x = PX;
    content.y = CONTENT_Y;
    this.mainContainer.addChild(content);

    if (this.activeTab === "news") {
      this.renderNews(content, PW, CONTENT_H);
    } else {
      this.renderSearch(content, PW, CONTENT_H);
    }

    // Back button
    const back = new Text({
      text: "[ Закрыть  Esc ]",
      style: { fontSize: 14, fill: 0x88ccff, fontFamily: "monospace" },
    });
    back.anchor.set(0.5, 1);
    back.x = PX + PW / 2;
    back.y = PY + PH - 10;
    back.eventMode = "static";
    back.cursor = "pointer";
    back.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.goBack();
    });
    back.on("pointerover", () => {
      back.alpha = 0.7;
    });
    back.on("pointerout", () => {
      back.alpha = 1;
    });
    this.mainContainer.addChild(back);
  }

  // ── news tab ───────────────────────────────────────────────────────────────

  private renderNews(container: Container, pw: number, ph: number): void {
    const ROW_H = 38;
    const VISIBLE = Math.floor(ph / ROW_H);
    const PAD = 16;

    const clampedScroll = Math.max(
      0,
      Math.min(this.newsScroll, Math.max(0, this.newsItems.length - VISIBLE)),
    );
    this.newsScroll = clampedScroll;

    const visible = this.newsItems.slice(
      clampedScroll,
      clampedScroll + VISIBLE,
    );

    // Clip mask
    const mask = new Graphics();
    mask.rect(PAD, 0, pw - PAD * 2, ph);
    mask.fill({ color: 0xffffff });
    container.addChild(mask);
    container.mask = mask;

    for (const [i, item] of visible.entries()) {
      const y = i * ROW_H;

      const rowBg = new Graphics();
      rowBg.rect(PAD, y + 2, pw - PAD * 2, ROW_H - 4);
      rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
      container.addChild(rowBg);

      // Day badge
      const dayBadge = new Text({
        text: `Д${item.day}`,
        style: { fontSize: 11, fill: 0x445566, fontFamily: "monospace" },
      });
      dayBadge.x = PAD + 6;
      dayBadge.y = y + ROW_H / 2 - 7;
      dayBadge.eventMode = "none";
      container.addChild(dayBadge);

      // News text
      const news = new Text({
        text: item.text,
        style: {
          fontSize: 13,
          fill: item.color,
          fontFamily: "monospace",
          wordWrap: true,
          wordWrapWidth: pw - PAD * 2 - 50,
        },
      });
      news.x = PAD + 46;
      news.y = y + ROW_H / 2 - 7;
      news.eventMode = "none";
      container.addChild(news);
    }

    // Scroll hint
    if (this.newsItems.length > VISIBLE) {
      const hint = new Text({
        text: `↑↓  ${clampedScroll + 1}–${Math.min(clampedScroll + VISIBLE, this.newsItems.length)} / ${this.newsItems.length}`,
        style: { fontSize: 11, fill: 0x334455, fontFamily: "monospace" },
      });
      hint.anchor.set(1, 1);
      hint.x = pw - PAD;
      hint.y = ph - 2;
      hint.eventMode = "none";
      container.addChild(hint);
    }
  }

  // ── search tab ─────────────────────────────────────────────────────────────

  private renderSearch(container: Container, pw: number, _ph: number): void {
    const PAD = 16;
    const CAT_W = 180;
    const ITEM_H = 32;

    // Category toggle
    const catDefs: { id: SearchCategory; label: string }[] = [
      { id: "resource", label: "Ресурсы" },
      { id: "gear", label: "Снаряжение" },
    ];
    for (const [i, cat] of catDefs.entries()) {
      const isActive = this.searchCategory === cat.id;
      const cx = PAD + i * 96;

      const bg = new Graphics();
      bg.roundRect(cx, 0, 88, 26, 4);
      bg.fill({ color: isActive ? 0x1a2a3a : 0x0d0d1a });
      bg.stroke({ color: isActive ? 0x88ccff : 0x334455, width: 1 });
      bg.eventMode = "static";
      bg.cursor = "pointer";
      bg.on("pointerdown", (e) => {
        e.stopPropagation();
        this.searchCategory = cat.id;
        this.runSearch();
        this.render();
      });
      container.addChild(bg);

      const label = new Text({
        text: cat.label,
        style: {
          fontSize: 12,
          fill: isActive ? 0x88ccff : 0x556677,
          fontFamily: "monospace",
        },
      });
      label.anchor.set(0.5, 0.5);
      label.x = cx + 44;
      label.y = 13;
      label.eventMode = "none";
      container.addChild(label);
    }

    const LIST_Y = 36;

    // Left: selectable items
    const items =
      this.searchCategory === "resource"
        ? ALL_RESOURCES.map((r) => ({ id: r, label: RESOURCE_RU[r] }))
        : ALL_GEAR_KINDS.map((k) => ({ id: k, label: GEAR_KIND_RU[k] }));

    for (const [i, item] of items.entries()) {
      const y = LIST_Y + i * ITEM_H;
      const isSelected =
        this.searchCategory === "resource"
          ? item.id === this.selectedResource
          : item.id === this.selectedGearKind;

      const bg = new Graphics();
      bg.rect(PAD, y, CAT_W, ITEM_H - 2);
      bg.fill({ color: isSelected ? 0x152535 : 0x0d1220 });
      bg.stroke({ color: isSelected ? 0x88ccff : 0x223344, width: 1 });
      bg.eventMode = "static";
      bg.cursor = "pointer";
      bg.on("pointerdown", (e) => {
        e.stopPropagation();
        if (this.searchCategory === "resource") {
          this.selectedResource = item.id as ResourceType;
        } else {
          this.selectedGearKind = item.id as GearKind;
        }
        this.runSearch();
        this.render();
      });
      container.addChild(bg);

      const label = new Text({
        text: item.label,
        style: {
          fontSize: 12,
          fill: isSelected ? 0xeeddaa : 0x889aaa,
          fontFamily: "monospace",
        },
      });
      label.x = PAD + 8;
      label.y = y + ITEM_H / 2 - 7;
      label.eventMode = "none";
      container.addChild(label);
    }

    // Right: results
    const RX = PAD + CAT_W + 16;
    const RW = pw - RX - PAD;

    const resultsTitle = new Text({
      text:
        this.searchCategory === "resource"
          ? `Где купить: ${RESOURCE_RU[this.selectedResource]}`
          : `Где найти: ${GEAR_KIND_RU[this.selectedGearKind]}`,
      style: { fontSize: 13, fill: 0x88ccff, fontFamily: "monospace" },
    });
    resultsTitle.x = RX;
    resultsTitle.y = LIST_Y;
    resultsTitle.eventMode = "none";
    container.addChild(resultsTitle);

    if (this.searchResults.length === 0) {
      const empty = new Text({
        text: "Нет данных в этом секторе",
        style: { fontSize: 13, fill: 0x445566, fontFamily: "monospace" },
      });
      empty.x = RX;
      empty.y = LIST_Y + 30;
      empty.eventMode = "none";
      container.addChild(empty);
    } else {
      for (const [i, line] of this.searchResults.entries()) {
        const y = LIST_Y + 28 + i * 26;

        const rowBg = new Graphics();
        rowBg.rect(RX - 4, y - 2, RW, 24);
        rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
        container.addChild(rowBg);

        const resultText = new Text({
          text: line,
          style: { fontSize: 12, fill: 0xaabbcc, fontFamily: "monospace" },
        });
        resultText.x = RX;
        resultText.y = y;
        resultText.eventMode = "none";
        container.addChild(resultText);
      }
    }
  }

  // ── search logic ───────────────────────────────────────────────────────────

  private runSearch(): void {
    this.searchResults = [];
    const registry = this.gameEngine?.getInfoRegistry();
    const galaxy = this.gameEngine?.galaxy;
    if (!registry || !galaxy) return;

    const systemMap = new Map<string, StarSystem>(
      galaxy.systems.map((s) => [s.id, s]),
    );
    const originId =
      this.gameEngine?.player?.currentSystemId ?? galaxy.systems[0]?.id ?? "";

    if (this.searchCategory === "resource") {
      const hits = registry.findResource({
        resource: this.selectedResource,
        originSystemId: originId,
        sort: "price",
        limit: 8,
      });
      for (const h of hits) {
        const sysName = systemMap.get(h.systemId)?.name ?? h.systemId;
        const dist = h.jumps === 0 ? "здесь" : `${h.jumps} пр.`;
        this.searchResults.push(
          `${dist.padEnd(7)} ${sysName.padEnd(16)} — ${h.price} ₡`,
        );
      }
    } else {
      // Gear search: find the best tech-level gear of this kind across galaxy
      const hits = registry.findGear({
        originSystemId: originId,
        kind: this.selectedGearKind,
        sort:
          this.selectedGearKind === GearKind.WEAPON
            ? "damage"
            : this.selectedGearKind === GearKind.HULL
              ? "hp"
              : "price",
        limit: 8,
      });
      for (const h of hits) {
        const sysName = systemMap.get(h.systemId)?.name ?? h.systemId;
        const dist = h.jumps === 0 ? "здесь" : `${h.jumps} пр.`;
        const kindColor = GEAR_KIND_COLOR[h.gear.kind];
        void kindColor; // used for future badge; text-only for now
        this.searchResults.push(
          `${dist.padEnd(7)} ${sysName.padEnd(14)} T${h.gear.techLevel} ${h.gear.name.slice(0, 18).padEnd(18)} ${h.price} ₡`,
        );
      }
    }
  }

  // ── input ──────────────────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      void this.goBack();
      return;
    }
    if (this.activeTab === "news") {
      if (e.key === "ArrowUp") this.scrollNews(-1);
      if (e.key === "ArrowDown") this.scrollNews(1);
    }
  }

  private scrollNews(delta: number): void {
    this.newsScroll = Math.max(
      0,
      Math.min(
        this.newsScroll + delta,
        Math.max(0, this.newsItems.length - 10),
      ),
    );
    this.render();
  }

  private async goBack(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }
}
