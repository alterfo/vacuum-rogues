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
import { SceneType, NpcRole, ResourceType, QuestType } from "@/types";
import type { NewsEvent } from "@/types";
import type { QuestTemplate } from "@/core/ports/IQuestService";
import type {
  PlanetHit,
  ShipLocation,
  SystemHit,
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
import { visibleNewsRange } from "./ui/newsListRange";
import {
  MONO_CHAR_WIDTH_RATIO,
  estimateWrappedLines,
  lineStepFor,
} from "./ui/questCardLayout";
import { scaledFont } from "@/utils/fontScale";
import { logger } from "@/utils/logger";

function countVisibleRows(
  heights: readonly number[],
  listHeight: number,
): number {
  let filled = 0;
  let count = 0;
  for (const height of heights) {
    if (filled + height > listHeight) break;
    filled += height;
    count += 1;
  }
  return Math.max(1, count);
}

interface InfoContext {
  gameEngine?: GameEngine;
  planet?: Planet;
  station?: Station;
}

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
  CAMPAIGN_ESCALATION: 0xff5588,
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

type Tab = "news" | "objects" | "gear";
type GearSortOption = "price" | "tech" | "distance" | "stat";

const GEAR_SORT_OPTIONS: GearSortOption[] = [
  "price",
  "tech",
  "distance",
  "stat",
];
const GEAR_MAX_PRICE_OPTIONS = [0, 1000, 5000, 10000, 50000];
export const GEAR_TECH_MAX = 8;

const GEAR_HP_OPTIONS = [0, 50, 100, 200, 400, 800];
const GEAR_SLOTS_OPTIONS = [0, 1, 2, 3, 4, 5];
const GEAR_CARGO_OPTIONS = [0, 10, 25, 50, 100, 200];
const GEAR_DAMAGE_OPTIONS = [0, 5, 10, 20, 40, 80];
const GEAR_RANGE_OPTIONS = [0, 50, 100, 200, 400];

export function cycleGearTech(value: number): number {
  return (value % GEAR_TECH_MAX) + 1;
}

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
  | { kind: "planet"; hit: PlanetHit; stale: boolean }
  | { kind: "system"; hit: SystemHit; stale: boolean };

export class InfoCenterScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private station: Station | null = null;

  private mainContainer: Container | null = null;
  private blocked = false;

  private activeTab: Tab = "news";
  private newsItems: NewsItem[] = [];
  private newsScroll = 0;
  private newsOffsets: number[] = [];
  private newsList: ScrollableList<NewsItem> | null = null;

  private objectsQuery = "";
  private objectsResults: ObjectResult[] = [];

  private gearFacets = new Set<EquipmentFacet>(["engine" as EquipmentFacet]);
  private gearMinTech = 1;
  private gearMaxTech = GEAR_TECH_MAX;
  private gearMaxPriceIdx = 0; // index into GEAR_MAX_PRICE_OPTIONS
  private gearSort: GearSortOption = "price";
  private gearMinHpIdx = 0; // index into GEAR_HP_OPTIONS
  private gearMinSlotsIdx = 0; // index into GEAR_SLOTS_OPTIONS
  private gearMinCargoIdx = 0; // index into GEAR_CARGO_OPTIONS
  private gearMinDamageIdx = 0; // index into GEAR_DAMAGE_OPTIONS
  private gearMinRangeIdx = 0; // index into GEAR_RANGE_OPTIONS
  private gearResults: EquipmentHit[] = [];
  private gearScroll = 0;
  private gearList: ScrollableList<EquipmentHit> | null = null;

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private detachWheel: (() => void) | null = null;
  private helpTeardown: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "INFO_CENTER",
    );
  }

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
    this.detachWheel = attachWheelScroll((dir) => {
      if (this.activeTab === "news") this.scrollNews(dir);
      else if (this.activeTab === "gear") this.scrollGear(dir);
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
    if (this.gearList) {
      this.gearList.destroy();
      this.gearList = null;
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

  private render(): void {
    if (!this.mainContainer) return;
    if (this.newsList) {
      this.newsScroll = this.newsList.offset;
      this.newsList.destroy();
      this.newsList = null;
    }
    if (this.gearList) {
      this.gearScroll = this.gearList.offset;
      this.gearList.destroy();
      this.gearList = null;
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

    if (this.activeTab !== "objects" && PW > 620) {
      const searchHint = scaledText(
        t("infoCenter.objectsHintOtherTab"),
        11,
        0x557799,
        { rawColor: true, fontFamily: "monospace" },
      );
      searchHint.anchor.set(1, 0.5);
      searchHint.x = PX + PW - 16;
      searchHint.y = TAB_Y + TAB_H / 2;
      searchHint.eventMode = "none";
      this.mainContainer.addChild(searchHint);
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

  private static readonly NEWS_ROW_H = 38;

  private renderNews(container: Container, pw: number, ph: number): void {
    const PAD = 16;
    const ROW_H = InfoCenterScene.NEWS_ROW_H;
    const STAR_W = 28;

    const rumorH = this.renderRumorPanel(container, pw);

    const listH = Math.max(ROW_H, ph - rumorH);
    const rowHeights = this.newsItems.map((item) =>
      this.newsRowHeight(item, pw),
    );
    this.newsOffsets = [];
    let runningOffset = 0;
    for (const height of rowHeights) {
      this.newsOffsets.push(runningOffset);
      runningOffset += height;
    }
    const visibleRows = countVisibleRows(rowHeights, listH);
    const bookmarks = this.gameEngine?.player?.newsBookmarks ?? [];

    this.newsList = new ScrollableList<NewsItem>({
      x: 0,
      y: rumorH,
      width: pw,
      height: listH,
      itemHeight: ROW_H,
      items: this.newsItems,
      enableWheel: false,
      getItemHeight: (item) => this.newsRowHeight(item, pw),
      renderItem: (item, i) =>
        this.buildNewsRow(
          item,
          i,
          pw,
          PAD,
          this.newsRowHeight(item, pw),
          STAR_W,
          bookmarks,
        ),
    });
    this.newsList.scrollTo(this.newsScroll);
    this.newsScroll = this.newsList.offset;
    container.addChild(this.newsList.container);

    if (this.newsItems.length > visibleRows) {
      const range = visibleNewsRange(
        this.newsOffsets,
        rowHeights,
        listH,
        this.newsScroll,
      );
      const hint = scaledText(
        `↑↓  ${range.first + 1}–${Math.min(range.last, this.newsItems.length)} / ${this.newsItems.length}`,
        11,
        0x88aacc,
        { rawColor: true, fontFamily: "monospace" },
      );
      hint.anchor.set(1, 1);
      hint.x = pw - PAD;
      hint.y = rumorH + listH - 2;
      hint.eventMode = "none";
      container.addChild(hint);
    }
  }

  private newsRowHeight(item: NewsItem, pw: number): number {
    const PAD = 16;
    const STAR_W = 28;
    const textWidth = Math.max(1, pw - PAD * 2 - 50 - STAR_W);
    const lines = estimateWrappedLines(item.text, textWidth, scaledFont(13));
    const textHeight = lines * lineStepFor(scaledFont(13)) + 12;
    return Math.max(InfoCenterScene.NEWS_ROW_H, textHeight);
  }

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
    rowBg.eventMode = "none";
    row.addChild(rowBg);

    const dayBadge = scaledText(`Д${item.day}`, 11, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    dayBadge.x = PAD + 6;
    dayBadge.y = 8;
    dayBadge.eventMode = "none";
    row.addChild(dayBadge);

    const news = scaledText(item.text, 13, item.color, {
      rawColor: true,
      fontFamily: "monospace",
      wordWrap: true,
      wordWrapWidth: pw - PAD * 2 - 50 - STAR_W,
    });
    news.x = PAD + 46;
    news.y = 6;
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
    star.y = 6;
    star.eventMode = "static";
    star.cursor = "pointer";
    star.on("pointerdown", (e) => {
      e.stopPropagation();
      this.toggleBookmark(item.bookmarkKey);
    });
    row.addChild(star);

    return row;
  }

  private renderRumorPanel(container: Container, pw: number): number {
    const PAD = 16;
    const HEADER_H = 24;
    const ROW_H = 22;
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

  private renderObjects(container: Container, pw: number, ph: number): void {
    const PAD = 16;

    const inputBg = new Graphics();
    inputBg.rect(PAD, 4, pw - PAD * 2 - 110, 30);
    inputBg.fill({ color: 0x0d1522 });
    inputBg.stroke({ color: 0x88ccff, width: 1 });
    inputBg.eventMode = "static";
    inputBg.cursor = "text";
    inputBg.on("pointerdown", (e) => {
      e.stopPropagation();
    });
    container.addChild(inputBg);

    const queryText =
      this.objectsQuery.length > 0
        ? this.objectsQuery
        : t("infoCenter.objectsPlaceholder");
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

    const cursor = scaledText("|", 13, 0x88ccff, {
      rawColor: true,
      fontFamily: "monospace",
    });
    cursor.x = PAD + 8 + inputLabel.width;
    cursor.y = 11;
    cursor.eventMode = "none";
    container.addChild(cursor);

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

      let name: string;
      let sysName: string;
      let jumps: number;
      let typeLabel: string;
      let systemId: string;
      if (result.kind === "ship") {
        name = result.loc.name;
        sysName =
          systemMap.get(result.loc.systemId)?.name ?? result.loc.systemId;
        jumps = result.loc.jumps;
        typeLabel = "[NPC]";
        systemId = result.loc.systemId;
      } else if (result.kind === "planet") {
        name = result.hit.planetName;
        sysName = result.hit.systemName;
        jumps = result.hit.jumps;
        typeLabel = "[ПЛН]";
        systemId = result.hit.systemId;
      } else {
        name = result.hit.systemName;
        sysName = "";
        jumps = result.hit.jumps;
        typeLabel = "[СИС]";
        systemId = result.hit.systemId;
      }
      const stale = isStaleSystem(systemId, systemMap, currentDay);

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
        0x88aacc,
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

    const systems = registry.findSystem({
      name: this.objectsQuery.trim(),
      originSystemId: originId,
    });
    for (const hit of systems.slice(0, 10)) {
      const stale = isStaleSystem(hit.systemId, systemMap, currentDay);
      this.objectsResults.push({ kind: "system", hit, stale });
    }

    this.objectsResults.sort((a, b) => {
      const ja = a.kind === "ship" ? a.loc.jumps : a.hit.jumps;
      const jb = b.kind === "ship" ? b.loc.jumps : b.hit.jumps;
      return ja - jb;
    });
  }

  private renderGear(container: Container, pw: number, ph: number): void {
    const PAD = 16;
    const CTRL_H = 28;
    const GAP = 6;

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

    const CTRL_Y = PILL_Y + PILL_H + equippedRowH + 8;
    let cx = PAD;

    const techLabel = scaledText("Т.ур:", 12, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    techLabel.x = cx;
    techLabel.y = CTRL_Y + 7;
    techLabel.eventMode = "none";
    container.addChild(techLabel);
    cx += 38;

    const techMinBg = new Graphics();
    techMinBg.rect(cx, CTRL_Y, 34, CTRL_H);
    techMinBg.fill({ color: 0x0d1522 });
    techMinBg.stroke({ color: 0x556677, width: 1 });
    techMinBg.eventMode = "static";
    techMinBg.cursor = "pointer";
    techMinBg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.gearMinTech = cycleGearTech(this.gearMinTech);
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

    const techMaxBg = new Graphics();
    techMaxBg.rect(cx, CTRL_Y, 34, CTRL_H);
    techMaxBg.fill({ color: 0x0d1522 });
    techMaxBg.stroke({ color: 0x556677, width: 1 });
    techMaxBg.eventMode = "static";
    techMaxBg.cursor = "pointer";
    techMaxBg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.gearMaxTech = cycleGearTech(this.gearMaxTech);
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

    const sortValLabel =
      this.gearSort === "stat"
        ? t("infoCenter.gearSortStat")
        : GEAR_SORT_LABELS[this.gearSort];
    const sortVal = scaledText(sortValLabel, 12, 0xaabbcc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    sortVal.anchor.set(0.5, 0.5);
    sortVal.x = cx + 42;
    sortVal.y = CTRL_Y + CTRL_H / 2;
    sortVal.eventMode = "none";
    container.addChild(sortVal);
    cx += 84 + GAP;

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

    const showStatRow = singleFacet === "hull" || singleFacet === "weapon";
    const STAT_Y = CTRL_Y + CTRL_H + 6;
    const anyThreshold = t("infoCenter.gearAnyThreshold");
    if (showStatRow) {
      let sx = PAD;
      if (singleFacet === "hull") {
        sx = this.mountStatCycle(
          container,
          sx,
          STAT_Y,
          CTRL_H,
          t("infoCenter.gearMinHp"),
          GEAR_HP_OPTIONS[this.gearMinHpIdx] === 0
            ? anyThreshold
            : String(GEAR_HP_OPTIONS[this.gearMinHpIdx]),
          () => {
            this.gearMinHpIdx =
              (this.gearMinHpIdx + 1) % GEAR_HP_OPTIONS.length;
          },
        );
        sx = this.mountStatCycle(
          container,
          sx + GAP,
          STAT_Y,
          CTRL_H,
          t("infoCenter.gearMinSlots"),
          GEAR_SLOTS_OPTIONS[this.gearMinSlotsIdx] === 0
            ? anyThreshold
            : String(GEAR_SLOTS_OPTIONS[this.gearMinSlotsIdx]),
          () => {
            this.gearMinSlotsIdx =
              (this.gearMinSlotsIdx + 1) % GEAR_SLOTS_OPTIONS.length;
          },
        );
        this.mountStatCycle(
          container,
          sx + GAP,
          STAT_Y,
          CTRL_H,
          t("infoCenter.gearMinCargo"),
          GEAR_CARGO_OPTIONS[this.gearMinCargoIdx] === 0
            ? anyThreshold
            : String(GEAR_CARGO_OPTIONS[this.gearMinCargoIdx]),
          () => {
            this.gearMinCargoIdx =
              (this.gearMinCargoIdx + 1) % GEAR_CARGO_OPTIONS.length;
          },
        );
      } else {
        sx = this.mountStatCycle(
          container,
          sx,
          STAT_Y,
          CTRL_H,
          t("infoCenter.gearMinDamage"),
          GEAR_DAMAGE_OPTIONS[this.gearMinDamageIdx] === 0
            ? anyThreshold
            : String(GEAR_DAMAGE_OPTIONS[this.gearMinDamageIdx]),
          () => {
            this.gearMinDamageIdx =
              (this.gearMinDamageIdx + 1) % GEAR_DAMAGE_OPTIONS.length;
          },
        );
        this.mountStatCycle(
          container,
          sx + GAP,
          STAT_Y,
          CTRL_H,
          t("infoCenter.gearMinRange"),
          GEAR_RANGE_OPTIONS[this.gearMinRangeIdx] === 0
            ? anyThreshold
            : String(GEAR_RANGE_OPTIONS[this.gearMinRangeIdx]),
          () => {
            this.gearMinRangeIdx =
              (this.gearMinRangeIdx + 1) % GEAR_RANGE_OPTIONS.length;
          },
        );
      }
    }

    const LIST_Y = showStatRow ? STAT_Y + CTRL_H + 8 : CTRL_Y + CTRL_H + 8;
    const ROW_H = Math.max(
      38,
      5 + lineStepFor(scaledFont(11)) + lineStepFor(scaledFont(10)) + 3,
    );

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

    const listH = Math.max(ROW_H, ph - LIST_Y);
    const VISIBLE = Math.floor(listH / ROW_H);
    this.gearList = new ScrollableList<EquipmentHit>({
      x: 0,
      y: LIST_Y,
      width: pw,
      height: listH,
      itemHeight: ROW_H,
      items: this.gearResults,
      enableWheel: false, // the scene's own wheel handler drives scrollGear
      renderItem: (hit, i) =>
        this.buildGearRow(hit, i, pw, PAD, ROW_H, systemMap, currentDay),
    });
    this.gearList.scrollTo(this.gearScroll);
    this.gearScroll = this.gearList.offset;
    container.addChild(this.gearList.container);

    if (this.gearResults.length > VISIBLE) {
      const firstRow = Math.round(this.gearScroll / ROW_H);
      const hint = scaledText(
        `↑↓  ${firstRow + 1}–${Math.min(firstRow + VISIBLE, this.gearResults.length)} / ${this.gearResults.length}`,
        11,
        0x88aacc,
        { rawColor: true, fontFamily: "monospace" },
      );
      hint.anchor.set(1, 1);
      hint.x = pw - PAD;
      hint.y = ph - 2;
      hint.eventMode = "none";
      container.addChild(hint);
    }
  }

  private buildGearRow(
    hit: EquipmentHit,
    i: number,
    pw: number,
    PAD: number,
    ROW_H: number,
    systemMap: Map<string, StarSystem>,
    currentDay: number,
  ): Container {
    const row = new Container();
    const stale = isStaleSystem(hit.systemId, systemMap, currentDay);

    const rowBg = new Graphics();
    rowBg.rect(PAD, 1, pw - PAD * 2, ROW_H - 2);
    rowBg.fill({ color: i % 2 === 0 ? 0x0d1220 : 0x0a0e18 });
    row.addChild(rowBg);

    const distStr = hit.jumps === 0 ? "здесь" : `${hit.jumps} пр.`;
    const staleStr = stale ? " (уст.)" : "";
    const baseCharPx = 11 * MONO_CHAR_WIDTH_RATIO;
    const charPx = Math.max(1, scaledFont(11) * MONO_CHAR_WIDTH_RATIO);
    const gearNameChars = Math.max(6, Math.floor((18 * baseCharPx) / charPx));
    const planetSysChars = Math.max(6, Math.floor((22 * baseCharPx) / charPx));
    const gearName = hit.gear.name
      .slice(0, gearNameChars)
      .padEnd(gearNameChars);
    const planetSys = `${hit.planet} / ${hit.system}`
      .slice(0, planetSysChars)
      .padEnd(planetSysChars);
    const lineText = `T${hit.gear.techLevel} ${gearName} ${planetSys}${staleStr} — ${hit.price}₡  ${distStr}`;

    const lineLabel = scaledText(lineText, 11, stale ? 0x7799aa : 0xaabbcc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    lineLabel.x = PAD + 4;
    const lineTop = 5;
    lineLabel.y = lineTop;
    lineLabel.eventMode = "none";
    row.addChild(lineLabel);

    const statsLabel = scaledText(gearStatLine(hit.gear), 10, 0x557799, {
      rawColor: true,
      fontFamily: "monospace",
    });
    statsLabel.x = PAD + 4;
    statsLabel.y = lineTop + lineStepFor(scaledFont(11));
    statsLabel.eventMode = "none";
    row.addChild(statsLabel);

    const mapBtnX = pw - PAD - 70;
    const mapBtn = new Graphics();
    mapBtn.rect(mapBtnX, 3, 64, ROW_H - 6);
    mapBtn.fill({ color: 0x0d1a22 });
    mapBtn.stroke({ color: 0x334466, width: 1 });
    mapBtn.eventMode = "static";
    mapBtn.cursor = "pointer";
    mapBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.routeToShop(hit);
    });
    row.addChild(mapBtn);

    const mapBtnLabel = scaledText(
      t("infoCenter.gearFlyButton"),
      10,
      0x6699bb,
      {
        rawColor: true,
        fontFamily: "monospace",
      },
    );
    mapBtnLabel.anchor.set(0.5, 0.5);
    mapBtnLabel.x = mapBtnX + 32;
    mapBtnLabel.y = ROW_H / 2;
    mapBtnLabel.eventMode = "none";
    row.addChild(mapBtnLabel);

    return row;
  }

  private mountStatCycle(
    container: Container,
    x: number,
    y: number,
    h: number,
    label: string,
    valueLabel: string,
    onCycle: () => void,
  ): number {
    const lbl = scaledText(label, 12, 0x88aacc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    lbl.x = x;
    lbl.y = y + 7;
    lbl.eventMode = "none";
    container.addChild(lbl);
    const labelW = label.length * 7 + 4;
    const boxX = x + labelW;
    const boxW = 46;
    const bg = new Graphics();
    bg.rect(boxX, y, boxW, h);
    bg.fill({ color: 0x0d1522 });
    bg.stroke({ color: 0x556677, width: 1 });
    bg.eventMode = "static";
    bg.cursor = "pointer";
    bg.on("pointerdown", (e) => {
      e.stopPropagation();
      onCycle();
      this.render();
    });
    container.addChild(bg);
    const val = scaledText(valueLabel, 11, 0xaabbcc, {
      rawColor: true,
      fontFamily: "monospace",
    });
    val.anchor.set(0.5, 0.5);
    val.x = boxX + boxW / 2;
    val.y = y + h / 2;
    val.eventMode = "none";
    container.addChild(val);
    return boxX + boxW;
  }

  private runGearSearch(): void {
    this.gearResults = [];
    const registry = this.gameEngine?.getInfoRegistry();
    const galaxy = this.gameEngine?.galaxy;
    if (!registry || !galaxy) return;

    const originId =
      this.gameEngine?.player?.currentSystemId ?? galaxy.systems[0]?.id ?? "";
    const maxPrice = GEAR_MAX_PRICE_OPTIONS[this.gearMaxPriceIdx];
    const singleFacet =
      this.gearFacets.size === 1
        ? (this.gearFacets.values().next().value as EquipmentFacet)
        : null;

    const statFilters =
      singleFacet === "hull"
        ? {
            minHp: GEAR_HP_OPTIONS[this.gearMinHpIdx] || undefined,
            minSlots: GEAR_SLOTS_OPTIONS[this.gearMinSlotsIdx] || undefined,
            minCargo: GEAR_CARGO_OPTIONS[this.gearMinCargoIdx] || undefined,
          }
        : singleFacet === "weapon"
          ? {
              minDamage:
                GEAR_DAMAGE_OPTIONS[this.gearMinDamageIdx] || undefined,
              minRange: GEAR_RANGE_OPTIONS[this.gearMinRangeIdx] || undefined,
            }
          : {};

    let hits = registry.findEquipment({
      originSystemId: originId,
      types: this.gearFacets.size > 0 ? [...this.gearFacets] : undefined,
      maxPrice: maxPrice > 0 ? maxPrice : undefined,
      sort:
        this.gearSort === "stat"
          ? singleFacet === "weapon"
            ? "damage"
            : singleFacet === "hull"
              ? "hp"
              : undefined
          : undefined,
      ...statFilters,
    });

    hits = hits.filter(
      (h) =>
        h.gear.techLevel >= this.gearMinTech &&
        h.gear.techLevel <= this.gearMaxTech,
    );

    if (this.gearSort === "tech") {
      hits.sort(
        (a, b) => b.gear.techLevel - a.gear.techLevel || a.price - b.price,
      );
    } else if (this.gearSort === "distance") {
      hits.sort((a, b) => a.jumps - b.jumps || a.price - b.price);
    }

    this.gearResults = hits;
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

  private async openStarMapForSystem(systemId: string): Promise<void> {
    if (!this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.STAR_MAP, {
      gameEngine: this.gameEngine,
      pendingSelectedSystemId: systemId,
    });
  }

  private async routeToShop(hit: EquipmentHit): Promise<void> {
    if (!this.gameEngine) return;
    const currentDay = this.gameEngine.galaxy?.gameDays ?? 0;
    const template: QuestTemplate = {
      id: `purchase-${hit.planetId}-${hit.gear.id}`,
      title: t("infoCenter.purchaseQuestTitle", { gear: hit.gear.name }),
      description: t("infoCenter.purchaseQuestDesc", {
        gear: hit.gear.name,
        planet: hit.planet,
        system: hit.system,
      }),
      type: QuestType.EXPLORATION,
      objectives: [
        {
          id: "visit-system",
          description: t("infoCenter.purchaseQuestObjective", {
            system: hit.system,
          }),
          type: "VISIT_SYSTEM",
          targetAmount: 1,
          targetSystemId: hit.systemId,
        },
      ],
      reward: { credits: 0, experience: 0, items: [] },
      dialogueAnchors: [],
      deadline: 0,
      failurePenalty: null,
      targetSystemId: hit.systemId,
      targetPlanetId: hit.planetId,
    };
    this.gameEngine.questManager.acceptQuestFromTemplate(
      template,
      hit.planetId,
      currentDay,
      "",
    );
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      pendingNavigateLocationId: hit.planetId,
    });
  }

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
    if (this.activeTab === "gear") {
      if (e.key === "ArrowUp") this.scrollGear(-1);
      if (e.key === "ArrowDown") this.scrollGear(1);
      return;
    }
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

  private scrollNews(deltaRows: number): void {
    if (!this.newsList) {
      this.render();
      return;
    }
    const offsets = this.newsOffsets;
    if (offsets.length === 0) {
      this.render();
      return;
    }
    const current = this.newsList.offset;
    let index = 0;
    while (index + 1 < offsets.length && offsets[index + 1] <= current + 0.5) {
      index += 1;
    }
    const target = Math.min(offsets.length - 1, Math.max(0, index + deltaRows));
    const targetOffset =
      target >= offsets.length - 1 ? this.newsList.maxOffset : offsets[target];
    this.newsList.scrollTo(targetOffset);
    this.newsScroll = this.newsList.offset;
    this.render();
  }

  private scrollGear(deltaRows: number): void {
    if (!this.gearList) {
      this.render();
      return;
    }
    const rowH = Math.max(
      38,
      5 + lineStepFor(scaledFont(11)) + lineStepFor(scaledFont(10)) + 3,
    );
    this.gearList.scrollBy(deltaRows * rowH);
    this.gearScroll = this.gearList.offset;
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
