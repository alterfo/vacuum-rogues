import { Container, Graphics } from "pixi.js";
import { scaledText } from "./ui/scaledText";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import type { StarSystem } from "@/domain/StarSystem";
import {
  buildRumorPanel,
  maskTradeNewsMargin,
  feedEventVisible,
  rumorPanelHeader,
  RUMOR_PANEL_MAX,
} from "./rumorPanel";
import { isSystemKnown } from "@/systems/galaxy/systemKnown";
import { resourceLabelRu } from "@/domain/RouteRumor";
import { t } from "@/i18n/i18n";
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
import { ScrollableList } from "./ui/ScrollableList";
import { logger } from "@/utils/logger";

interface InfoContext {
  gameEngine?: GameEngine;
  planet?: Planet;
  station?: Station;
}

// ── Localisation ────────────────────────────────────────────────────────────

/** Localized bracket tag for a news event type (e.g. "[МАРШРУТ]" / "[ROUTE]"). */
function newsTypeLabel(type: NewsEvent["type"]): string {
  return t(`news.type.${type}`);
}

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
  TRADE_OPPORTUNITY: 0xffd166,
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
  const player = gameEngine.player ?? null;
  // Partial observability: the feed never names a system the player hasn't
  // scouted (explored/visited). A null player (headless) keeps everything.
  const known = (id: string): boolean =>
    player == null || isSystemKnown(player, galaxy, id);

  const items: NewsItem[] = [];

  const feedEvents = [...galaxy.newsFeed]
    .reverse()
    .filter((event) => feedEventVisible(event, galaxy, player))
    .slice(0, 20);
  for (const event of feedEvents) {
    const sysName = systemMap.get(event.systemId)?.name ?? event.systemId;
    const label = newsTypeLabel(event.type);
    const color = NEWS_TYPE_COLOR[event.type] ?? 0xaaaaaa;
    // Partial observability: re-mask a trade-rumor margin baked into the feed for
    // a route the player hasn't discovered (mirrors the rumor panel above).
    const desc = maskTradeNewsMargin(
      event.description || t("news.fallbackDesc", { label, system: sysName }),
      event,
      galaxy,
      gameEngine.player ?? null,
    );
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
      if (!known(p.systemId)) continue;
      const sysName = systemMap.get(p.systemId)?.name ?? p.systemId;
      const dist =
        p.jumps === 0
          ? t("news.distCurrentSystem")
          : t("news.distJumps", { n: p.jumps });
      const text = t("news.pirateAlert", { system: sysName, dist });
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
    for (const res of hotResources) {
      const hit = registry.findResource({
        resource: res,
        originSystemId: originId,
        sort: "price",
        limit: 1,
      })[0];
      if (!hit) continue;
      if (!known(hit.systemId)) continue;
      const sysName = systemMap.get(hit.systemId)?.name ?? hit.systemId;
      const dist =
        hit.jumps === 0
          ? t("news.distHere")
          : t("news.distJumps", { n: hit.jumps });

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
          if (pct < 0) deltaStr = t("news.deltaDown", { pct: Math.abs(pct) });
          else if (pct > 0) deltaStr = t("news.deltaUp", { pct });
        }
      }

      const text = t("news.marketBest", {
        resource: resourceLabelRu(res),
        system: sysName,
        price: hit.price,
        delta: deltaStr,
        dist,
      });
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
    const visibleTrader = traders.find((tr) => known(tr.systemId));
    if (visibleTrader) {
      const sysName =
        systemMap.get(visibleTrader.systemId)?.name ?? visibleTrader.systemId;
      const text = t("news.traders", { system: sysName });
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
    const visiblePatrol = patrols.find((pt) => known(pt.systemId));
    if (visiblePatrol) {
      const sysName =
        systemMap.get(visiblePatrol.systemId)?.name ?? visiblePatrol.systemId;
      const text = t("news.patrol", { system: sysName });
      items.push({
        day,
        text,
        color: 0x88bbff,
        bookmarkKey: newsKey(day, text),
      });
    }
  }

  const lore: [number, string][] = [
    [day - 1, t("news.lore1")],
    [day - 2, t("news.lore2")],
    [day - 3, t("news.lore3")],
    [day - 4, t("news.lore4")],
    [day - 5, t("news.lore5")],
    [day - 6, t("news.lore6")],
    [day - 7, t("news.lore7")],
  ];
  for (const [d, loreText] of lore) {
    const text = t("news.loreTag", { text: loreText });
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
  // Persisted scroll position of the news list, in PIXELS (survives the re-render
  // triggered by a bookmark toggle / tab switch). Restored onto a freshly-built
  // ScrollableList each render.
  private newsScroll = 0;
  // The reusable scrollable region wrapping ALL news rows (no slicing). Rebuilt
  // each render; owns a drag handler that destroy() must tear down.
  private newsList: ScrollableList<NewsItem> | null = null;

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
  /** Teardown for the contextual-help layer (first-time hint + «?» button). */
  private helpTeardown: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  /**
   * Wire contextual help (first-time auto-hint + always-available «?» reopen).
   * Mounted on `renderer.stage` so it sits above the panel and survives the
   * scene's `render()` UI rebuilds.
   */
  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "INFO_CENTER",
    );
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

    this.mountHelp();
  }

  update(_dt: number): void {}

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.detachWheel) {
      this.detachWheel();
      this.detachWheel = null;
    }
    if (this.newsList) {
      this.newsList.destroy();
      this.newsList = null;
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
    // Capture the live scroll position (wheel/drag may have moved it) and tear
    // the old list down before removeChildren orphans its container — destroy()
    // detaches the drag handlers that removeChildren alone would leak.
    if (this.newsList) {
      this.newsScroll = this.newsList.offset;
      this.newsList.destroy();
      this.newsList = null;
    }
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

    const title = scaledText("[ ИНФОЦЕНТР ]", 22, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
    });
    title.anchor.set(0.5, 0);
    title.x = PX + PW / 2;
    title.y = PY + 14;
    title.eventMode = "none";
    this.mainContainer.addChild(title);

    const day = this.gameEngine?.galaxy?.gameDays ?? 0;
    const dayText = scaledText(`День ${day}`, 13, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    dayText.anchor.set(1, 0);
    dayText.x = PX + PW - 14;
    dayText.y = PY + 16;
    dayText.eventMode = "none";
    this.mainContainer.addChild(dayText);

    const credits = this.gameEngine?.player?.credits ?? 0;
    const creditsText = scaledText(
      `Кредиты: ${credits.toLocaleString()} ₢`,
      13,
      0x88ddaa,
      { rawColor: true, fontFamily: "monospace" },
    );
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

      const tabLabel = scaledText(
        tab.label,
        12,
        isActive ? 0x88ccff : 0x7799bb,
        { rawColor: true, fontFamily: "monospace" },
      );
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

    const back = scaledText("[ Закрыть  Esc ]", 14, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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

    const msg = scaledText(
      "Инфоцентр недоступен\n\n(Враждебное отношение)",
      20,
      0x884444,
      { rawColor: true, fontFamily: "monospace", align: "center" },
    );
    msg.anchor.set(0.5, 0.5);
    msg.x = sw / 2;
    msg.y = sh / 2 - 20;
    msg.eventMode = "none";
    this.mainContainer!.addChild(msg);

    const back = scaledText("[ Закрыть  Esc ]", 14, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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

  /** Fixed per-row height of the news list, in px. */
  private static readonly NEWS_ROW_H = 38;

  private renderNews(container: Container, pw: number, ph: number): void {
    const PAD = 16;
    const ROW_H = InfoCenterScene.NEWS_ROW_H;
    const STAR_W = 28;

    // Trade-route rumors band sits above the scrollable news list (unmasked).
    const rumorH = this.renderRumorPanel(container, pw);

    // The news list scrolls inside the shared `ScrollableList` (one design across
    // every list panel — see plan 20260618), offset below the rumor band so the
    // clip never covers the rumors. ALL items render (no slicing); the component
    // owns the mask, hit-area tracking, clamping and drag.
    const listH = Math.max(ROW_H, ph - rumorH);
    const VISIBLE = Math.floor(listH / ROW_H);
    const bookmarks = this.gameEngine?.player?.newsBookmarks ?? [];

    this.newsList = new ScrollableList<NewsItem>({
      x: 0,
      y: rumorH,
      width: pw,
      height: listH,
      itemHeight: ROW_H,
      items: this.newsItems,
      // The scene owns one wheel handler (also bound to ArrowUp/Down) that drives
      // this list via scrollNews — don't also bind the window wheel here or each
      // notch would scroll twice.
      enableWheel: false,
      renderItem: (item, i) =>
        this.buildNewsRow(item, i, pw, PAD, ROW_H, STAR_W, bookmarks),
    });
    // Restore the persisted pixel offset; scrollTo clamps, so reflect the clamp
    // back into newsScroll/the footer hint.
    this.newsList.scrollTo(this.newsScroll);
    this.newsScroll = this.newsList.offset;
    container.addChild(this.newsList.container);

    if (this.newsItems.length > VISIBLE) {
      // Footer lives on the (unmasked) content container so it stays fixed while
      // the rows scroll under the clip.
      const firstRow = Math.round(this.newsScroll / ROW_H);
      const hint = scaledText(
        `↑↓  ${firstRow + 1}–${Math.min(firstRow + VISIBLE, this.newsItems.length)} / ${this.newsItems.length}`,
        11,
        0x334455,
        { rawColor: true, fontFamily: "monospace" },
      );
      hint.anchor.set(1, 1);
      hint.x = pw - PAD;
      hint.y = rumorH + listH - 2;
      hint.eventMode = "none";
      container.addChild(hint);
    }
  }

  /** Builds one news row at a local origin (the list positions it by index). */
  private buildNewsRow(
    item: NewsItem,
    i: number,
    pw: number,
    PAD: number,
    ROW_H: number,
    STAR_W: number,
    bookmarks: readonly number[],
  ): Container {
    const row = new Container();

    const rowBg = new Graphics();
    rowBg.rect(PAD, 2, pw - PAD * 2, ROW_H - 4);
    rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
    // 'none' so a click on the row body falls through to the list's drag hit-area
    // (a child with default eventMode would swallow the drag pointerdown).
    rowBg.eventMode = "none";
    row.addChild(rowBg);

    const dayBadge = scaledText(`Д${item.day}`, 11, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    dayBadge.x = PAD + 6;
    dayBadge.y = ROW_H / 2 - 7;
    dayBadge.eventMode = "none";
    row.addChild(dayBadge);

    const news = scaledText(item.text, 13, item.color, {
      rawColor: true,
      fontFamily: "monospace",
      wordWrap: true,
      wordWrapWidth: pw - PAD * 2 - 50 - STAR_W,
    });
    news.x = PAD + 46;
    news.y = ROW_H / 2 - 7;
    news.eventMode = "none";
    row.addChild(news);

    const isBookmarked = bookmarks.includes(item.bookmarkKey);
    const star = scaledText(
      isBookmarked ? "★" : "☆",
      16,
      isBookmarked ? 0xffdd44 : 0x334455,
      { rawColor: true, fontFamily: "monospace" },
    );
    star.x = pw - PAD - STAR_W + 4;
    star.y = ROW_H / 2 - 9;
    star.eventMode = "static";
    star.cursor = "pointer";
    star.on("pointerdown", (e) => {
      e.stopPropagation();
      this.toggleBookmark(item.bookmarkKey);
    });
    row.addChild(star);

    return row;
  }

  /**
   * Draws the "Торговые возможности" band at the top of the news tab — the
   * active trade-route rumors (most-profitable first) or an empty-state line.
   * Returns the vertical space it consumed so the news list can sit below it.
   */
  private renderRumorPanel(container: Container, pw: number): number {
    const PAD = 16;
    const HEADER_H = 24;
    const ROW_H = 22;
    // Partial observability: HIDE routes touching systems the player hasn't
    // explored/visited entirely (not just margin-masked) — the feed never names
    // an unscouted system (`buildRumorPanel(..., hideUnknown=true)`).
    const data = buildRumorPanel(
      this.gameEngine?.galaxy ?? null,
      RUMOR_PANEL_MAX,
      this.gameEngine?.player ?? null,
      true,
    );

    const header = scaledText(`▸ ${rumorPanelHeader()}`, 13, 0xffd166, {
      rawColor: true,
      fontFamily: "monospace",
      fontWeight: "bold",
    });
    header.x = PAD;
    header.y = 4;
    header.eventMode = "none";
    container.addChild(header);

    let y = HEADER_H;

    if (data.emptyText) {
      const empty = scaledText(data.emptyText, 13, 0xb4b4b4, {
        rawColor: true,
        fontFamily: "monospace",
      });
      empty.x = PAD + 10;
      empty.y = y;
      empty.eventMode = "none";
      container.addChild(empty);
      y += ROW_H;
    } else {
      for (const line of data.lines) {
        const row = scaledText(`• ${line.text}`, 13, 0xffd166, {
          rawColor: true,
          fontFamily: "monospace",
          wordWrap: true,
          wordWrapWidth: pw - PAD * 2 - 12,
        });
        row.x = PAD + 10;
        row.y = y;
        row.eventMode = "none";
        container.addChild(row);
        y += ROW_H;
      }
    }

    y += 4;
    const sep = new Graphics();
    sep.rect(PAD, y, pw - PAD * 2, 1);
    sep.fill({ color: 0x334455 });
    container.addChild(sep);
    y += 8;

    return y;
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
    const inputLabel = scaledText(
      queryText,
      13,
      this.objectsQuery.length > 0 ? 0xeeddaa : 0x88aacc,
      { rawColor: true, fontFamily: "monospace" },
    );
    inputLabel.x = PAD + 6;
    inputLabel.y = 11;
    inputLabel.eventMode = "none";
    container.addChild(inputLabel);

    // cursor indicator — always shown; the input is focused whenever this tab
    // is open.
    const cursor = scaledText("|", 13, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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

    const searchBtnLabel = scaledText("[ Найти ]", 13, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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
      const empty = scaledText(
        this.objectsQuery.length === 0
          ? "Введите запрос и нажмите Найти или Enter"
          : "Ничего не найдено",
        13,
        0x88aacc,
        { rawColor: true, fontFamily: "monospace" },
      );
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

      const lineLabel = scaledText(lineText, 12, stale ? 0x7799aa : 0xaabbcc, {
        rawColor: true,
        fontFamily: "monospace",
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

      const mapBtnLabel = scaledText("→ карта", 11, 0x6699bb, {
        rawColor: true,
        fontFamily: "monospace",
      });
      mapBtnLabel.anchor.set(0.5, 0.5);
      mapBtnLabel.x = mapBtnX + 35;
      mapBtnLabel.y = y + ROW_H / 2;
      mapBtnLabel.eventMode = "none";
      container.addChild(mapBtnLabel);
    }

    if (this.objectsResults.length > VISIBLE) {
      const hint = scaledText(
        `показаны первые ${VISIBLE} из ${this.objectsResults.length}`,
        11,
        0x334455,
        { rawColor: true, fontFamily: "monospace" },
      );
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
      const pillLabel = scaledText(
        FACET_LABELS[facet],
        11,
        isActive ? 0x88ccff : 0x7799bb,
        { rawColor: true, fontFamily: "monospace" },
      );
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

      const equippedHdr = scaledText("▶ Установлено:", 10, 0x55aa55, {
        rawColor: true,
        fontFamily: "monospace",
      });
      equippedHdr.x = PAD + 6;
      equippedHdr.y = EQUIPPED_Y + 4;
      equippedHdr.eventMode = "none";
      container.addChild(equippedHdr);

      const equippedName = scaledText(
        `T${equippedItem.techLevel}  ${equippedItem.name}`,
        11,
        0x88dd88,
        { rawColor: true, fontFamily: "monospace" },
      );
      equippedName.x = PAD + 6;
      equippedName.y = EQUIPPED_Y + 16;
      equippedName.eventMode = "none";
      container.addChild(equippedName);

      const equippedStats = scaledText(
        gearStatLine(equippedItem),
        10,
        0x66bb66,
        { rawColor: true, fontFamily: "monospace" },
      );
      equippedStats.x = PAD + 220;
      equippedStats.y = EQUIPPED_Y + 16;
      equippedStats.eventMode = "none";
      container.addChild(equippedStats);
    }

    // Second controls row: tech level, max price, sort, find
    const CTRL_Y = PILL_Y + PILL_H + equippedRowH + 8;
    let cx = PAD;

    // Tech level range
    const techLabel = scaledText("Т.ур:", 12, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
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

    const techMinVal = scaledText(String(this.gearMinTech), 12, 0xaabbcc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    techMinVal.anchor.set(0.5, 0.5);
    techMinVal.x = cx + 17;
    techMinVal.y = CTRL_Y + CTRL_H / 2;
    techMinVal.eventMode = "none";
    container.addChild(techMinVal);
    cx += 34;

    const techSep = scaledText("–", 12, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
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

    const techMaxVal = scaledText(String(this.gearMaxTech), 12, 0xaabbcc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    techMaxVal.anchor.set(0.5, 0.5);
    techMaxVal.x = cx + 17;
    techMaxVal.y = CTRL_Y + CTRL_H / 2;
    techMaxVal.eventMode = "none";
    container.addChild(techMaxVal);
    cx += 34 + GAP;

    // Max price
    const priceLabel = scaledText("Цена≤:", 12, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
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

    const priceVal = scaledText(
      maxPrice === 0 ? "любая" : `${maxPrice}₡`,
      11,
      0xaabbcc,
      { rawColor: true, fontFamily: "monospace" },
    );
    priceVal.anchor.set(0.5, 0.5);
    priceVal.x = cx + 36;
    priceVal.y = CTRL_Y + CTRL_H / 2;
    priceVal.eventMode = "none";
    container.addChild(priceVal);
    cx += 72 + GAP;

    // Sort
    const sortLabel = scaledText("Сорт:", 12, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
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

    const sortVal = scaledText(GEAR_SORT_LABELS[this.gearSort], 12, 0xaabbcc, {
      rawColor: true,
      fontFamily: "monospace",
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

    const findBtnLabel = scaledText("[ Найти ]", 12, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
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
      const empty = scaledText(
        "Нажмите Найти для поиска снаряжения",
        13,
        0x88aacc,
        { rawColor: true, fontFamily: "monospace" },
      );
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

      const lineLabel = scaledText(lineText, 11, stale ? 0x7799aa : 0xaabbcc, {
        rawColor: true,
        fontFamily: "monospace",
      });
      lineLabel.x = PAD + 4;
      lineLabel.y = y + 5;
      lineLabel.eventMode = "none";
      container.addChild(lineLabel);

      const statsLabel = scaledText(gearStatLine(hit.gear), 10, 0x557799, {
        rawColor: true,
        fontFamily: "monospace",
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

      const mapBtnLabel = scaledText("→ карта", 10, 0x6699bb, {
        rawColor: true,
        fontFamily: "monospace",
      });
      mapBtnLabel.anchor.set(0.5, 0.5);
      mapBtnLabel.x = mapBtnX + 32;
      mapBtnLabel.y = y + ROW_H / 2;
      mapBtnLabel.eventMode = "none";
      container.addChild(mapBtnLabel);
    }

    if (this.gearResults.length > VISIBLE) {
      const hint = scaledText(
        `показаны первые ${VISIBLE} из ${this.gearResults.length}`,
        11,
        0x334455,
        { rawColor: true, fontFamily: "monospace" },
      );
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

  /** Scroll the news list by `deltaRows` rows (wheel notch / arrow press). */
  private scrollNews(deltaRows: number): void {
    if (!this.newsList) {
      this.render();
      return;
    }
    // Nudge the live list (it clamps), then sync newsScroll BEFORE the re-render —
    // render() re-reads the offset off the list, so the order matters. The
    // re-render refreshes the footer "X–Y / N" hint.
    this.newsList.scrollBy(deltaRows * InfoCenterScene.NEWS_ROW_H);
    this.newsScroll = this.newsList.offset;
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
