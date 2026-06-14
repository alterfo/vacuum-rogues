import { GameScene } from "./GameScene";
import {
  Container,
  Graphics,
  Sprite,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { JobBoardPanel } from "./JobBoardPanel";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import { TradeSystem } from "@/systems/TradeSystem";
import { QuestType } from "@/types";
import type { ResourceType } from "@/types";
import {
  pickVariant,
  pickVariantKey,
  panoramaTex,
  tex,
  loadTextureAsync,
} from "./textures";
import { scaledFont } from "@/utils/fontScale";
import { tintFromSeed } from "@/utils/instanceTint";
import { UiButton, type ButtonAccent } from "./ui/UiButton";
import { getRepLabel, getRepColor } from "@/utils/reputationUtils";

interface PlanetContext {
  gameEngine?: GameEngine;
  planet?: Planet;
}

/** A planet-surface action button (governor, garage, market, …, take-off). */
export interface PlanetServiceButton {
  label: string;
  color: number;
  action: () => void;
}

interface ServiceButtonDef {
  icon: string;
  label: string;
  accent: ButtonAccent | number;
  action: () => void;
}

/**
 * Which station services are offered on a planet. Uninhabited worlds have no
 * station services — only "Взлёт" (take-off); once drones exist, also "leave a
 * drone". Inhabited worlds show the full set (US-070 #12).
 */
export function visiblePlanetServices<T extends { label: string }>(
  isHabitable: boolean,
  buttons: T[],
): T[] {
  if (isHabitable) return buttons;
  return buttons.filter((b) => b.label === "Взлёт");
}

const PANORAMA_PARALLAX_MAX = 30;

/**
 * Pure helper for parallax offset: maps mouse X to a target panorama X.
 * norm = -1 at left edge, +1 at right edge; result = baseX ± maxOffset.
 */
export function computeParallaxTargetX(
  mouseX: number,
  screenWidth: number,
  baseX: number,
  maxOffset: number,
): number {
  const norm = (mouseX / screenWidth) * 2 - 1;
  return baseX + norm * maxOffset;
}

/**
 * Clamp the panorama's horizontal offset so its edges never reveal empty space
 * (Task 6). When the panorama is wider than the screen, x is constrained to
 * `[screenWidth - panoramaWidth, 0]`; when it is narrower (or equal) it is
 * centred and cannot be dragged.
 */
export function clampPanoramaX(
  x: number,
  panoramaWidth: number,
  screenWidth: number,
): number {
  if (panoramaWidth <= screenWidth) return (screenWidth - panoramaWidth) / 2;
  const min = screenWidth - panoramaWidth; // negative — right edge of pan range
  return Math.max(min, Math.min(0, x));
}

/**
 * Build a top→bottom procedural sky gradient (Task 6 fallback when no panorama
 * art exists). Returns `steps` band colours: the top band is near-black space,
 * lower bands blend up to ~45% toward the controlling faction's colour so the
 * sky reads as that faction's world instead of flat black.
 */
export function skyGradientColors(baseColor: number, steps: number): number[] {
  const br = (baseColor >> 16) & 0xff;
  const bg = (baseColor >> 8) & 0xff;
  const bb = baseColor & 0xff;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps <= 1 ? 1 : i / (steps - 1); // 0 at top → 1 at bottom
    const mix = t * 0.45;
    const r = Math.round(0x02 + (br - 0x02) * mix);
    const g = Math.round(0x03 + (bg - 0x03) * mix);
    const b = Math.round(0x0a + (bb - 0x0a) * mix);
    out.push((r << 16) | (g << 8) | b);
  }
  return out;
}

const BRIBE_COST = 500;
const PLANET_VISUAL_RADIUS = 196;

const FACTION_RU: Record<string, string> = {
  OUTLANDERS: "Окраинники",
  BASTIONS: "Бастион",
  SYNDICATE: "Синдикат",
  PARADOXES: "Парадокс",
  PROGRESSORS: "Прогрессоры",
  INDEPENDENT: "Независимая",
  OVERMIND: "Сверхразум",
};

const FACTION_COLOR: Record<string, number> = {
  OUTLANDERS: 0xff6600,
  BASTIONS: 0xcc2222,
  SYNDICATE: 0x22cc22,
  PARADOXES: 0xaa22cc,
  PROGRESSORS: 0x2266ff,
  INDEPENDENT: 0x999999,
  OVERMIND: 0xff22cc,
};

const FACTION_PANORAMA: Record<string, string> = {
  OUTLANDERS: "outlanders_city",
  BASTIONS: "bastions_city",
  SYNDICATE: "syndicate_city",
  PARADOXES: "paradoxes_city",
  PROGRESSORS: "progressors_city",
  INDEPENDENT: "wilderness_jungle",
  OVERMIND: "wilderness_tundra",
};

/**
 * Vertical layout for the planet service-menu button stack. Regression (playtest2
 * ⑥, real-pointer verification): at 1280×720 the eighth button «Взлёт» overflowed
 * below the viewport, so the critical take-off action was only half-clickable.
 * Distribute `count` buttons across the space between the content above
 * (`contentBottomY`) and a bottom margin so the LAST button's bottom edge always
 * stays on-screen, and consecutive buttons never overlap (overlap steals clicks).
 */
export function computePlanetMenuLayout(
  screenH: number,
  contentBottomY: number,
  count: number,
): { btnStartY: number; btnStep: number; btnH: number } {
  const bottomMargin = 16;
  const btnStartY = contentBottomY + 36;
  const avail = Math.max(0, screenH - bottomMargin - btnStartY);
  // Cap the step so buttons aren't enormous on tall screens; shrink to fit on
  // short ones.
  const btnStep = count > 0 ? Math.min(38, avail / count) : 32;
  // Button height sits a hair under the step so consecutive buttons never
  // overlap; floor 20 keeps the label legible. The hard cap at `floor(btnStep)`
  // preserves the no-overlap invariant even on very short screens (< ~700px),
  // where the 20px floor would otherwise exceed the step and steal clicks.
  const btnH = Math.min(
    Math.max(20, Math.min(Math.floor(btnStep) - 2, 32)),
    Math.floor(btnStep),
  );
  return { btnStartY, btnStep, btnH };
}

