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
  GearHit,
  PlanetHit,
  ShipLocation,
} from "@/systems/info/GalacticRegistry";
import { GearKind } from "@/systems/equipment/GearCatalog";

interface InfoContext {
  gameEngine?: GameEngine;
  planet?: Planet;
  station?: Station;
}

// ── Localisation ────────────────────────────────────────────────────────────

const GEAR_KIND_RU: Record<GearKind, string> = {
  [GearKind.HULL]: "Корпус",
  [GearKind.WEAPON]: "Оружие",
  [GearKind.EQUIPMENT]: "Снаряжение",
};

const NEWS_TYPE_LABEL: Record<NewsEvent["type"], string> = {
  NPC_QUEST_COMPLETE: "[РЕЙНДЖЕР]",
  PIRATE_ATTACK: "[АТАКА]",
  MARKET_SHIFT: "[РЫНОК]",
  OVERMIND_EXPANSION: "[УГРОЗА]",
};

const NEWS_TYPE_COLOR: Record<NewsEvent["type"], number> = {
  NPC_QUEST_COMPLETE: 0x88ddaa,
  PIRATE_ATTACK: 0xff5544,
  MARKET_SHIFT: 0xaabb88,
  OVERMIND_EXPANSION: 0xff3388,
};

const GEAR_SORT_LABELS: Record<string, string> = {
  price: "Цена",
  tech: "Уровень",
  distance: "Расстояние",
};

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
    const color = NEWS_TYPE_COLOR[event.type] ?? 0x888888;
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
      const text = `[РЫНОК] ${RESOURCE_RU[res]}: лучшая цена "${sysName}" — ${hit.price} ₡ (${dist})`;
      items.push({
        day: day - Math.floor(Math.random() * 3),
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

const ALL_GEAR_KINDS = Object.values(GearKind);
const GEAR_SORT_OPTIONS: GearSortOption[] = ["price", "tech", "distance"];
const GEAR_MAX_PRICE_OPTIONS = [0, 1000, 5000, 10000, 50000];

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
  private objectsInputFocused = false;

  // gear tab state
  private gearKind: GearKind = GearKind.HULL;
  private gearMinTech = 1;
  private gearMaxTech = 6;
  private gearMaxPriceIdx = 0; // index into GEAR_MAX_PRICE_OPTIONS
  private gearSort: GearSortOption = "price";
  private gearResults: GearHit[] = [];

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

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
      style: { fontSize: 13, fill: 0x556677, fontFamily: "monospace" },
    });
    dayText.anchor.set(1, 0);
    dayText.x = PX + PW - 14;
    dayText.y = PY + 16;
    dayText.eventMode = "none";
    this.mainContainer.addChild(dayText);

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
        this.objectsInputFocused = tab.id === "objects";
        this.render();
      });
      this.mainContainer.addChild(tabBg);

      const tabLabel = new Text({
        text: tab.label,
        style: {
          fontSize: 12,
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
        style: { fontSize: 11, fill: 0x445566, fontFamily: "monospace" },
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
    inputBg.stroke({
      color: this.objectsInputFocused ? 0x88ccff : 0x334455,
      width: 1,
    });
    inputBg.eventMode = "static";
    inputBg.cursor = "text";
    inputBg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.objectsInputFocused = true;
      this.render();
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
        fill: this.objectsQuery.length > 0 ? 0xeeddaa : 0x445566,
        fontFamily: "monospace",
      },
    });
    inputLabel.x = PAD + 6;
    inputLabel.y = 11;
    inputLabel.eventMode = "none";
    container.addChild(inputLabel);

    // cursor blink indicator
    if (this.objectsInputFocused) {
      const cursor = new Text({
        text: "|",
        style: { fontSize: 13, fill: 0x88ccff, fontFamily: "monospace" },
      });
      cursor.x = PAD + 8 + inputLabel.width;
      cursor.y = 11;
      cursor.eventMode = "none";
      container.addChild(cursor);
    }

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
        style: { fontSize: 13, fill: 0x445566, fontFamily: "monospace" },
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
          fill: stale ? 0x556677 : 0xaabbcc,
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
    const CTRL_Y = 4;
    const GAP = 8;

    let cx = PAD;

    // Kind selector
    const kindLabel = new Text({
      text: "Вид:",
      style: { fontSize: 12, fill: 0x88aacc, fontFamily: "monospace" },
    });
    kindLabel.x = cx;
    kindLabel.y = CTRL_Y + 7;
    kindLabel.eventMode = "none";
    container.addChild(kindLabel);
    cx += 36;

    const kindBg = new Graphics();
    kindBg.rect(cx, CTRL_Y, 96, CTRL_H);
    kindBg.fill({ color: 0x0d1522 });
    kindBg.stroke({ color: 0x88ccff, width: 1 });
    kindBg.eventMode = "static";
    kindBg.cursor = "pointer";
    kindBg.on("pointerdown", (e) => {
      e.stopPropagation();
      const idx = ALL_GEAR_KINDS.indexOf(this.gearKind);
      this.gearKind = ALL_GEAR_KINDS[(idx + 1) % ALL_GEAR_KINDS.length];
      this.render();
    });
    container.addChild(kindBg);

    const kindVal = new Text({
      text: GEAR_KIND_RU[this.gearKind],
      style: { fontSize: 12, fill: 0xeeddaa, fontFamily: "monospace" },
    });
    kindVal.anchor.set(0.5, 0.5);
    kindVal.x = cx + 48;
    kindVal.y = CTRL_Y + CTRL_H / 2;
    kindVal.eventMode = "none";
    container.addChild(kindVal);
    cx += 96 + GAP;

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
      style: { fontSize: 12, fill: 0x556677, fontFamily: "monospace" },
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
    const ROW_H = 30;
    const VISIBLE = Math.floor((ph - LIST_Y) / ROW_H);

    if (this.gearResults.length === 0) {
      const empty = new Text({
        text: "Нажмите Найти для поиска снаряжения",
        style: { fontSize: 13, fill: 0x445566, fontFamily: "monospace" },
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

      const sysName = systemMap.get(hit.systemId)?.name ?? hit.systemId;
      const distStr = hit.jumps === 0 ? "здесь" : `${hit.jumps} пр.`;
      const staleStr = stale ? " (уст.)" : "";
      const gearName = hit.gear.name.slice(0, 20).padEnd(20);
      const lineText = `T${hit.gear.techLevel} ${gearName} ${sysName}${staleStr} — ${hit.price}₡  ${distStr}`;

      const lineLabel = new Text({
        text: lineText,
        style: {
          fontSize: 11,
          fill: stale ? 0x556677 : 0xaabbcc,
          fontFamily: "monospace",
        },
      });
      lineLabel.x = PAD + 4;
      lineLabel.y = y + ROW_H / 2 - 7;
      lineLabel.eventMode = "none";
      container.addChild(lineLabel);

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

    const sortMap: Record<
      GearSortOption,
      "price" | "jumps" | "damage" | "hp" | "tech"
    > = {
      price: "price",
      distance: "jumps",
      tech: "tech",
    };

    this.gearResults = registry.findGear({
      originSystemId: originId,
      kind: this.gearKind,
      minTech: this.gearMinTech,
      maxTech: this.gearMaxTech,
      maxPrice: maxPrice > 0 ? maxPrice : undefined,
      sort: sortMap[this.gearSort],
      limit: 20,
    });
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
    if (this.activeTab === "objects" && this.objectsInputFocused) {
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
    }
  }
}
