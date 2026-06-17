import { Container, Graphics, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import type { StarSystem } from "@/domain/StarSystem";
import { SceneType, NpcRole, ResourceType } from "@/types";
import type { NewsEvent } from "@/types";
import type {
  PlanetHit,
  ShipLocation,
  EquipmentFacet,
  EquipmentHit,
} from "@/systems/info/GalacticRegistry";
import {
  GearKind,
  EquipmentClass,
  gearById,
  type EquipmentSpec,
  type HullSpec,
  type WeaponSpec,
  type Gear,
} from "@/systems/equipment/GearCatalog";
import { attachWheelScroll } from "./ui/WheelScroll";
import { logger } from "@/utils/logger";

interface InfoContext {
  gameEngine?: GameEngine;
  planet?: Planet;
  station?: Station;
}

// ── Localisation ────────────────────────────────────────────────────────────

const NEWS_TYPE_LABEL: Record<NewsEvent["type"], string> = {
  NPC_QUEST_COMPLETE: "[РЕЙНДЖЕР]",
  PIRATE_ATTACK: "[АТАКА]",
  MARKET_SHIFT: "[РЫНОК]",
  OVERMIND_EXPANSION: "[УГРОЗА]",
  PIRATE_SURGE: "[ПИРАТЫ]",
  TRADE_BOOM: "[ТОРГОВЛЯ]",
  PLAGUE: "[ЭПИДЕМИЯ]",
  DISCOVERY: "[ОТКРЫТИЕ]",
  SYSTEM_LIBERATED: "[ОСВОБОЖДЕНИЕ]",
  SYSTEM_CAPTURED: "[ЗАХВАТ]",
  LIBERATION_CAMPAIGN: "[ПОХОД]",
};

const NEWS_TYPE_COLOR: Record<NewsEvent["type"], number> = {
  NPC_QUEST_COMPLETE: 0x88ddaa,
  PIRATE_ATTACK: 0xff5544,
  MARKET_SHIFT: 0xaabb88,
  OVERMIND_EXPANSION: 0xff3388,
  PIRATE_SURGE: 0xff7700,
  TRADE_BOOM: 0x44cc88,
  PLAGUE: 0xcc44aa,
  DISCOVERY: 0x44aaff,
  SYSTEM_LIBERATED: 0xffcc00,
  SYSTEM_CAPTURED: 0xff3388,
  LIBERATION_CAMPAIGN: 0x66ccff,
};

const GEAR_SORT_LABELS: Record<string, string> = {
  price: "Цена",
  tech: "Уровень",
  distance: "Расстояние",
};

function gearStatLine(g: Gear): string {
  if (g.kind === GearKind.HULL) {
    const h = g as HullSpec;
    return `ПП:${h.hp} трюм:${h.cargo} слоты:${h.slots}`;
  }
  if (g.kind === GearKind.WEAPON) {
    const w = g as WeaponSpec;
    return `урон:${w.damage} дальн:${w.range}`;
  }
  const eq = g as EquipmentSpec;
  return `потенц:${eq.potency}`;
}

// ── News generation ─────────────────────────────────────────────────────────

interface NewsItem {
  day: number;
  text: string;
  color: number;
  bookmarkKey: number;
}

function newsKey(day: number, text: string): number {
  let h = (day * 100003) >>> 0;
  for (let i = 0; i < Math.min(text.length, 24); i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h % 2_000_000_000;
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

  const feedEvents = [...galaxy.newsFeed].reverse().slice(0, 20);
  for (const event of feedEvents) {
    const sysName = systemMap.get(event.systemId)?.name ?? event.systemId;
    const label = NEWS_TYPE_LABEL[event.type] ?? "[СОБЫТИЕ]";
    const color = NEWS_TYPE_COLOR[event.type] ?? 0xaaaaaa;
    const desc = event.description || `${label} в системе ${sysName}`;
    items.push({
      day: event.day,
      text: desc,
      color,
      bookmarkKey: newsKey(event.day, desc),
    });
  }

  if (registry) {
    const pirates = registry.findShips({
      originSystemId: originId,
      role: NpcRole.PIRATE,
      maxJumps: 3,
    });
    for (const p of pirates.slice(0, 4)) {
      const sysName = systemMap.get(p.systemId)?.name ?? p.systemId;
      const dist = p.jumps === 0 ? "текущая система" : `${p.jumps} пр.`;
      const text = `[ТРЕВОГА] Пираты в системе "${sysName}" (${dist})`;
      items.push({
        day,
        text,
        color: 0xff5544,
        bookmarkKey: newsKey(day, text),
      });
    }

    const hotResources: ResourceType[] = [
      ResourceType.FUEL,
      ResourceType.METALS,
      ResourceType.MEDICINE,
      ResourceType.ELECTRONICS,
      ResourceType.CRYSTALS,
    ];
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

      // Price delta vs current system
      let deltaStr = "";
      if (hit.jumps > 0) {
        const localHit = registry.findResource({
          resource: res,
          originSystemId: originId,
          maxJumps: 0,
          sort: "price",
          limit: 1,
        })[0];
        if (localHit && localHit.price > 0) {
          const pct = Math.round(
            ((hit.price - localHit.price) / localHit.price) * 100,
          );
          if (pct < 0) deltaStr = ` ▼${Math.abs(pct)}% vs здесь`;
          else if (pct > 0) deltaStr = ` ▲${pct}% vs здесь`;
        }
      }

      const text = `[РЫНОК] ${RESOURCE_RU[res]}: лучшая цена "${sysName}" — ${hit.price} ₡${deltaStr} (${dist})`;
      items.push({
        day: day - (hit.systemId.charCodeAt(0) % 3),
        text,
        color: 0x88ddaa,
        bookmarkKey: newsKey(day, text),
      });
    }

    const traders = registry.findShips({
      originSystemId: originId,
      role: NpcRole.TRADER,
      maxJumps: 2,
    });
    if (traders.length > 0) {
      const sysName =
        systemMap.get(traders[0].systemId)?.name ?? traders[0].systemId;
      const text = `[ТРАФИК] Торговцы активны в системе "${sysName}"`;
      items.push({
        day,
        text,
        color: 0xaaaaff,
        bookmarkKey: newsKey(day, text),
      });
    }

    const patrols = registry.findShips({
      originSystemId: originId,
      role: NpcRole.PATROL,
      maxJumps: 2,
    });
    if (patrols.length > 0) {
      const sysName =
        systemMap.get(patrols[0].systemId)?.name ?? patrols[0].systemId;
      const text = `[ПАТРУЛЬ] Флот охраны обнаружен в системе "${sysName}"`;
      items.push({
        day,
        text,
        color: 0x88bbff,
        bookmarkKey: newsKey(day, text),
      });
    }
  }

  const lore: [number, string][] = [
    [day - 1, "Совет Независимых обсуждает нейтральный договор с Бастионом"],
    [day - 2, "Прогрессоры объявили о новой серии кораблей класса «Омега»"],
    [day - 3, "Окраинники расширяют торговые маршруты в южный сектор"],
    [day - 4, "Синдикат отрицает атаки на транспортные конвои"],
    [day - 5, "Бастион увеличил военное производство на 40%"],
    [day - 6, "Парадоксы зафиксированы вблизи запретной зоны R-17"],
    [day - 7, "Рейнджеры сообщают об аномальной активности в туманности"],
  ];
  for (const [d, loreText] of lore) {
    const text = `[НОВОСТИ] ${loreText}`;
    items.push({
      day: d,
      text,
      color: 0x666677,
      bookmarkKey: newsKey(d, text),
    });
  }

  items.sort((a, b) => b.day - a.day);
  return items;
}

// ── Data-fog helper ──────────────────────────────────────────────────────────

function isStaleSystem(
  systemId: string,
  systemMap: Map<string, StarSystem>,
  currentDay: number,
): boolean {
  const sys = systemMap.get(systemId);
  if (!sys) return true;
  if (sys.lastVisitedDay === undefined) return true;
  return currentDay - sys.lastVisitedDay > 30;
}

// ── Scene ───────────────────────────────────────────────────────────────────

type Tab = "news" | "objects" | "gear";
type GearSortOption = "price" | "tech" | "distance";

const GEAR_SORT_OPTIONS: GearSortOption[] = ["price", "tech", "distance"];
const GEAR_MAX_PRICE_OPTIONS = [0, 1000, 5000, 10000, 50000];

const EQUIPMENT_FACETS: EquipmentFacet[] = [
  "engine",
  "hull",
  "weapon",
  "scanner",
  "shield",
  "other",
];

const FACET_LABELS: Record<EquipmentFacet, string> = {
  engine: "Двигатель",
  hull: "Корпус",
  weapon: "Оружие",
  scanner: "Сканер",
  shield: "Щит",
  other: "Прочее",
};

type ObjectResult =
  | { kind: "ship"; loc: ShipLocation & { jumps: number }; stale: boolean }
  | { kind: "planet"; hit: PlanetHit; stale: boolean };

export class InfoCenterScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private station: Station | null = null;

  private mainContainer: Container | null = null;
  private blocked = false;

  // tab state
  private activeTab: Tab = "news";
  private newsItems: NewsItem[] = [];
  private newsScroll = 0;

  // objects tab state
  private objectsQuery = "";
  private objectsResults: ObjectResult[] = [];

  // gear tab state — multi-select; empty set = all types shown
  private gearFacets = new Set<EquipmentFacet>(["engine" as EquipmentFacet]);
  private gearMinTech = 1;
  private gearMaxTech = 6;
  private gearMaxPriceIdx = 0; // index into GEAR_MAX_PRICE_OPTIONS
  private gearSort: GearSortOption = "price";
  private gearResults: EquipmentHit[] = [];

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private detachWheel: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  initialize(context?: object): void {
    const ctx = context as InfoContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;
    this.station = ctx?.station ?? null;
    this.blocked = false;

    const player = this.gameEngine?.player;
    const galaxy = this.gameEngine?.galaxy;
    if (player && galaxy) {
      const system = this.station
        ? null
        : galaxy.systems.find((s) =>
            s.planets.some((p) => p.id === this.planet?.id),
          );
      const faction = String(
        this.station?.faction ??
          (system as { ownerFaction?: string } | undefined)?.ownerFaction ??
          "INDEPENDENT",
      );
      if (player.isHostileTo(faction)) {
        this.blocked = true;
      }
    }

    if (!this.blocked && this.gameEngine) {
      this.newsItems = buildNews(this.gameEngine);
    }

    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.render();

    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);
    // Mouse-wheel scrolls the news list (matches the ArrowUp/Down keys); only
    // the news tab is scrollable, so other tabs ignore the wheel.
    this.detachWheel = attachWheelScroll((dir) => {
      if (this.activeTab === "news") this.scrollNews(dir);
    });
  }

  update(_dt: number): void {}

  destroy(): void {
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.detachWheel) {
      this.detachWheel();
      this.detachWheel = null;
    }
    if (this.mainContainer) {
      this.renderer.uiLayer.removeChild(this.mainContainer);
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }
    this.gameEngine = null;
    this.planet = null;
    this.station = null;
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.mainContainer) return;
    this.mainContainer.removeChildren();

    if (this.blocked) {
      this.renderBlocked();
      return;
    }

    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh);
    bg.fill({ color: 0x000000, alpha: 0.9 });
    bg.eventMode = "static";
    this.mainContainer.addChild(bg);

    const PW = Math.min(860, sw - 40);
    const PH = sh - 60;
    const PX = (sw - PW) / 2;
    const PY = 20;

    const panel = new Graphics();
    panel.rect(PX, PY, PW, PH);
    panel.fill({ color: 0x0a0a1a, alpha: 1 });
    panel.stroke({ color: 0x334455, width: 1 });
    this.mainContainer.addChild(panel);

    const title = new Text({
      text: "[ ИНФОЦЕНТР ]",
      style: { fontSize: 22, fill: 0x88ccff, fontFamily: "monospace" },
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 14;
    title.eventMode = "none";
    this.mainContainer.addChild(title);

    const day = this.gameEngine?.galaxy?.gameDays ?? 0;
    const dayText = new Text({
      text: `День ${day}`,
      style: { fontSize: 13, fill: 0x88aacc, fontFamily: "monospace" },
    });
    dayText.anchor.set(1, 0);
    dayText.x = PX + PW - 14;
    dayText.y = PY + 16;
    dayText.eventMode = "none";
    this.mainContainer.addChild(dayText);

    const credits = this.gameEngine?.player?.credits ?? 0;
    const creditsText = new Text({
      text: `Кредиты: ${credits.toLocaleString()} ₢`,
      style: { fontSize: 13, fill: 0x88ddaa, fontFamily: "monospace" },
    });
    creditsText.anchor.set(0, 0);
    creditsText.x = PX + 14;
    creditsText.y = PY + 16;
    creditsText.eventMode = "none";
    this.mainContainer.addChild(creditsText);

    // 3-tab switcher
    const TAB_Y = PY + 50;
    const tabDefs: { id: Tab; label: string }[] = [
      { id: "news", label: "НОВОСТИ" },
      { id: "objects", label: "ОБЪЕКТЫ" },
      { id: "gear", label: "СНАРЯЖЕНИЕ" },
    ];
    const TAB_W = 120;
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
      });
      this.mainContainer.addChild(tabBg);

      const tabLabel = new Text({
        text: tab.label,
        style: {
          fontSize: 12,
          fill: isActive ? 0x88ccff : 0x7799bb,
          fontFamily: "monospace",
        },
      });
      tabLabel.anchor.set(0.5, 0.5);
      tabLabel.x = tx + TAB_W / 2;
      tabLabel.y = TAB_Y + TAB_H / 2;
      tabLabel.eventMode = "none";
      this.mainContainer.addChild(tabLabel);
    }

    const CONTENT_Y = TAB_Y + TAB_H + 6;
    const CONTENT_H = PH - (CONTENT_Y - PY) - 44;

    const content = new Container();
    content.x = PX;
    content.y = CONTENT_Y;
    this.mainContainer.addChild(content);

    if (this.activeTab === "news") {
      this.renderNews(content, PW, CONTENT_H);
    } else if (this.activeTab === "objects") {
      this.renderObjects(content, PW, CONTENT_H);
    } else {
      this.renderGear(content, PW, CONTENT_H);
    }

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

  private renderBlocked(): void {
    const sw = this.renderer.app.screen.width;
    const sh = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, sw, sh);
    bg.fill({ color: 0x000000, alpha: 0.85 });
    bg.eventMode = "static";
    this.mainContainer!.addChild(bg);

    const msg = new Text({
      text: "Инфоцентр недоступен\n\n(Враждебное отношение)",
      style: {
        fontSize: 20,
        fill: 0x884444,
        fontFamily: "monospace",
        align: "center",
      },
    });
    msg.anchor.set(0.5, 0.5);
    msg.x = sw / 2;
    msg.y = sh / 2 - 20;
    msg.eventMode = "none";
    this.mainContainer!.addChild(msg);

    const back = new Text({
      text: "[ Закрыть  Esc ]",
      style: { fontSize: 14, fill: 0x88ccff, fontFamily: "monospace" },
    });
    back.anchor.set(0.5, 1);
    back.x = sw / 2;
    back.y = sh / 2 + 60;
    back.eventMode = "static";
    back.cursor = "pointer";
    back.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.goBack();
    });
    this.mainContainer!.addChild(back);
  }

  // ── news tab ───────────────────────────────────────────────────────────────

  private renderNews(container: Container, pw: number, ph: number): void {
    const ROW_H = 38;
    const VISIBLE = Math.floor(ph / ROW_H);
    const PAD = 16;
    const STAR_W = 28;

    const clampedScroll = Math.max(
      0,
      Math.min(this.newsScroll, Math.max(0, this.newsItems.length - VISIBLE)),
    );
    this.newsScroll = clampedScroll;

    const visible = this.newsItems.slice(
      clampedScroll,
      clampedScroll + VISIBLE,
    );

    const mask = new Graphics();
    mask.rect(PAD, 0, pw - PAD * 2, ph);
    mask.fill({ color: 0xffffff });
    container.addChild(mask);
    container.mask = mask;

    const bookmarks = this.gameEngine?.player?.newsBookmarks ?? [];

    for (const [i, item] of visible.entries()) {
      const y = i * ROW_H;

      const rowBg = new Graphics();
      rowBg.rect(PAD, y + 2, pw - PAD * 2, ROW_H - 4);
      rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
      container.addChild(rowBg);

      const dayBadge = new Text({
        text: `Д${item.day}`,
        style: { fontSize: 11, fill: 0x88aacc, fontFamily: "monospace" },
      });
      dayBadge.x = PAD + 6;
      dayBadge.y = y + ROW_H / 2 - 7;
      dayBadge.eventMode = "none";
      container.addChild(dayBadge);

      const news = new Text({
        text: item.text,
        style: {
          fontSize: 13,
          fill: item.color,
          fontFamily: "monospace",
          wordWrap: true,
          wordWrapWidth: pw - PAD * 2 - 50 - STAR_W,
        },
      });
      news.x = PAD + 46;
      news.y = y + ROW_H / 2 - 7;
      news.eventMode = "none";
      container.addChild(news);

      const isBookmarked = bookmarks.includes(item.bookmarkKey);
      const star = new Text({
        text: isBookmarked ? "★" : "☆",
        style: {
          fontSize: 16,
          fill: isBookmarked ? 0xffdd44 : 0x334455,
          fontFamily: "monospace",
        },
      });
      star.x = pw - PAD - STAR_W + 4;
      star.y = y + ROW_H / 2 - 9;
      star.eventMode = "static";
      star.cursor = "pointer";
      star.on("pointerdown", (e) => {
        e.stopPropagation();
        this.toggleBookmark(item.bookmarkKey);
      });
      container.addChild(star);
    }

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

  private toggleBookmark(key: number): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    const idx = player.newsBookmarks.indexOf(key);
    if (idx >= 0) {
      player.newsBookmarks.splice(idx, 1);
    } else {
      player.newsBookmarks.push(key);
    }
    this.render();
  }

  // ── objects tab ────────────────────────────────────────────────────────────

  private renderObjects(container: Container, pw: number, ph: number): void {
    const PAD = 16;

    // Text input box
    const inputBg = new Graphics();
    inputBg.rect(PAD, 4, pw - PAD * 2 - 110, 30);
    inputBg.fill({ color: 0x0d1522 });
    // The objects tab takes keyboard input as soon as it is open, so the input
    // box always renders in its focused (blue) state here.
    inputBg.stroke({ color: 0x88ccff, width: 1 });
    inputBg.eventMode = "static";
    inputBg.cursor = "text";
    // Clicking the box just swallows the event; the tab is already accepting
    // keystrokes, so there is no separate focus state to toggle.
    inputBg.on("pointerdown", (e) => {
      e.stopPropagation();
    });
    container.addChild(inputBg);

    const queryText =
      this.objectsQuery.length > 0
        ? this.objectsQuery
        : "Введите имя NPC или планеты...";
    const inputLabel = new Text({
      text: queryText,
      style: {
        fontSize: 13,
        fill: this.objectsQuery.length > 0 ? 0xeeddaa : 0x88aacc,
        fontFamily: "monospace",
      },
    });
    inputLabel.x = PAD + 6;
    inputLabel.y = 11;
    inputLabel.eventMode = "none";
    container.addChild(inputLabel);

    // cursor indicator — always shown; the input is focused whenever this tab
    // is open.
    const cursor = new Text({
      text: "|",
      style: { fontSize: 13, fill: 0x88ccff, fontFamily: "monospace" },
    });
    cursor.x = PAD + 8 + inputLabel.width;
    cursor.y = 11;
    cursor.eventMode = "none";
    container.addChild(cursor);

    // Search button
    const btnX = pw - PAD - 100;
    const searchBtn = new Graphics();
    searchBtn.rect(btnX, 4, 94, 30);
    searchBtn.fill({ color: 0x112233 });
    searchBtn.stroke({ color: 0x88ccff, width: 1 });
    searchBtn.eventMode = "static";
    searchBtn.cursor = "pointer";
    searchBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.runObjectsSearch();
      this.render();
    });
    container.addChild(searchBtn);

    const searchBtnLabel = new Text({
      text: "[ Найти ]",
      style: { fontSize: 13, fill: 0x88ccff, fontFamily: "monospace" },
    });
    searchBtnLabel.anchor.set(0.5, 0.5);
    searchBtnLabel.x = btnX + 47;
    searchBtnLabel.y = 19;
    searchBtnLabel.eventMode = "none";
    container.addChild(searchBtnLabel);

    // Results
    const LIST_Y = 44;
    const ROW_H = 34;
    const VISIBLE = Math.floor((ph - LIST_Y) / ROW_H);

    if (this.objectsResults.length === 0) {
      const empty = new Text({
        text:
          this.objectsQuery.length === 0
            ? "Введите запрос и нажмите Найти или Enter"
            : "Ничего не найдено",
        style: { fontSize: 13, fill: 0x88aacc, fontFamily: "monospace" },
      });
      empty.x = PAD;
      empty.y = LIST_Y + 10;
      empty.eventMode = "none";
      container.addChild(empty);
      return;
    }

    const galaxy = this.gameEngine?.galaxy;
    const systemMap = new Map<string, StarSystem>(
      galaxy?.systems.map((s) => [s.id, s]) ?? [],
    );
    const currentDay = galaxy?.gameDays ?? 0;

    for (const [i, result] of this.objectsResults.slice(0, VISIBLE).entries()) {
      const y = LIST_Y + i * ROW_H;

      const rowBg = new Graphics();
      rowBg.rect(PAD, y + 1, pw - PAD * 2, ROW_H - 2);
      rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
      container.addChild(rowBg);

      const stale =
        result.kind === "ship"
          ? isStaleSystem(result.loc.systemId, systemMap, currentDay)
          : isStaleSystem(result.hit.systemId, systemMap, currentDay);

      const name =
        result.kind === "ship" ? result.loc.name : result.hit.planetName;
      const sysName =
        result.kind === "ship"
          ? (systemMap.get(result.loc.systemId)?.name ?? result.loc.systemId)
          : result.hit.systemName;
      const jumps =
        result.kind === "ship" ? result.loc.jumps : result.hit.jumps;
      const typeLabel = result.kind === "ship" ? "[NPC]" : "[ПЛН]";
      const systemId =
        result.kind === "ship" ? result.loc.systemId : result.hit.systemId;

      const distStr = jumps === 0 ? "здесь" : `${jumps} пр.`;
      const staleStr = stale ? " (уст.)" : "";
      const lineText = `${typeLabel} ${name.padEnd(16)} ${sysName}${staleStr} — ${distStr}`;

      const lineLabel = new Text({
        text: lineText,
        style: {
          fontSize: 12,
          fill: stale ? 0x7799aa : 0xaabbcc,
          fontFamily: "monospace",
        },
      });
      lineLabel.x = PAD + 4;
      lineLabel.y = y + ROW_H / 2 - 8;
      lineLabel.eventMode = "none";
      container.addChild(lineLabel);

      // "→ карта" button
      const mapBtnX = pw - PAD - 76;
      const mapBtn = new Graphics();
      mapBtn.rect(mapBtnX, y + 4, 70, ROW_H - 8);
      mapBtn.fill({ color: 0x0d1a22 });
      mapBtn.stroke({ color: 0x334466, width: 1 });
      mapBtn.eventMode = "static";
      mapBtn.cursor = "pointer";
      mapBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        void this.openStarMapForSystem(systemId);
      });
      container.addChild(mapBtn);

      const mapBtnLabel = new Text({
        text: "→ карта",
        style: { fontSize: 11, fill: 0x6699bb, fontFamily: "monospace" },
      });
      mapBtnLabel.anchor.set(0.5, 0.5);
      mapBtnLabel.x = mapBtnX + 35;
      mapBtnLabel.y = y + ROW_H / 2;
      mapBtnLabel.eventMode = "none";
      container.addChild(mapBtnLabel);
    }

    if (this.objectsResults.length > VISIBLE) {
      const hint = new Text({
        text: `показаны первые ${VISIBLE} из ${this.objectsResults.length}`,
        style: { fontSize: 11, fill: 0x334455, fontFamily: "monospace" },
      });
      hint.anchor.set(1, 1);
      hint.x = pw - PAD;
      hint.y = ph - 2;
      hint.eventMode = "none";
      container.addChild(hint);
    }
  }

  private runObjectsSearch(): void {
    this.objectsResults = [];
    const registry = this.gameEngine?.getInfoRegistry();
    const galaxy = this.gameEngine?.galaxy;
    logger.debug(
      `[InfoCenter] runObjectsSearch: query="${this.objectsQuery.trim()}" registry=${!!registry} galaxy=${!!galaxy}`,
    );
    if (!registry || !galaxy || this.objectsQuery.trim().length === 0) return;

    const originId =
      this.gameEngine?.player?.currentSystemId ?? galaxy.systems[0]?.id ?? "";
    const systemMap = new Map<string, StarSystem>(
      galaxy.systems.map((s) => [s.id, s]),
    );
    const currentDay = galaxy.gameDays;

    const ships = registry.findShips({
      originSystemId: originId,
      name: this.objectsQuery.trim(),
    });
    for (const loc of ships.slice(0, 10)) {
      const stale = isStaleSystem(loc.systemId, systemMap, currentDay);
      this.objectsResults.push({ kind: "ship", loc, stale });
    }

    const planets = registry.findPlanet({
      name: this.objectsQuery.trim(),
      originSystemId: originId,
    });
    for (const hit of planets.slice(0, 10)) {
      const stale = isStaleSystem(hit.systemId, systemMap, currentDay);
      this.objectsResults.push({ kind: "planet", hit, stale });
    }

    this.objectsResults.sort((a, b) => {
      const ja = a.kind === "ship" ? a.loc.jumps : a.hit.jumps;
      const jb = b.kind === "ship" ? b.loc.jumps : b.hit.jumps;
      return ja - jb;
    });
  }

  // ── gear tab ───────────────────────────────────────────────────────────────

  private renderGear(container: Container, pw: number, ph: number): void {
    const PAD = 16;
    const CTRL_H = 28;
    const GAP = 6;

    // Faceted pill buttons row (top)
    const PILL_Y = 4;
    const PILL_H = 26;
    const pillWidths = EQUIPMENT_FACETS.map(
      (f) => FACET_LABELS[f].length * 8 + 16,
    );
    let px = PAD;
    for (const [i, facet] of EQUIPMENT_FACETS.entries()) {
      const pw2 = pillWidths[i];
      const isActive = this.gearFacets.has(facet);
      const pill = new Graphics();
      pill.rect(px, PILL_Y, pw2, PILL_H);
      pill.fill({ color: isActive ? 0x1a3a5a : 0x0d0d1a });
      pill.stroke({ color: isActive ? 0x88ccff : 0x334455, width: 1 });
      pill.eventMode = "static";
      pill.cursor = "pointer";
      pill.on("pointerdown", (e) => {
        e.stopPropagation();
        if (this.gearFacets.has(facet)) {
          this.gearFacets.delete(facet);
        } else {
          this.gearFacets.add(facet);
        }
        this.render();
      });
      container.addChild(pill);
      const pillLabel = new Text({
        text: FACET_LABELS[facet],
        style: {
          fontSize: 11,
          fill: isActive ? 0x88ccff : 0x7799bb,
          fontFamily: "monospace",
        },
      });
      pillLabel.anchor.set(0.5, 0.5);
      pillLabel.x = px + pw2 / 2;
      pillLabel.y = PILL_Y + PILL_H / 2;
      pillLabel.eventMode = "none";
      container.addChild(pillLabel);
      px += pw2 + GAP;
    }

    // Show comparison bar only when exactly one facet is selected.
    const singleFacet =
      this.gearFacets.size === 1
        ? (this.gearFacets.values().next().value as EquipmentFacet)
        : null;
    const equippedItem = singleFacet
      ? this.getEquippedItemForFacet(singleFacet)
      : null;
    let equippedRowH = 0;
    if (equippedItem) {
      equippedRowH = 44;
      const EQUIPPED_Y = PILL_Y + PILL_H + 6;
      const equippedBg = new Graphics();
      equippedBg.rect(PAD, EQUIPPED_Y, pw - PAD * 2, equippedRowH - 2);
      equippedBg.fill({ color: 0x0d1f0d });
      equippedBg.stroke({ color: 0x336633, width: 1 });
      equippedBg.eventMode = "none";
      container.addChild(equippedBg);

      const equippedHdr = new Text({
        text: "▶ Установлено:",
        style: { fontSize: 10, fill: 0x55aa55, fontFamily: "monospace" },
      });
      equippedHdr.x = PAD + 6;
      equippedHdr.y = EQUIPPED_Y + 4;
      equippedHdr.eventMode = "none";
      container.addChild(equippedHdr);

      const equippedName = new Text({
        text: `T${equippedItem.techLevel}  ${equippedItem.name}`,
        style: { fontSize: 11, fill: 0x88dd88, fontFamily: "monospace" },
      });
      equippedName.x = PAD + 6;
      equippedName.y = EQUIPPED_Y + 16;
      equippedName.eventMode = "none";
      container.addChild(equippedName);

      const equippedStats = new Text({
        text: gearStatLine(equippedItem),
        style: { fontSize: 10, fill: 0x66bb66, fontFamily: "monospace" },
      });
      equippedStats.x = PAD + 220;
      equippedStats.y = EQUIPPED_Y + 16;
      equippedStats.eventMode = "none";
      container.addChild(equippedStats);
    }

    // Second controls row: tech level, max price, sort, find
    const CTRL_Y = PILL_Y + PILL_H + equippedRowH + 8;
    let cx = PAD;

    // Tech level range
    const techLabel = new Text({
      text: "Т.ур:",
      style: { fontSize: 12, fill: 0x88aacc, fontFamily: "monospace" },
    });
    techLabel.x = cx;
    techLabel.y = CTRL_Y + 7;
    techLabel.eventMode = "none";
    container.addChild(techLabel);
    cx += 38;

    // Tech min
    const techMinBg = new Graphics();
    techMinBg.rect(cx, CTRL_Y, 34, CTRL_H);
    techMinBg.fill({ color: 0x0d1522 });
    techMinBg.stroke({ color: 0x556677, width: 1 });
    techMinBg.eventMode = "static";
    techMinBg.cursor = "pointer";
    techMinBg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.gearMinTech = (this.gearMinTech % 6) + 1;
      if (this.gearMinTech > this.gearMaxTech)
        this.gearMaxTech = this.gearMinTech;
      this.render();
    });
    container.addChild(techMinBg);

    const techMinVal = new Text({
      text: String(this.gearMinTech),
      style: { fontSize: 12, fill: 0xaabbcc, fontFamily: "monospace" },
    });
    techMinVal.anchor.set(0.5, 0.5);
    techMinVal.x = cx + 17;
    techMinVal.y = CTRL_Y + CTRL_H / 2;
    techMinVal.eventMode = "none";
    container.addChild(techMinVal);
    cx += 34;

    const techSep = new Text({
      text: "–",
      style: { fontSize: 12, fill: 0x88aacc, fontFamily: "monospace" },
    });
    techSep.x = cx + 2;
    techSep.y = CTRL_Y + 7;
    techSep.eventMode = "none";
    container.addChild(techSep);
    cx += 14;

    // Tech max
    const techMaxBg = new Graphics();
    techMaxBg.rect(cx, CTRL_Y, 34, CTRL_H);
    techMaxBg.fill({ color: 0x0d1522 });
    techMaxBg.stroke({ color: 0x556677, width: 1 });
    techMaxBg.eventMode = "static";
    techMaxBg.cursor = "pointer";
    techMaxBg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.gearMaxTech = (this.gearMaxTech % 6) + 1;
      if (this.gearMaxTech < this.gearMinTech)
        this.gearMinTech = this.gearMaxTech;
      this.render();
    });
    container.addChild(techMaxBg);

    const techMaxVal = new Text({
      text: String(this.gearMaxTech),
      style: { fontSize: 12, fill: 0xaabbcc, fontFamily: "monospace" },
    });
    techMaxVal.anchor.set(0.5, 0.5);
    techMaxVal.x = cx + 17;
    techMaxVal.y = CTRL_Y + CTRL_H / 2;
    techMaxVal.eventMode = "none";
    container.addChild(techMaxVal);
    cx += 34 + GAP;

    // Max price
    const priceLabel = new Text({
      text: "Цена≤:",
      style: { fontSize: 12, fill: 0x88aacc, fontFamily: "monospace" },
    });
    priceLabel.x = cx;
    priceLabel.y = CTRL_Y + 7;
    priceLabel.eventMode = "none";
    container.addChild(priceLabel);
    cx += 52;

    const maxPrice = GEAR_MAX_PRICE_OPTIONS[this.gearMaxPriceIdx];
    const priceBg = new Graphics();
    priceBg.rect(cx, CTRL_Y, 72, CTRL_H);
    priceBg.fill({ color: 0x0d1522 });
    priceBg.stroke({ color: 0x556677, width: 1 });
    priceBg.eventMode = "static";
    priceBg.cursor = "pointer";
    priceBg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.gearMaxPriceIdx =
        (this.gearMaxPriceIdx + 1) % GEAR_MAX_PRICE_OPTIONS.length;
      this.render();
    });
    container.addChild(priceBg);

    const priceVal = new Text({
      text: maxPrice === 0 ? "любая" : `${maxPrice}₡`,
      style: { fontSize: 11, fill: 0xaabbcc, fontFamily: "monospace" },
    });
    priceVal.anchor.set(0.5, 0.5);
    priceVal.x = cx + 36;
    priceVal.y = CTRL_Y + CTRL_H / 2;
    priceVal.eventMode = "none";
    container.addChild(priceVal);
    cx += 72 + GAP;

    // Sort
    const sortLabel = new Text({
      text: "Сорт:",
      style: { fontSize: 12, fill: 0x88aacc, fontFamily: "monospace" },
    });
    sortLabel.x = cx;
    sortLabel.y = CTRL_Y + 7;
    sortLabel.eventMode = "none";
    container.addChild(sortLabel);
    cx += 44;

    const sortBg = new Graphics();
    sortBg.rect(cx, CTRL_Y, 84, CTRL_H);
    sortBg.fill({ color: 0x0d1522 });
    sortBg.stroke({ color: 0x556677, width: 1 });
    sortBg.eventMode = "static";
    sortBg.cursor = "pointer";
    sortBg.on("pointerdown", (e) => {
      e.stopPropagation();
      const idx = GEAR_SORT_OPTIONS.indexOf(this.gearSort);
      this.gearSort = GEAR_SORT_OPTIONS[(idx + 1) % GEAR_SORT_OPTIONS.length];
      this.render();
    });
    container.addChild(sortBg);

    const sortVal = new Text({
      text: GEAR_SORT_LABELS[this.gearSort],
      style: { fontSize: 12, fill: 0xaabbcc, fontFamily: "monospace" },
    });
    sortVal.anchor.set(0.5, 0.5);
    sortVal.x = cx + 42;
    sortVal.y = CTRL_Y + CTRL_H / 2;
    sortVal.eventMode = "none";
    container.addChild(sortVal);
    cx += 84 + GAP;

    // Find button
    const findBtnX = pw - PAD - 80;
    const findBtn = new Graphics();
    findBtn.rect(findBtnX, CTRL_Y, 74, CTRL_H);
    findBtn.fill({ color: 0x112233 });
    findBtn.stroke({ color: 0x88ccff, width: 1 });
    findBtn.eventMode = "static";
    findBtn.cursor = "pointer";
    findBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.runGearSearch();
      this.render();
    });
    container.addChild(findBtn);

    const findBtnLabel = new Text({
      text: "[ Найти ]",
      style: { fontSize: 12, fill: 0x88ccff, fontFamily: "monospace" },
    });
    findBtnLabel.anchor.set(0.5, 0.5);
    findBtnLabel.x = findBtnX + 37;
    findBtnLabel.y = CTRL_Y + CTRL_H / 2;
    findBtnLabel.eventMode = "none";
    container.addChild(findBtnLabel);

    // Results
    const LIST_Y = CTRL_Y + CTRL_H + 8;
    const ROW_H = 38;
    const VISIBLE = Math.floor((ph - LIST_Y) / ROW_H);

    if (this.gearResults.length === 0) {
      const empty = new Text({
        text: "Нажмите Найти для поиска снаряжения",
        style: { fontSize: 13, fill: 0x88aacc, fontFamily: "monospace" },
      });
      empty.x = PAD;
      empty.y = LIST_Y + 10;
      empty.eventMode = "none";
      container.addChild(empty);
      return;
    }

    const galaxy = this.gameEngine?.galaxy;
    const systemMap = new Map<string, StarSystem>(
      galaxy?.systems.map((s) => [s.id, s]) ?? [],
    );
    const currentDay = galaxy?.gameDays ?? 0;

    for (const [i, hit] of this.gearResults.slice(0, VISIBLE).entries()) {
      const y = LIST_Y + i * ROW_H;
      const stale = isStaleSystem(hit.systemId, systemMap, currentDay);

      const rowBg = new Graphics();
      rowBg.rect(PAD, y + 1, pw - PAD * 2, ROW_H - 2);
      rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
      container.addChild(rowBg);

      const distStr = hit.jumps === 0 ? "здесь" : `${hit.jumps} пр.`;
      const staleStr = stale ? " (уст.)" : "";
      const gearName = hit.gear.name.slice(0, 18).padEnd(18);
      const planetSys = `${hit.planet} / ${hit.system}`.slice(0, 22).padEnd(22);
      const lineText = `T${hit.gear.techLevel} ${gearName} ${planetSys}${staleStr} — ${hit.price}₡  ${distStr}`;

      const lineLabel = new Text({
        text: lineText,
        style: {
          fontSize: 11,
          fill: stale ? 0x7799aa : 0xaabbcc,
          fontFamily: "monospace",
        },
      });
      lineLabel.x = PAD + 4;
      lineLabel.y = y + 5;
      lineLabel.eventMode = "none";
      container.addChild(lineLabel);

      const statsLabel = new Text({
        text: gearStatLine(hit.gear),
        style: { fontSize: 10, fill: 0x557799, fontFamily: "monospace" },
      });
      statsLabel.x = PAD + 4;
      statsLabel.y = y + 20;
      statsLabel.eventMode = "none";
      container.addChild(statsLabel);

      // "→ карта" button
      const mapBtnX = pw - PAD - 70;
      const mapBtn = new Graphics();
      mapBtn.rect(mapBtnX, y + 3, 64, ROW_H - 6);
      mapBtn.fill({ color: 0x0d1a22 });
      mapBtn.stroke({ color: 0x334466, width: 1 });
      mapBtn.eventMode = "static";
      mapBtn.cursor = "pointer";
      mapBtn.on("pointerdown", (e) => {
        e.stopPropagation();
        void this.openStarMapForSystem(hit.systemId);
      });
      container.addChild(mapBtn);

      const mapBtnLabel = new Text({
        text: "→ карта",
        style: { fontSize: 10, fill: 0x6699bb, fontFamily: "monospace" },
      });
      mapBtnLabel.anchor.set(0.5, 0.5);
      mapBtnLabel.x = mapBtnX + 32;
      mapBtnLabel.y = y + ROW_H / 2;
      mapBtnLabel.eventMode = "none";
      container.addChild(mapBtnLabel);
    }

    if (this.gearResults.length > VISIBLE) {
      const hint = new Text({
        text: `показаны первые ${VISIBLE} из ${this.gearResults.length}`,
        style: { fontSize: 11, fill: 0x334455, fontFamily: "monospace" },
      });
      hint.anchor.set(1, 1);
      hint.x = pw - PAD;
      hint.y = ph - 2;
      hint.eventMode = "none";
      container.addChild(hint);
    }
  }

  private runGearSearch(): void {
    this.gearResults = [];
    const registry = this.gameEngine?.getInfoRegistry();
    const galaxy = this.gameEngine?.galaxy;
    if (!registry || !galaxy) return;

    const originId =
      this.gameEngine?.player?.currentSystemId ?? galaxy.systems[0]?.id ?? "";
    const maxPrice = GEAR_MAX_PRICE_OPTIONS[this.gearMaxPriceIdx];

    let hits = registry.findEquipment({
      originSystemId: originId,
      types: this.gearFacets.size > 0 ? [...this.gearFacets] : undefined,
      maxPrice: maxPrice > 0 ? maxPrice : undefined,
    });

    // Apply tech level filter
    hits = hits.filter(
      (h) =>
        h.gear.techLevel >= this.gearMinTech &&
        h.gear.techLevel <= this.gearMaxTech,
    );

    // Sort
    if (this.gearSort === "tech") {
      hits.sort(
        (a, b) => b.gear.techLevel - a.gear.techLevel || a.price - b.price,
      );
    } else if (this.gearSort === "distance") {
      hits.sort((a, b) => a.jumps - b.jumps || a.price - b.price);
    }
    // default "price" sort is already applied by findEquipment

    this.gearResults = hits.slice(0, 20);
  }

  private getEquippedItemForFacet(facet: EquipmentFacet): Gear | null {
    const loadout = this.gameEngine?.playerLoadout;
    if (!loadout) return null;
    if (facet === "hull") return loadout.hull;
    for (const id of loadout.installedGearIds()) {
      const g = gearById(id);
      if (!g) continue;
      if (facet === "weapon" && g.kind === GearKind.WEAPON) return g;
      if (g.kind === GearKind.EQUIPMENT) {
        const eq = g as EquipmentSpec;
        if (facet === "engine" && eq.equipmentClass === EquipmentClass.ENGINE)
          return g;
        if (facet === "scanner" && eq.equipmentClass === EquipmentClass.SCANNER)
          return g;
        if (facet === "shield" && eq.equipmentClass === EquipmentClass.SHIELD)
          return g;
        if (
          facet === "other" &&
          eq.equipmentClass !== EquipmentClass.ENGINE &&
          eq.equipmentClass !== EquipmentClass.SCANNER &&
          eq.equipmentClass !== EquipmentClass.SHIELD
        )
          return g;
      }
    }
    return null;
  }

  // ── navigation ──────────────────────────────────────────────────────────────

  private async openStarMapForSystem(systemId: string): Promise<void> {
    if (!this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.STAR_MAP, {
      gameEngine: this.gameEngine,
      pendingSelectedSystemId: systemId,
    });
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
      return;
    }
    // The objects tab is always "focused" for typing while it is active — no
    // separate click on the input box is required (playtest 2026-06-15 fix).
    if (this.activeTab === "objects") {
      if (e.key === "Enter") {
        this.runObjectsSearch();
        this.render();
        return;
      }
      if (e.key === "Backspace") {
        this.objectsQuery = this.objectsQuery.slice(0, -1);
        this.render();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        this.objectsQuery += e.key;
        this.render();
      }
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
    if (!this.gameEngine) return;
    if (this.station) {
      await this.gameEngine.transitionTo(SceneType.STATION, {
        gameEngine: this.gameEngine,
        station: this.station,
      });
    } else if (this.planet) {
      await this.gameEngine.transitionTo(SceneType.PLANET, {
        gameEngine: this.gameEngine,
        planet: this.planet,
      });
    } else {
      await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
        gameEngine: this.gameEngine,
      });
    }
  }
}