/** Ultimate panorama fallback (Task 8) when no other key resolves. */
const PANORAMA_FALLBACK = "outlanders_city";

/** Wild/uninhabited backdrops keyed by terrain type (playtest5: planet
 *  backdrops were all the same because the key was faction-only). */
const WILDERNESS_PANORAMA: Record<string, string> = {
  ICE: "wilderness_tundra",
  VOLCANIC: "wilderness_desert",
  GAS_GIANT: "wilderness_desert", // no surface — neutral barren backdrop
  TERRESTRIAL: "wilderness_jungle",
  // Settled types under INDEPENDENT/OVERMIND (no city art) get terrain backdrops
  // rather than falling through to the hardcoded "wilderness_jungle" default.
  HABITAT: "wilderness_jungle",
  INDUSTRIAL: "wilderness_desert",
};

/**
 * Resolve the panorama asset key for a specific planet. Settled worlds
 * (HABITAT/INDUSTRIAL) under one of the five real factions wear that faction's
 * cityscape; every other world wears a wilderness backdrop chosen by its
 * terrain type. Keying by planet type (not just faction) is what gives adjacent
 * planets distinct backdrops (playtest5 — "фон у планет одинаковый").
 */
export function panoramaKeyForPlanet(
  planetType: string,
  faction: string,
): string {
  if (planetType === "HABITAT" || planetType === "INDUSTRIAL") {
    const city = FACTION_PANORAMA[faction];
    if (city && city.endsWith("_city")) return city;
  }
  return WILDERNESS_PANORAMA[planetType] ?? "wilderness_jungle";
}

/** Planet type → `surfaces/` biome prefix (per-planet generated backdrops). */
const PLANET_BIOME: Record<string, string> = {
  ICE: "ice",
  VOLCANIC: "volcanic",
  GAS_GIANT: "gas",
  TERRESTRIAL: "terran",
  INDUSTRIAL: "industrial",
  HABITAT: "city",
};

/**
 * Resolve the FULL manifest key for a planet's backdrop. Prefers a per-planet
 * generated surface panorama (`surfaces/<biome>_NN`, chosen deterministically
 * by planet id, so every planet gets its own), and falls back to the shared
 * type/faction panorama (`panoramas/...`) until that art is generated. Exported
 * for testing.
 */
export function resolvePlanetBackdropKey(
  planetType: string,
  planetId: string,
  faction: string,
): string {
  const biome = PLANET_BIOME[planetType] ?? "terran";
  const surfaceKey = pickVariantKey("surfaces", biome, planetId);
  if (surfaceKey) return surfaceKey;
  return `panoramas/${panoramaKeyForPlanet(planetType, faction)}`;
}

function planetTexturePrefix(type: string): string {
  const map: Record<string, string> = {
    TERRESTRIAL: "terrestrial",
    GAS_GIANT: "gas",
    ICE: "ice",
    VOLCANIC: "volcanic",
    INDUSTRIAL: "industrial",
    HABITAT: "habitat",
  };
  return map[type] ?? "terrestrial";
}

const PLANET_FALLBACK_COLORS: Record<string, number[]> = {
  TERRESTRIAL: [0x0a2c4c, 0x1a5c8c, 0x2a7c44, 0x3a9c55, 0x1e6e4a],
  GAS_GIANT: [0x5c2a00, 0x8c5a1a, 0xaa7733, 0xcc9944, 0xaa7733],
  ICE: [0x6699cc, 0xaaccff, 0xccddff, 0xeeeeff, 0xccddff],
  VOLCANIC: [0x400800, 0x8c1a00, 0xcc3300, 0xff5500, 0xcc3300],
  INDUSTRIAL: [0x223344, 0x334455, 0x445566, 0x556677, 0x445566],
  HABITAT: [0x11883a, 0x22aa44, 0x33bb55, 0x44cc66, 0x33bb55],
};

const RESOURCE_RU: Record<string, string> = {
  FUEL: "Топливо",
  METALS: "Металлы",
  CRYSTALS: "Кристаллы",
  ORGANICS: "Органика",
  ARTIFACTS: "Артефакты",
  WEAPONS: "Оружие",
  MEDICINE: "Медикаменты",
  ELECTRONICS: "Электроника",
  LUXURY: "Роскошь",
  DATA_CORES: "Ядра данных",
};

export class PlanetScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private uiContainer: Container | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private jobBoardPanel: JobBoardPanel | null = null;
  /** Bribe paid this landing — gates are lifted for the duration of the visit. */
  private bribed = false;

  // Planet backdrop (F5, 2026-06-10): the flat-sprite light parallax below is
  // the PRIMARY backdrop. The Task 8 GLSL `PanoramaViewer` projection was
  // dropped — at FOV 100° it fisheyed the equirect map like a magnifying lens,
  // contradicting the agreed "light parallax" look. We pan a wide flat sprite
  // horizontally with a gentle mouse-X drift instead.

  // Task 6 — panorama drag-to-look + rotating planet orb
  private panoramaSprite: Sprite | null = null;
  private panoramaWidth = 0;
  private isPanningPanorama = false;
  private lastPanoramaPointerX = 0;
  private planetOrbSprite: Sprite | null = null;
  private boundPanoramaMove: ((e: FederatedPointerEvent) => void) | null = null;
  private boundPanoramaUp: (() => void) | null = null;
  // Parallax: base X set at sprite creation; targetX tracks smooth destination.
  private panoramaBaseX = 0;
  private panoramaTargetX = 0;

  initialize(context?: object): void {
    const ctx = context as PlanetContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;
    this.bribed = false;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Resolve faction for panorama key (same logic as createUI)
    const initSystem = this.gameEngine?.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet?.id),
    );
    const initFaction = initSystem?.ownerFaction ?? "INDEPENDENT";
    const backdropKey = resolvePlanetBackdropKey(
      this.planet?.type ?? "TERRESTRIAL",
      this.planet?.id ?? "",
      initFaction,
    );

    // Show scene immediately with dark fallback, then swap in panorama when loaded.
    this.createUI();
    logger.info(`PlanetScene: ${this.planet?.name}`);
    this.gameEngine?.audio.playSfx("land").catch(() => {});
    this.checkDeliveryQuestCompletion();
    this.checkCustoms();

    // Panorama drag-to-look (Task 6): the wide background pans horizontally as
    // the player drags. Move/up are tracked on the stage so a drag started over
    // the background keeps tracking even if the pointer leaves the sprite.
    this.boundPanoramaMove = (e) => this.onPanoramaMove(e);
    this.boundPanoramaUp = () => {
      this.isPanningPanorama = false;
    };
    const stage = this.renderer.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.renderer.app.screen;
    stage.on("pointermove", this.boundPanoramaMove);
    stage.on("pointerup", this.boundPanoramaUp);
    stage.on("pointerupoutside", this.boundPanoramaUp);

    if (!tex(backdropKey)) {
      // Task 8: lazy-load the per-planet backdrop behind the US-076 loading
      // overlay, falling back to outlanders_city if the art is unavailable.
      this.gameEngine?.showLoadingOverlay("Посадка…");
      loadTextureAsync(backdropKey)
        .then((t) => t ?? loadTextureAsync(`panoramas/${PANORAMA_FALLBACK}`))
        .then((tex) => {
          this.gameEngine?.hideLoadingOverlay();
          if (tex && this.planet) {
            this.renderer.clearGameLayer();
            this.renderer.clearUILayer();
            this.createUI();
          }
        })
        .catch(() => {
          this.gameEngine?.hideLoadingOverlay();
        });
    }
  }

  update(deltaTime: number): void {
    // Subtle planet-orb rotation (Task 6). deltaTime is in ms; ~0.04 rad/s gives
    // a slow, barely-perceptible spin (full turn ≈ 160 s).
    if (this.planetOrbSprite && !this.planetOrbSprite.destroyed) {
      this.planetOrbSprite.rotation += deltaTime * 0.00004;
    }

    // Parallax easing: smooth the panorama toward the mouse-driven target.
    if (
      !this.isPanningPanorama &&
      this.panoramaSprite &&
      !this.panoramaSprite.destroyed
    ) {
      const factor = Math.min(1, 0.0048 * deltaTime);
      const w = this.renderer.app.screen.width;
      const next =
        this.panoramaSprite.x +
        (this.panoramaTargetX - this.panoramaSprite.x) * factor;
      this.panoramaSprite.x = clampPanoramaX(next, this.panoramaWidth, w);
    }
  }

  /** Drag-to-look: pan the panorama horizontally, clamped to its edges. */
  private onPanoramaMove(e: FederatedPointerEvent): void {
    if (!this.panoramaSprite || this.panoramaSprite.destroyed) return;
    const w = this.renderer.app.screen.width;

    if (this.isPanningPanorama) {
      const dx = e.global.x - this.lastPanoramaPointerX;
      this.lastPanoramaPointerX = e.global.x;
      const newX = clampPanoramaX(
        this.panoramaSprite.x + dx,
        this.panoramaWidth,
        w,
      );
      this.panoramaSprite.x = newX;
      // Keep base and target in sync during drag so parallax resumes cleanly.
      this.panoramaBaseX = newX;
      this.panoramaTargetX = newX;
    } else {
      // Subtle parallax: drift panorama toward mouse position (no button held).
      this.panoramaTargetX = clampPanoramaX(
        computeParallaxTargetX(
          e.global.x,
          w,
          this.panoramaBaseX,
          PANORAMA_PARALLAX_MAX,
        ),
        this.panoramaWidth,
        w,
      );
    }
  }

  /**
   * Auto-complete DELIVERY quests whose targetSystemId matches the current
   * system. Checks that the player carries the required cargo, removes it from
   * inventory, then force-completes the quest and shows a success toast.
   */
  private checkDeliveryQuestCompletion(): void {
    if (!this.gameEngine?.player || !this.planet) return;
    const currentSystemId = this.gameEngine.player.currentSystemId;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.DELIVERY) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      if (quest.targetSystemId !== currentSystemId) continue;

      // Find the COLLECT_ITEM objective to know what cargo is expected
      const collectObj = quest.objectives.find(
        (o) => o.type === "COLLECT_ITEM" && !o.completed,
      );
      let stackToDeduct: { type: string; amount: number } | undefined;
      if (collectObj && collectObj.itemType) {
        const stack = player.inventory.resources.find(
          (r) => r.type === collectObj.itemType,
        );
        if (!stack || stack.amount < collectObj.targetAmount) continue;
        stackToDeduct = stack as { type: string; amount: number };
      }

      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        if (stackToDeduct && collectObj && collectObj.itemType) {
          stackToDeduct.amount -= collectObj.targetAmount;
          player.contrabandGoods = player.contrabandGoods.filter(
            (g) => g !== (collectObj.itemType as string),
          );
        }
        logger.info(
          `DELIVERY quest auto-completed on landing: ${quest.title} (reward: ${quest.reward?.credits ?? 0} cr)`,
        );
        this.gameEngine?.audio.playSfx("reward").catch(() => {});
        this.showMessage(
          `Задание выполнено: ${quest.title} +${quest.reward?.credits ?? 0} ₡`,
          0x00ff88,
        );
      }
    }
  }

  /**
   * Customs check on landing: if any inventory goods are illegal at this planet,
   * roll a 30% chance of triggering an inspection. If triggered, show the modal.
   */
  private checkCustoms(): void {
    if (!this.gameEngine?.player || !this.planet?.isHabitable) return;
    const system = this.gameEngine.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
    if (!system) return;

    const tradeSystem = new TradeSystem();
    const player = this.gameEngine.player;
    const illegalGoods = player.inventory.resources.filter(
      (r) =>
        r.amount > 0 && !tradeSystem.isLegal(r.type, system.politicalSystem),
    );

    if (illegalGoods.length === 0) return;

    // 30% chance of customs inspection
    if (Math.random() >= 0.3) return;

    const penalty = illegalGoods.reduce((sum, r) => {
      return (
        sum + Math.round(tradeSystem.getBasePrice(r.type) * r.amount * 1.5)
      );
    }, 0);

    const goodNames = illegalGoods
      .map((r) => `${RESOURCE_RU[r.type as string] ?? r.type} (${r.amount})`)
      .join(", ");

    this.showCustomsModal(
      illegalGoods,
      goodNames,
      penalty,
      system.ownerFaction,
    );
  }

  private showCustomsModal(
    illegalGoods: { type: ResourceType; amount: number }[],
    goodNames: string,
    penalty: number,
    faction: string,
  ): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const modal = new Container();

    // Backdrop — blocks all underlying interaction
    const backdrop = new Graphics();
    backdrop.rect(0, 0, w, h);
    backdrop.fill({ color: 0x000000, alpha: 0.75 });
    backdrop.eventMode = "static";
    backdrop.on("pointerdown", (e) => e.stopPropagation());
    modal.addChild(backdrop);

    // Modal box
    const boxW = 460;
    const boxH = 280;
    const boxX = (w - boxW) / 2;
    const boxY = (h - boxH) / 2;
    const box = new Graphics();
    box.rect(boxX, boxY, boxW, boxH);
    box.fill({ color: 0x0d0d1a, alpha: 0.98 });
    box.stroke({ color: 0xff4444, width: 2 });
    modal.addChild(box);

    const addLabel = (
      text: string,
      x: number,
      y: number,
      size: number,
      color: number,
      bold = false,
    ): void => {
      const t = new Text({
        text,
        style: {
          fontFamily: "Courier New",
          fontSize: size,
          fill: color,
          fontWeight: bold ? "bold" : "normal",
          align: "center",
          wordWrap: true,
          wordWrapWidth: boxW - 40,
        },
      });
      t.anchor.set(0.5, 0);
      t.x = x;
      t.y = y;
      t.eventMode = "none";
      modal.addChild(t);
    };

    addLabel(
      "⚠ ТАМОЖЕННЫЙ ДОСМОТР",
      w / 2,
      boxY + 18,
      scaledFont(16),
      0xff4444,
      true,
    );
    addLabel(
      `Нелегальный груз: ${goodNames}`,
      w / 2,
      boxY + 50,
      scaledFont(12),
      0xffaa66,
    );

    const bribeCost = Math.round(penalty * 0.6);

    const makeBtn = (
      label: string,
      yOffset: number,
      color: number,
      onClick: () => void,
    ): void => {
      const btnW = 380;
      const btn = new Container();
      btn.x = (w - btnW) / 2;
      btn.y = boxY + yOffset;
      btn.eventMode = "static";
      btn.cursor = "pointer";

      const bg = new Graphics();
      bg.rect(0, 0, btnW, 34);
      bg.fill({ color, alpha: 0.85 });
      bg.stroke({ color: 0x888888, width: 1 });
      btn.addChild(bg);

      const lbl = new Text({
        text: label,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0xffffff,
        },
      });
      lbl.anchor.set(0.5);
      lbl.x = btnW / 2;
      lbl.y = 17;
      lbl.eventMode = "none";
      btn.addChild(lbl);

      btn.on("pointerdown", (e) => {
        e.stopPropagation();
        onClick();
      });
      btn.on("pointerover", () => {
        bg.clear();
        bg.rect(0, 0, btnW, 34);
        bg.fill({ color, alpha: 1.0 });
        bg.stroke({ color: 0xffffff, width: 1 });
      });
      btn.on("pointerout", () => {
        bg.clear();
        bg.rect(0, 0, btnW, 34);
        bg.fill({ color, alpha: 0.85 });
        bg.stroke({ color: 0x888888, width: 1 });
      });
      modal.addChild(btn);
    };

    const player = this.gameEngine!.player!;

    makeBtn(
      `Заплатить штраф (${penalty} ₡) — репутация -20`,
      110,
      0x660000,
      () => {
        if (player.credits < penalty) {
          this.showMessage(
            `Недостаточно кредитов (нужно ${penalty} ₡)`,
            0xff5544,
          );
          return;
        }
        player.credits -= penalty;
        player.adjustReputation(faction, -20);
        logger.info(
          `Customs fine paid: ${penalty} cr, rep -20 with ${faction}`,
        );
        modal.destroy({ children: true });
        this.showMessage(
          `Штраф уплачен: −${penalty} ₡, репутация −20`,
          0xff8844,
        );
      },
    );

    makeBtn(
      `Дать взятку (${bribeCost} ₡) — без потери репутации`,
      155,
      0x664400,
      () => {
        if (player.credits < bribeCost) {
          this.showMessage(
            `Недостаточно кредитов (нужно ${bribeCost} ₡)`,
            0xff5544,
          );
          return;
        }
        player.credits -= bribeCost;
        logger.info(`Customs bribed: ${bribeCost} cr`);
        modal.destroy({ children: true });
        this.showMessage(`Взятка уплачена: −${bribeCost} ₡`, 0xffaa44);
      },
    );

    makeBtn("Выбросить груз — без штрафа", 200, 0x004400, () => {
      for (const good of illegalGoods) {
        const stack = player.inventory.resources.find(
          (r) => r.type === good.type,
        );
        if (stack) stack.amount = 0;
        player.contrabandGoods = player.contrabandGoods.filter(
          (g) => g !== (good.type as string),
        );
      }
      logger.info("Contraband dumped to avoid customs");
      modal.destroy({ children: true });
      this.showMessage("Нелегальный груз выброшен", 0x66ff66);
    });

    addLabel(
      `Штраф: ${penalty} ₡  •  Взятка: ${bribeCost} ₡`,
      w / 2,
      boxY + 248,
      scaledFont(11),
      0xaaaaaa,
    );

    this.renderer.uiLayer.addChild(modal);
  }

  destroy(): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    // Detach panorama drag handlers (Task 6).
    const stage = this.renderer?.app?.stage;
    if (stage) {
      if (this.boundPanoramaMove) {
        stage.off("pointermove", this.boundPanoramaMove);
      }
      if (this.boundPanoramaUp) {
        stage.off("pointerup", this.boundPanoramaUp);
        stage.off("pointerupoutside", this.boundPanoramaUp);
      }
    }
    this.boundPanoramaMove = null;
    this.boundPanoramaUp = null;
    this.panoramaSprite = null;
    this.planetOrbSprite = null;
    this.isPanningPanorama = false;
    this.closeJobBoard();
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.uiContainer = null;
    this.gameEngine = null;
    this.planet = null;
  }

  private createUI(): void {
    if (!this.planet) return;
    const ui = new Container();
    this.uiContainer = ui;
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    // Resolve faction data needed by panorama + multiple UI elements
    const system = this.gameEngine?.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );
    const faction = system?.ownerFaction ?? "INDEPENDENT";
    const factionName = FACTION_RU[faction] ?? faction;
    const factionColor = FACTION_COLOR[faction] ?? 0x999999;

    // Panoramic background: per-planet generated surface (surfaces/<biome>_NN)
    // when available, else the shared type/faction panorama. Lazy-loaded.
    const backdropKey = resolvePlanetBackdropKey(
      this.planet?.type ?? "TERRESTRIAL",
      this.planet?.id ?? "",
      faction,
    );
    const panTex = tex(backdropKey) ?? panoramaTex(PANORAMA_FALLBACK);
    const hasPanorama = !!panTex && panTex.width > 1 && panTex.height > 0;

    if (hasPanorama) {
      // F5 (primary): flat panorama sprite with drag-to-look + a gentle mouse-X
      // parallax drift (Task 6). This is the agreed "light parallax" — NOT the
      // dropped GLSL projection, which fisheyed the equirect map at the edges.
      const panorama = new Sprite(panTex);
      const aspect = panTex!.width / panTex!.height;
      panorama.height = h;
      panorama.width = h * aspect;
      if (panorama.width < w) {
        // Narrower than the screen — fall back to width-fill (no pan room).
        panorama.width = w;
        panorama.height = w / aspect;
      }
      panorama.y = (h - panorama.height) / 2;
      panorama.x = clampPanoramaX((w - panorama.width) / 2, panorama.width, w);
      // Per-instance variety: a subtle, deterministic tint keyed by planet.id
      // so two worlds sharing the same type/faction backdrop still look
      // distinct (on top of the per-id surface-variant spread). Bounded band —
      // never near-black or neon.
      panorama.tint = tintFromSeed(this.planet?.id ?? "");
      // Draggable: start a pan on press; stage move/up (initialize) do the rest.
      panorama.eventMode = "static";
      panorama.cursor = "grab";
      panorama.on("pointerdown", (e: FederatedPointerEvent) => {
        this.isPanningPanorama = true;
        this.lastPanoramaPointerX = e.global.x;
      });
      this.panoramaSprite = panorama;
      this.panoramaWidth = panorama.width;
      this.panoramaBaseX = panorama.x;
      this.panoramaTargetX = panorama.x;
      this.renderer.gameLayer.addChild(panorama);
    } else {
      // No panorama art: procedural sky gradient tinted toward the faction colour.
      this.panoramaSprite = null;
      const bands = skyGradientColors(factionColor, 10);
      const bandH = h / bands.length;
      const bg = new Graphics();
      for (let i = 0; i < bands.length; i++) {
        bg.rect(0, i * bandH, w, bandH + 1);
        bg.fill({ color: bands[i] });
      }
      bg.eventMode = "none";
      this.renderer.gameLayer.addChild(bg);
    }

    // Dark overlay so UI is readable over any background image
    const overlay = new Graphics();
    overlay.rect(0, 0, w, h);
    overlay.fill({ color: 0x000011, alpha: 0.55 });
    overlay.eventMode = "none";
    this.renderer.gameLayer.addChild(overlay);

    const planetCX = w / 2;
    const planetCY = Math.min(h * 0.2, PLANET_VISUAL_RADIUS + 10);

    // Atmospheric glow: concentric semi-transparent rings
    const glowAlphas = [0.15, 0.08, 0.03];
    const glowRings = [
      PLANET_VISUAL_RADIUS + 22,
      PLANET_VISUAL_RADIUS + 40,
      PLANET_VISUAL_RADIUS + 60,
    ];
    for (let i = 0; i < glowRings.length; i++) {
      const glow = new Graphics();
      glow.circle(planetCX, planetCY, glowRings[i]);
      glow.fill({ color: factionColor, alpha: glowAlphas[i] });
      glow.eventMode = "none";
      this.renderer.gameLayer.addChild(glow);
    }

    // Planet body: use texture variant or procedural gradient fallback
    const prefix = planetTexturePrefix(this.planet.type);
    const planetTex = pickVariant("planets", prefix, this.planet.id);
    if (planetTex) {
      const sprite = new Sprite(planetTex);
      sprite.anchor.set(0.5);
      sprite.x = planetCX;
      sprite.y = planetCY;
      sprite.width = PLANET_VISUAL_RADIUS * 2;
      sprite.height = PLANET_VISUAL_RADIUS * 2;
      sprite.eventMode = "none";
      this.planetOrbSprite = sprite;
      this.renderer.gameLayer.addChild(sprite);
    } else {
      this.planetOrbSprite = null;
      const fallbackColors = PLANET_FALLBACK_COLORS[this.planet.type] ?? [
        0x555566, 0x666677,
      ];
      const steps = fallbackColors.length;
      const gfx = new Graphics();
      for (let i = steps - 1; i >= 0; i--) {
        const r = PLANET_VISUAL_RADIUS * ((i + 1) / steps);
        gfx.circle(planetCX, planetCY, r);
        gfx.fill({ color: fallbackColors[i] });
      }
      gfx.eventMode = "none";
      this.renderer.gameLayer.addChild(gfx);
    }

    // Faction banner: top-left strip with faction name
    const bannerX = 16;
    const bannerY = 16;
    const bannerW = 230;
    const bannerH = 28;
    const factionBg = new Graphics();
    factionBg.rect(bannerX, bannerY, bannerW, bannerH);
    factionBg.fill({ color: factionColor, alpha: 0.85 });
    factionBg.eventMode = "none";
    ui.addChild(factionBg);

    const factionLabel = new Text({
      text: factionName,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    factionLabel.x = bannerX + 8;
    factionLabel.y = bannerY + 7;
    factionLabel.eventMode = "none";
    ui.addChild(factionLabel);

    // Reputation indicator dots (5 dots, filled left-to-right by rep level)
    const rep = this.gameEngine?.player?.reputation[faction] ?? 0;
    const repLevel =
      rep >= 50 ? 4 : rep >= 10 ? 3 : rep >= -20 ? 2 : rep >= -50 ? 1 : 0;
    const dotColors = [0xff2222, 0xff8888, 0xaaaaaa, 0x88ff88, 0x00ff88];
    for (let i = 0; i < 5; i++) {
      const dot = new Graphics();
      dot.circle(bannerX + 10 + i * 16, bannerY + bannerH + 8, 5);
      dot.fill({ color: i <= repLevel ? dotColors[i] : 0x333344 });
      dot.eventMode = "none";
      ui.addChild(dot);
    }

    // Capture warning banner
    if (this.planet.capturedBy) {
      const captureName =
        FACTION_RU[this.planet.capturedBy] ?? this.planet.capturedBy;
      const captureBg = new Graphics();
      captureBg.rect(bannerX, bannerY + bannerH + 22, bannerW + 40, 24);
      captureBg.fill({ color: 0xff0000, alpha: 0.85 });
      captureBg.eventMode = "none";
      ui.addChild(captureBg);

      const captureLabel = new Text({
        text: `⚠ ЗАХВАЧЕНА: ${captureName}`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(12),
          fill: 0xffffff,
          fontWeight: "bold",
        },
      });
      captureLabel.x = bannerX + 6;
      captureLabel.y = bannerY + bannerH + 27;
      captureLabel.eventMode = "none";
      ui.addChild(captureLabel);
    }

    // Credits HUD: top-right
    if (this.gameEngine?.player) {
      const creditsHud = new Text({
        text: `${this.gameEngine.player.credits.toLocaleString("ru")} ₡`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(14),
          fill: 0xffdd44,
          fontWeight: "bold",
        },
      });
      creditsHud.anchor.set(1, 0);
      creditsHud.x = w - 16;
      creditsHud.y = 16;
      creditsHud.eventMode = "none";
      ui.addChild(creditsHud);
    }

    // Layout calculations: flow below the planet
    const nameY = planetCY + PLANET_VISUAL_RADIUS + 16;
    const subtitleY = nameY + 24;
    const infoY = nameY + 46;
    const statY = infoY + 64;

    // Planet name header: larger font in the controlling faction's colour.
    const title = new Text({
      text: this.planet.name,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(30),
        fill: factionColor,
        fontWeight: "bold",
        align: "center",
      },
    });
    title.anchor.set(0.5);
    title.x = w / 2;
    title.y = nameY;
    title.eventMode = "none";
    ui.addChild(title);

    // Subtitle: planet type and habitability status.
    const subtitle = new Text({
      text: `${this.getType(this.planet.type)} • ${
        this.planet.isHabitable ? "Обитаемая" : "Необитаемая"
      }`,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: 0x99bbcc,
        align: "center",
      },
    });
    subtitle.anchor.set(0.5);
    subtitle.x = w / 2;
    subtitle.y = subtitleY;
    subtitle.eventMode = "none";
    ui.addChild(subtitle);

    // Planet info panel (US-060): faction, econ type, reputation, market goods.
    this.addInfoPanel(ui, w, infoY);

    // Hangar stat bar: hull / fuel in compact line (credits shown in top-right HUD).
    if (this.gameEngine?.player) {
      const ship = this.gameEngine.player.ship;
      const hullPct = Math.round((ship.hullHP / ship.maxHull) * 100);
      const fuelPct = Math.round(
        (ship.energy / Math.max(1, ship.maxEnergy)) * 100,
      );
      const bars = (pct: number): string =>
        "█".repeat(Math.round(pct / 10)) +
        "░".repeat(10 - Math.round(pct / 10));
      const statLine = new Text({
        text: `Корпус: ${bars(hullPct)} ${hullPct}%   Топливо: ${bars(fuelPct)} ${fuelPct}%`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0x88aacc,
          align: "center",
        },
      });
      statLine.anchor.set(0.5);
      statLine.x = w / 2;
      statLine.y = statY;
      statLine.eventMode = "none";
      ui.addChild(statLine);
    }

    const buttons: ServiceButtonDef[] = [
      {
        icon: "📋",
        label: "Губернатор",
        accent: "success",
        action: () => this.openGovernor(),
      },
      {
        icon: "≡",
        label: "Задания",
        accent: "primary",
        action: () => this.openJobBoard(),
      },
      {
        icon: "🔍",
        label: "Инфоцентр",
        accent: "primary",
        action: () => this.openInfoCenter(),
      },
      {
        icon: "⚔",
        label: "Снаряжение",
        accent: "primary",
        action: () => this.openEquipmentShop(),
      },
      {
        icon: "⚙",
        label: "Верфь",
        accent: "primary",
        action: () => this.openGarage(),
      },
      {
        icon: "📦",
        label: "Маркет",
        accent: "neutral",
        action: () => this.openMarket(),
      },
      {
        icon: "✦",
        label: "Исследования",
        accent: "neutral",
        action: () => this.openResearch(),
      },
      {
        icon: "🚀",
        label: "Взлёт",
        accent: "danger",
        action: () => this.takeOff(),
      },
    ];

    // Reputation gate: hostile faction blocks all services except take-off.
    const player = this.gameEngine?.player;
    const isHostile = !this.bribed && (player?.isHostileTo(faction) ?? false);

    // Which buttons are shown drives the adaptive vertical layout: the stack
    // (plus the optional bribe button) must fit on-screen at every resolution.
    const visible = visiblePlanetServices(this.planet.isHabitable, buttons);
    const showBribe = isHostile && this.planet.isHabitable;
    const { btnStartY, btnStep, btnH } = computePlanetMenuLayout(
      h,
      statY,
      visible.length + (showBribe ? 1 : 0),
    );
    const btnW = 280;

    const makeServiceBtn = (
      b: ServiceButtonDef,
      yPos: number,
      blocked: boolean,
    ): void => {
      if (blocked) {
        const btn = new Container();
        btn.x = w / 2 - btnW / 2;
        btn.y = yPos;
        const bg = new Graphics();
        bg.roundRect(0, 0, btnW, btnH, 4).fill({ color: 0x1a1a2e, alpha: 0.9 });
        bg.roundRect(0, 0, btnW, btnH, 4).stroke({ color: 0x334455, width: 1 });
        bg.eventMode = "none";
        btn.addChild(bg);
        const lbl = new Text({
          text: `${b.icon} ${b.label}`,
          style: {
            fontFamily: "Courier New",
            fontSize: scaledFont(13),
            fill: 0x8899aa,
            fontWeight: "bold",
          },
        });
        lbl.anchor.set(0.5);
        lbl.x = btnW / 2;
        lbl.y = btnH / 2;
        lbl.eventMode = "none";
        btn.addChild(lbl);
        btn.eventMode = "none";
        ui.addChild(btn);
        return;
      }
      const btn = new UiButton(
        b.icon,
        b.label,
        b.accent,
        (e) => {
          e.stopPropagation();
          b.action();
        },
        btnW,
        btnH,
      );
      btn.x = w / 2 - btnW / 2;
      btn.y = yPos;
      ui.addChild(btn.container);
    };

    let y = btnStartY;
    for (const b of visible) {
      makeServiceBtn(b, y, isHostile && b.label !== "Взлёт");
      y += btnStep;
    }

    // Show bribe button when hostile to the controlling faction.
    if (showBribe) {
      makeServiceBtn(
        {
          icon: "💰",
          label: `Взятка (${BRIBE_COST} ₡)`,
          accent: 0xffaa44,
          action: () => this.payBribe(faction),
        },
        y,
        false,
      );
    }

    this.renderer.uiLayer.addChild(ui);
  }

  /**
   * Planet information card (US-060): faction, economic type, player reputation
   * with the controlling faction, and a short market goods summary.
   */
  private addInfoPanel(ui: Container, w: number, topY: number): void {
    if (!this.planet || !this.gameEngine) return;

    const system = this.gameEngine.galaxy?.systems.find((s) =>
      s.planets.some((p) => p.id === this.planet!.id),
    );

    const faction = system?.ownerFaction ?? "INDEPENDENT";
    const factionName = FACTION_RU[faction] ?? faction;
    const factionColor = FACTION_COLOR[faction] ?? 0x999999;

    const rep = this.gameEngine.player?.reputation[faction] ?? 0;
    const repLabel = getRepLabel(rep);
    const repColor = getRepColor(rep);

    const goods = this.planet.market.availableResources
      .slice(0, 4)
      .map((r) => RESOURCE_RU[r as string] ?? String(r))
      .join(", ");

    // Line 1: type • faction (coloured)
    const typeText = new Text({
      text: `${this.getType(this.planet.type)} • `,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: 0x889aaa,
      },
    });
    typeText.eventMode = "none";
    typeText.anchor.set(0.5, 0);
    typeText.x = w / 2 - 40;
    typeText.y = topY;
    ui.addChild(typeText);

    const factionText = new Text({
      text: factionName,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(13),
        fill: factionColor,
        fontWeight: "bold",
      },
    });
    factionText.eventMode = "none";
    factionText.anchor.set(0, 0);
    factionText.x = w / 2 - 40 + typeText.width;
    factionText.y = topY;
    ui.addChild(factionText);

    // Line 2: reputation status (inhabited planets only)
    const repYOffset = this.planet.isHabitable ? 20 : 0;
    if (this.planet.isHabitable) {
      const repLine = new Text({
        text: `Отношение: `,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: 0x889aaa,
        },
      });
      repLine.eventMode = "none";
      repLine.anchor.set(0.5, 0);
      repLine.x = w / 2 - 30;
      repLine.y = topY + 20;
      ui.addChild(repLine);

      const repText = new Text({
        text: `${repLabel} (${rep >= 0 ? "+" : ""}${rep})`,
        style: {
          fontFamily: "Courier New",
          fontSize: scaledFont(13),
          fill: repColor,
          fontWeight: "bold",
        },
      });
      repText.eventMode = "none";
      repText.anchor.set(0, 0);
      repText.x = w / 2 - 30 + repLine.width;
      repText.y = topY + 20;
      ui.addChild(repText);
    }

    // Line 3: market goods (or inhabitation status)
    const goodsLine = this.planet.isHabitable
      ? `Рынок: ${goods || "нет данных"}`
      : `Дроны: ${this.planet.drones}  •  Необитаемая`;
    const goodsText = new Text({
      text: goodsLine,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(12),
        fill: 0x6688aa,
        align: "center",
      },
    });
    goodsText.eventMode = "none";
    goodsText.anchor.set(0.5, 0);
    goodsText.x = w / 2;
    goodsText.y = topY + 20 + repYOffset;
    ui.addChild(goodsText);
  }

  private payBribe(faction: string): void {
    const player = this.gameEngine?.player;
    if (!player) return;
    if (player.credits < BRIBE_COST) {
      this.showMessage(
        `Нужно ${BRIBE_COST} ₡ — недостаточно средств`,
        0xff5544,
      );
      return;
    }
    player.credits -= BRIBE_COST;
    this.bribed = true;
    logger.info(
      `PlanetScene: bribed customs at ${this.planet?.name} (faction ${faction})`,
    );
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.createUI();
    this.showMessage("Взятка принята. Добро пожаловать.", 0xffaa44);
  }

  private async openGovernor(): Promise<void> {
    if (!this.planet || !this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.GOVERNMENT, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  /** Open the planet job board (EPIC-008): the quests this planet offers now. */
  private openJobBoard(): void {
    if (!this.gameEngine || !this.planet) return;
    this.closeJobBoard();
    const quests = this.gameEngine.getQuestBoard(this.planet.id);
    const { width, height } = this.renderer.app.screen;
    const activeQuests = this.gameEngine.questManager.getActiveQuests();
    const activeCount = activeQuests.length;
    const currentDay = this.gameEngine.galaxy?.gameDays ?? 0;
    const acceptedIds = new Set<string>([
      ...activeQuests.map((q) => q.id),
      ...this.gameEngine.questManager.getCompletedQuestIds(),
    ]);
    this.jobBoardPanel = new JobBoardPanel(
      quests,
      width,
      height,
      {
        onAccept: (q) => this.acceptJob(q),
        onClose: () => this.closeJobBoard(),
      },
      activeCount,
      acceptedIds,
      activeQuests,
      currentDay,
      this.gameEngine.player?.rank ?? 0,
    );
    this.renderer.uiLayer.addChild(this.jobBoardPanel.container);
  }

  private acceptJob(q: GeneratedQuest): void {
    if (!this.gameEngine || !this.planet) return;
    const accepted = this.gameEngine.acceptBoardQuest(q, this.planet.id);
    if (accepted) {
      if (q.template.type === QuestType.TEXT_ADVENTURE) {
        this.showMessage("Текст-квест (скоро)", 0xffaa44);
      } else {
        this.showMessage(`Задание принято: ${q.template.title}`, 0x00ff88);
      }
      this.openJobBoard(); // refresh — the accepted quest drops off the board
    } else {
      this.showMessage("Не удалось принять задание", 0xffaa00);
    }
  }

  private closeJobBoard(): void {
    const panel = this.jobBoardPanel;
    this.jobBoardPanel = null;
    if (panel) {
      this.renderer?.uiLayer?.removeChild(panel.container);
      panel.destroy();
    }
  }

  private openGarage(): void {
    if (!this.gameEngine?.player) return;
    const ship = this.gameEngine.player.ship;
    const missing = ship.maxHull - ship.hullHP;

    if (missing <= 0) {
      this.showMessage("Корпус уже в идеальном состоянии", 0x00ff88);
      return;
    }

    const cost = Math.ceil(missing * 2);
    if (this.gameEngine.player.credits < cost) {
      this.showMessage(
        `Недостаточно кредитов на ремонт (нужно ${cost})`,
        0xff5555,
      );
      return;
    }

    this.gameEngine.player.credits -= cost;
    ship.repair();
    logger.info(`Repaired for ${cost}`);
    this.showMessage(
      `Корпус восстановлен (+${missing}) за ${cost} кр.`,
      0x00ff88,
    );
  }

  private async openInfoCenter(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.INFO_CENTER, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private async openEquipmentShop(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.EQUIPMENT_SHOP, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private async openMarket(): Promise<void> {
    if (!this.gameEngine || !this.planet) return;
    await this.gameEngine.transitionTo(SceneType.TRADE, {
      gameEngine: this.gameEngine,
      planet: this.planet,
    });
  }

  private openResearch(): void {
    // Research station is not implemented yet; give honest feedback instead of
    // silently swallowing the click.
    this.showMessage("Исследовательская станция пока в разработке", 0xffaa00);
  }

  private async takeOff(): Promise<void> {
    if (!this.gameEngine) return;
    const loadoutStats = this.gameEngine.playerLoadout?.derivedStats();
    if (loadoutStats && !loadoutStats.canTakeOff) {
      this.showMessage("Нет двигателя — взлёт невозможен", 0xff4444);
      return;
    }
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      // Spawn the ship next to this planet, not at the distant system edge.
      fromPlanetId: this.planet?.id,
    });
  }

  /**
   * E2E helper: drive the real "Взлёт" take-off (F4 regression). Exercises the
   * production path (`takeOff` → `transitionTo(SPACE_FLIGHT, { fromPlanetId })`)
   * so the test catches a lost re-entry marker after the shop round-trip; a raw
   * `transitionTo` would bypass the very code under test.
   */
  e2eTakeOff(): Promise<void> {
    if (!__DEBUG__) return Promise.resolve();
    return this.takeOff();
  }

  /**
   * Show a transient feedback message near the bottom of the planet screen.
   */
  private showMessage(text: string, color: number): void {
    if (!this.uiContainer) return;

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    const existing = this.uiContainer.getChildByLabel?.("planet-toast");
    if (existing) existing.destroy();

    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const toast = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(16),
        fill: color,
        fontWeight: "bold",
        align: "center",
      },
    });
    toast.label = "planet-toast";
    toast.anchor.set(0.5);
    toast.x = w / 2;
    toast.y = h - 40;
    toast.eventMode = "none";
    this.uiContainer.addChild(toast);

    this.toastTimeout = setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
      this.toastTimeout = null;
    }, 3000);
  }

  private getType(type: string): string {
    const t: Record<string, string> = {
      TERRESTRIAL: "Земной",
      GAS_GIANT: "Газовый гигант",
      ICE: "Ледяной",
      VOLCANIC: "Вулканический",
      INDUSTRIAL: "Промышленный",
      HABITAT: "Обитаемый",
    };
    return t[type] ?? type;
  }
}
