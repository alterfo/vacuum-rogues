import { Container, Graphics, Sprite, type Texture, type Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import { scaledText } from "./ui/scaledText";
import { loadTextureAsync, pickVariant, pickVariantKey, tex } from "./textures";
import { resolveHullArtKey } from "./flight/hullArtAlias";
import { ArcadeBackground } from "./blackHoleArcade/arcadeBackground";
import {
  ARCADE_THEMES,
  getArcadeArt,
  type ArcadeArt,
} from "./blackHoleArcade/arcadeArt";
import { ArcadeButtons } from "./blackHoleArcade/arcadeButtons";
import { ArcadeFx } from "./blackHoleArcade/arcadeFx";
import { isTouchLayoutActive } from "./ui/responsiveLayout";
import { reducedMotion } from "./ui/reducedMotion";
import {
  ArcadeSound,
  type ArcadeMusicMode,
} from "./blackHoleArcade/arcadeSound";
import { ArcadeHud, type HudLayout } from "./blackHoleArcade/arcadeHud";
import {
  buildBanner,
  buildEnd,
  buildIntermission,
  buildPause,
  type OverlayArea,
} from "./blackHoleArcade/arcadeOverlays";
import { SpritePool } from "./blackHoleArcade/spritePool";
import { allTextures } from "@/assets/manifest";
import type { GameEngine } from "@/systems/GameEngine";
import {
  GL_COUNTERPARTY,
  adjustPlayerCredits,
} from "@/systems/banking/economy";
import { SceneType } from "@/types";
import { stripArcadeQuery } from "@/systems/arcadeLaunch";
import {
  ARCADE_FX_QUALITY,
  ARCADE_QUALITY_MAX_LEVEL,
  AdaptiveQuality,
  RelativeDrag,
} from "@/systems/blackHoleArcade/arcadeTouch";
import {
  ARCADE_FIELD_H as FIELD_H,
  ARCADE_FIELD_W as FIELD_W,
  ARCADE_MAX_FRAME_MS,
  ARCADE_PLAYER_MARGIN,
} from "@/systems/blackHoleArcade/arcadeConfig";
import {
  ARCADE_ENEMY_DEFS,
  hullDifficulty,
} from "@/systems/blackHoleArcade/arcadeEnemies";
import {
  advanceLevel,
  createArcadeRun,
  tick,
} from "@/systems/blackHoleArcade/arcadeState";
import {
  arcadeLevelReward,
  arcadeRunReward,
  type ArcadeEnding,
} from "@/systems/blackHoleArcade/arcadeRewards";
import type {
  ArcadeBullet,
  ArcadeEnemy,
  ArcadeEnemyTypeId,
  ArcadeInput,
  ArcadePhase,
  ArcadeRunState,
} from "@/systems/blackHoleArcade/arcadeTypes";
import { t } from "@/i18n/i18n";
import { logger } from "@/utils/logger";

interface BlackHoleArcadeContext {
  gameEngine?: GameEngine;
  returnSystemId?: string;
  blackHoleSystemId?: string;
  startLevel?: number;
}

interface EnemyArt {
  prefix: string | null;
  size: number;
}

const ENEMY_ART: Readonly<Record<ArcadeEnemyTypeId, EnemyArt>> = {
  scout: { prefix: "pirate", size: 78 },
  weaver: { prefix: "ranger", size: 82 },
  diver: { prefix: "overmind_small", size: 76 },
  gunship: { prefix: "patrol", size: 118 },
  bomber: { prefix: "trader", size: 134 },
  sniper: { prefix: "overmind_medium", size: 116 },
  carrier: { prefix: "trader", size: 150 },
  strafer: { prefix: "overmind_small", size: 70 },
  turret: { prefix: null, size: 84 },
  tank: { prefix: null, size: 112 },
  mineLayer: { prefix: "overmind_medium", size: 128 },
  armored: { prefix: "overmind_large", size: 176 },
  spinner: { prefix: "overmind_medium", size: 124 },
  cruiser: { prefix: "overmind_large", size: 270 },
  boss: { prefix: "overmind_boss", size: 340 },
};

const BOSS_TINTS = [0xffffff, 0xffd4d4, 0xd4ffe4, 0xd4e4ff, 0xffd4fa];
const BULLET_HEIGHT: Readonly<Record<string, number>> = {
  pulse: 50,
  laser: 92,
  missile: 56,
  drone: 36,
  enemyNeedle: 46,
  enemyMine: 58,
};

const SIDE_PANEL_MIN = 200;
const TOP_BAND = 72;
const TOUCH_SAFE_TOP = 16;
const ROTATE_HINT_MS = 4500;
const CLEAR_BANNER_MS = 2100;
const INTRO_BANNER_MS = 2300;
const TOAST_MS = 1300;

type OverlayKind = "none" | "banner" | "intermission" | "pause" | "end";

export class BlackHoleArcadeScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private returnSystemId: string | null = null;
  private blackHoleSystemId: string | null = null;
  private startLevel = 1;

  private state: ArcadeRunState = createArcadeRun();
  private art: ArcadeArt | null = null;
  private root: Container | null = null;
  private world: Container | null = null;
  private background: ArcadeBackground | null = null;
  private hud: ArcadeHud | null = null;
  private overlayLayer: Container | null = null;
  private fx: ArcadeFx | null = null;
  private sound: ArcadeSound | null = null;
  private buttons: ArcadeButtons | null = null;
  private touchUi = false;
  private practice = false;
  private drag = new RelativeDrag();
  private quality = new AdaptiveQuality(0);
  private qualityApplied = -1;
  private reducedMotionEnabled = false;
  private uiPointers = new Set<number>();
  private savedCanvasStyle: { touchAction: string; userSelect: string } | null =
    null;
  private savedOverscroll = "";
  private boundVisibility: (() => void) | null = null;
  private boundPointerCancel: ((e: PointerEvent) => void) | null = null;
  private groundPool: SpritePool | null = null;
  private shadowPool: SpritePool | null = null;
  private pickupPool: SpritePool | null = null;
  private enemyPool: SpritePool | null = null;
  private auraPool: SpritePool | null = null;
  private playerBulletPool: SpritePool | null = null;
  private enemyBulletPool: SpritePool | null = null;
  private bossGfx: Graphics | null = null;
  private bossLabel: Text | null = null;
  private toastText: Text | null = null;
  private flashSprite: Sprite | null = null;
  private player: {
    shadow: Sprite;
    flames: Sprite[];
    ship: Sprite;
    shield: Sprite;
    drones: Sprite[];
  } | null = null;

  private overlay: Container | null = null;
  private overlayKind: OverlayKind = "none";
  private bannerMs = 0;
  private toastMs = 0;
  private paused = false;
  private ended: ArcadeEnding | null = null;
  private payout: number | null = null;
  private exiting = false;
  private lastPhase: ArcadePhase = "playing";
  private clockMs = 0;
  private autoFire = true;
  private firingHeld = false;
  private bombQueued = false;
  private keys = new Set<string>();
  private pointerField: { x: number; y: number } | null = null;
  private keyboardMode = false;

  private fieldX = 0;
  private fieldY = 0;
  private fieldScale = 1;
  private lastW = 0;
  private lastH = 0;
  private shipKeys = new Map<string, string[]>();
  private enemyTextureCache = new Map<string, Texture | null>();
  private playerTexture: Texture | null = null;
  private playerTextureKey: string | null = null;

  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundContextMenu: ((e: Event) => void) | null = null;
  private boundBlur: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as BlackHoleArcadeContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.returnSystemId = ctx?.returnSystemId ?? null;
    this.blackHoleSystemId = ctx?.blackHoleSystemId ?? null;
    this.startLevel = ctx?.startLevel ?? 1;

    this.state = createArcadeRun({
      seed: (Date.now() ^ 0x5bd1e995) & 0x7fffffff,
      startLevel: this.startLevel,
      difficulty: hullDifficulty(this.pilotMaxHull()),
    });
    this.lastPhase = "playing";
    this.paused = false;
    this.ended = null;
    this.payout = null;
    this.exiting = false;
    this.clockMs = 0;
    this.autoFire = true;
    this.firingHeld = false;
    this.bombQueued = false;
    this.keys.clear();
    this.pointerField = null;
    this.keyboardMode = false;
    this.overlay = null;
    this.overlayKind = "none";
    this.lastW = 0;
    this.lastH = 0;

    this.touchUi = isTouchLayoutActive();
    this.practice = !this.gameEngine?.player;
    this.drag = new RelativeDrag();
    this.uiPointers.clear();
    this.reducedMotionEnabled = reducedMotion();
    this.quality = new AdaptiveQuality(
      this.reducedMotionEnabled
        ? ARCADE_QUALITY_MAX_LEVEL
        : this.touchUi
          ? 1
          : 0,
    );
    this.qualityApplied = -1;
    this.art = getArcadeArt();
    this.sound = new ArcadeSound();
    this.buildScene(this.art);
    if (this.reducedMotionEnabled) {
      this.background?.setReducedMotion(true);
      this.fx?.setReducedMotion(true);
    }
    this.attachInput();
    this.setCursorHidden(true);
    this.layout();
    this.background?.setTheme(this.state.plan.theme);
    this.showLevelIntro();
    if (
      this.touchUi &&
      typeof window !== "undefined" &&
      window.innerWidth > window.innerHeight &&
      window.innerHeight < 520
    ) {
      this.toastMs = ROTATE_HINT_MS;
      if (this.toastText) this.toastText.text = t("arcade.hint.rotate");
    }

    logger.info("BlackHoleArcadeScene initialized", {
      hasEngine: this.gameEngine !== null,
      returnSystemId: this.returnSystemId,
      blackHoleSystemId: this.blackHoleSystemId,
      startLevel: this.startLevel,
    });
  }

  update(deltaTime: number): void {
    if (!this.root || !this.art) return;
    this.layout();
    const frameMs = Math.min(Math.max(0, deltaTime), ARCADE_MAX_FRAME_MS);
    this.clockMs += frameMs;

    const live =
      !this.paused &&
      this.ended === null &&
      (this.state.phase === "playing" || this.state.phase === "levelClear");
    if (live) {
      tick(this.state, this.buildInput(), frameMs);
      this.handleEvents();
    }
    this.handlePhaseChange();
    this.updateMusic();
    this.tickOverlays(frameMs);
    this.applyQuality(this.quality.sample(frameMs));
    this.render(frameMs);
  }

  destroy(): void {
    this.detachInput();
    this.setCursorHidden(false);
    this.fx?.destroy();
    this.sound?.destroy();
    this.sound = null;
    for (const pool of [
      this.groundPool,
      this.shadowPool,
      this.pickupPool,
      this.enemyPool,
      this.auraPool,
      this.playerBulletPool,
      this.enemyBulletPool,
    ]) {
      pool?.destroy();
    }
    this.hud?.destroy();
    this.buttons?.destroy();
    this.buttons = null;
    this.background?.destroy();
    this.overlayLayer?.destroy({ children: true });
    this.world?.destroy({ children: true });
    this.root?.destroy({ children: true });
    this.fx = null;
    this.groundPool = null;
    this.shadowPool = null;
    this.pickupPool = null;
    this.enemyPool = null;
    this.auraPool = null;
    this.playerBulletPool = null;
    this.enemyBulletPool = null;
    this.hud = null;
    this.background = null;
    this.overlayLayer = null;
    this.overlay = null;
    this.world = null;
    this.root = null;
    this.player = null;
    this.bossGfx = null;
    this.bossLabel = null;
    this.toastText = null;
    this.flashSprite = null;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.gameEngine = null;
    this.returnSystemId = null;
    this.blackHoleSystemId = null;
  }

  private buildScene(art: ArcadeArt): void {
    this.root = new Container();
    this.renderer.gameLayer.addChild(this.root);

    this.background = new ArcadeBackground(art);
    this.root.addChild(this.background.screen);

    this.world = new Container();
    this.root.addChild(this.world);
    const mask = new Graphics();
    mask.rect(0, 0, FIELD_W, FIELD_H).fill({ color: 0xffffff });
    this.world.addChild(mask);
    this.world.mask = mask;
    this.world.addChild(this.background.field);

    const layer = (): Container => {
      const c = new Container();
      this.world!.addChild(c);
      return c;
    };
    const groundLayer = layer();
    const shadowLayer = layer();
    const pickupLayer = layer();
    const auraLayer = layer();
    const enemyLayer = layer();
    const playerBulletLayer = layer();
    const playerLayer = layer();
    const enemyBulletLayer = layer();
    const fxLayer = layer();
    const topLayer = layer();

    this.groundPool = new SpritePool(groundLayer);
    this.shadowPool = new SpritePool(shadowLayer);
    this.pickupPool = new SpritePool(pickupLayer);
    this.auraPool = new SpritePool(auraLayer, true);
    this.enemyPool = new SpritePool(enemyLayer);
    this.playerBulletPool = new SpritePool(playerBulletLayer, true);
    this.enemyBulletPool = new SpritePool(enemyBulletLayer, true);

    const mkSprite = (
      parent: Container,
      texture: Texture,
      additive = false,
    ): Sprite => {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.eventMode = "none";
      if (additive) s.blendMode = "add";
      parent.addChild(s);
      return s;
    };
    const shadow = mkSprite(playerLayer, art.glow);
    shadow.tint = 0x000000;
    shadow.alpha = 0.4;
    const flames = [
      mkSprite(playerLayer, art.flame, true),
      mkSprite(playerLayer, art.flame, true),
    ];
    const ship = mkSprite(playerLayer, art.glow);
    const shield = mkSprite(playerLayer, art.shieldBubble, true);
    const drones = [
      mkSprite(playerLayer, art.drone),
      mkSprite(playerLayer, art.drone),
    ];
    this.player = { shadow, flames, ship, shield, drones };

    this.fx = new ArcadeFx(fxLayer, art);

    this.bossGfx = new Graphics();
    topLayer.addChild(this.bossGfx);
    this.bossLabel = scaledText("", 13, 0xffd166, {
      rawColor: true,
      fontWeight: "bold",
    });
    this.bossLabel.anchor.set(0.5, 1);
    this.bossLabel.x = FIELD_W / 2;
    this.bossLabel.y = 24;
    this.bossLabel.eventMode = "none";
    topLayer.addChild(this.bossLabel);
    this.toastText = scaledText("", 18, 0xffd166, {
      rawColor: true,
      fontWeight: "bold",
    });
    this.toastText.anchor.set(0.5);
    this.toastText.x = FIELD_W / 2;
    this.toastText.y = 92;
    this.toastText.eventMode = "none";
    topLayer.addChild(this.toastText);

    this.flashSprite = mkSprite(topLayer, art.glow, true);
    this.flashSprite.x = FIELD_W / 2;
    this.flashSprite.y = FIELD_H / 2;
    this.flashSprite.width = FIELD_W * 2.2;
    this.flashSprite.height = FIELD_H * 2.2;
    this.flashSprite.alpha = 0;

    this.hud = new ArcadeHud(art);
    this.renderer.uiLayer.addChild(this.hud.root);
    this.overlayLayer = new Container();
    this.renderer.uiLayer.addChild(this.overlayLayer);
    this.buttons = new ArcadeButtons(art, {
      onSound: () => this.toggleSound(),
      onPause: () => this.togglePause(),
      onBomb: () => this.queueBomb(),
      onUiPointer: (id) => this.uiPointers.add(id),
    });
    this.renderer.uiLayer.addChild(this.buttons.root);

    for (const prefix of new Set(
      Object.values(ENEMY_ART)
        .map((a) => a.prefix)
        .filter((p): p is string => p !== null),
    )) {
      this.shipKeys.set(
        prefix,
        allTextures("ships")
          .filter((k) => k.startsWith(`ships/${prefix}_`))
          .sort(),
      );
    }
  }

  private layout(): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;

    const inset = this.touchUi ? TOUCH_SAFE_TOP : 0;
    const topBand = TOP_BAND + inset;
    if (this.hud) this.hud.root.y = inset;
    const fullScale = Math.min(w / FIELD_W, h / FIELD_H);
    const side = (w - FIELD_W * fullScale) / 2;
    let mode: HudLayout["mode"];
    if (side >= SIDE_PANEL_MIN) {
      mode = "side";
      this.fieldScale = fullScale;
      this.fieldX = side;
      this.fieldY = (h - FIELD_H * fullScale) / 2;
    } else {
      mode = "top";
      const room = h - topBand;
      this.fieldScale = Math.min(w / FIELD_W, room / FIELD_H);
      this.fieldX = (w - FIELD_W * this.fieldScale) / 2;
      this.fieldY = topBand + (room - FIELD_H * this.fieldScale) / 2;
    }
    this.background?.resize(w, h);
    this.hud?.layout({
      mode,
      width: w,
      height: h,
      fieldX: this.fieldX,
      fieldY: this.fieldY,
      fieldW: FIELD_W * this.fieldScale,
      fieldH: FIELD_H * this.fieldScale,
    });
    this.buttons?.layout(w, h, this.touchUi);
    this.world?.scale.set(this.fieldScale);
    this.positionWorld(0, 0);
    if (this.overlayKind !== "none") this.rebuildOverlay();
  }

  private positionWorld(shakeX: number, shakeY: number): void {
    if (!this.world) return;
    this.world.x = this.fieldX + shakeX * this.fieldScale;
    this.world.y = this.fieldY + shakeY * this.fieldScale;
  }

  private overlayArea(): OverlayArea {
    return {
      cx: this.fieldX + (FIELD_W * this.fieldScale) / 2,
      cy: this.fieldY + (FIELD_H * this.fieldScale) / 2,
      width: this.lastW,
      height: this.lastH,
    };
  }

  private attachInput(): void {
    this.boundKeyDown = (e) => this.onKeyDown(e);
    this.boundKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === "Space") this.firingHeld = false;
    };
    this.boundPointerMove = (e) => this.onPointerMove(e);
    this.boundPointerDown = (e) => this.onPointerDown(e);
    this.boundPointerUp = (e) => {
      this.sound?.unlock();
      this.uiPointers.delete(e.pointerId);
      if (e.pointerType === "touch") {
        this.drag.end(e.pointerId);
        return;
      }
      if (e.button === 0) this.firingHeld = false;
    };
    this.boundPointerCancel = (e) => {
      this.uiPointers.delete(e.pointerId);
      this.drag.end(e.pointerId);
    };
    this.boundVisibility = () => {
      if (
        typeof document !== "undefined" &&
        document.hidden &&
        this.canPause()
      ) {
        this.setPaused(true);
      }
    };
    this.boundContextMenu = (e) => e.preventDefault();
    this.boundBlur = () => {
      this.keys.clear();
      this.firingHeld = false;
      if (this.canPause()) this.setPaused(true);
    };
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
    window.addEventListener("pointermove", this.boundPointerMove);
    window.addEventListener(
      "pointerrawupdate",
      this.boundPointerMove as EventListener,
    );
    window.addEventListener("pointerdown", this.boundPointerDown);
    window.addEventListener("pointerup", this.boundPointerUp);
    window.addEventListener("contextmenu", this.boundContextMenu);
    window.addEventListener("blur", this.boundBlur);
    window.addEventListener("pointercancel", this.boundPointerCancel);
    window.addEventListener("pagehide", this.boundVisibility);
    document.addEventListener("visibilitychange", this.boundVisibility);
    this.lockBrowserGestures(true);
  }

  private detachInput(): void {
    if (this.boundKeyDown)
      window.removeEventListener("keydown", this.boundKeyDown);
    if (this.boundKeyUp) window.removeEventListener("keyup", this.boundKeyUp);
    if (this.boundPointerMove) {
      window.removeEventListener("pointermove", this.boundPointerMove);
      window.removeEventListener(
        "pointerrawupdate",
        this.boundPointerMove as EventListener,
      );
    }
    if (this.boundPointerDown)
      window.removeEventListener("pointerdown", this.boundPointerDown);
    if (this.boundPointerUp)
      window.removeEventListener("pointerup", this.boundPointerUp);
    if (this.boundContextMenu)
      window.removeEventListener("contextmenu", this.boundContextMenu);
    if (this.boundBlur) window.removeEventListener("blur", this.boundBlur);
    if (this.boundPointerCancel) {
      window.removeEventListener("pointercancel", this.boundPointerCancel);
    }
    if (this.boundVisibility) {
      window.removeEventListener("pagehide", this.boundVisibility);
      document.removeEventListener("visibilitychange", this.boundVisibility);
    }
    this.lockBrowserGestures(false);
    this.boundPointerCancel = null;
    this.boundVisibility = null;
    this.boundKeyDown = null;
    this.boundKeyUp = null;
    this.boundPointerMove = null;
    this.boundPointerDown = null;
    this.boundPointerUp = null;
    this.boundContextMenu = null;
    this.boundBlur = null;
    this.keys.clear();
  }

  private lockBrowserGestures(lock: boolean): void {
    const canvas = this.renderer.app.canvas as HTMLCanvasElement | undefined;
    const root =
      typeof document !== "undefined" ? document.documentElement : null;
    if (lock) {
      if (canvas?.style) {
        this.savedCanvasStyle = {
          touchAction: canvas.style.touchAction,
          userSelect: canvas.style.userSelect,
        };
        canvas.style.touchAction = "none";
        canvas.style.userSelect = "none";
      }
      if (root) {
        this.savedOverscroll = root.style.overscrollBehavior;
        root.style.overscrollBehavior = "none";
      }
      return;
    }
    if (canvas?.style && this.savedCanvasStyle) {
      canvas.style.touchAction = this.savedCanvasStyle.touchAction;
      canvas.style.userSelect = this.savedCanvasStyle.userSelect;
    }
    if (root) root.style.overscrollBehavior = this.savedOverscroll;
    this.savedCanvasStyle = null;
  }

  private setCursorHidden(hidden: boolean): void {
    const canvas = this.renderer.app.canvas as HTMLCanvasElement | undefined;
    if (canvas?.style) canvas.style.cursor = hidden ? "none" : "";
  }

  private canPause(): boolean {
    return (
      !this.paused &&
      this.ended === null &&
      (this.state.phase === "playing" || this.state.phase === "levelClear")
    );
  }

  private toScreen(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.renderer.app.canvas as HTMLCanvasElement | undefined;
    const rect = canvas?.getBoundingClientRect?.();
    const screen = this.renderer.app.screen;
    const sx = rect && rect.width > 0 ? screen.width / rect.width : 1;
    const sy = rect && rect.height > 0 ? screen.height / rect.height : 1;
    return {
      x: (clientX - (rect?.left ?? 0)) * sx,
      y: (clientY - (rect?.top ?? 0)) * sy,
    };
  }

  private toField(clientX: number, clientY: number): { x: number; y: number } {
    const p = this.toScreen(clientX, clientY);
    return {
      x: (p.x - this.fieldX) / this.fieldScale,
      y: (p.y - this.fieldY) / this.fieldScale,
    };
  }

  private markTouch(): void {
    if (this.touchUi) return;
    this.touchUi = true;
    this.lastW = 0;
  }

  private onTouchDown(e: PointerEvent): void {
    this.markTouch();
    if (this.drag.activeId !== null) return;
    if (this.paused || this.ended !== null) return;
    if (this.state.phase !== "playing" && this.state.phase !== "levelClear")
      return;
    const p = this.toScreen(e.clientX, e.clientY);
    const ship = this.state.player;
    this.drag.begin(e.pointerId, p.x, p.y, ship.x, ship.y);
    this.pointerField = { x: ship.x, y: ship.y };
    this.keyboardMode = false;
  }

  private onTouchMove(e: PointerEvent): void {
    if (this.drag.activeId !== e.pointerId) return;
    const p = this.toScreen(e.clientX, e.clientY);
    const moved = this.drag.move(e.pointerId, p.x, p.y, this.fieldScale, {
      minX: ARCADE_PLAYER_MARGIN,
      maxX: FIELD_W - ARCADE_PLAYER_MARGIN,
      minY: ARCADE_PLAYER_MARGIN,
      maxY: FIELD_H - ARCADE_PLAYER_MARGIN,
    });
    if (moved) {
      this.pointerField = moved;
      this.keyboardMode = false;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType === "touch") {
      this.onTouchMove(e);
      return;
    }
    this.pointerField = this.toField(e.clientX, e.clientY);
    this.keyboardMode = false;
  }

  private queueBomb(): void {
    if (this.state.phase === "playing" && !this.paused && this.ended === null) {
      this.bombQueued = true;
    }
  }

  private togglePause(): void {
    if (this.paused) this.setPaused(false);
    else if (this.canPause()) this.setPaused(true);
  }

  private onPointerDown(e: PointerEvent): void {
    this.sound?.unlock();
    if (this.uiPointers.delete(e.pointerId)) return;
    if (e.pointerType === "touch") {
      this.onTouchDown(e);
      return;
    }
    if (!this.pointerField || e.type === "pointerdown") {
      this.pointerField = this.toField(e.clientX, e.clientY);
    }
    if (this.paused || this.ended !== null || this.state.phase !== "playing")
      return;
    if (e.button === 0) this.firingHeld = true;
    else if (e.button === 2) this.bombQueued = true;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault?.();
    this.sound?.unlock();
    switch (e.code) {
      case "KeyM":
        if (!e.repeat) this.toggleSound();
        return;
      case "Escape":
        if (this.ended !== null) this.exit();
        else if (this.paused) this.setPaused(false);
        else if (this.canPause()) this.setPaused(true);
        return;
      case "Enter":
        if (this.ended !== null) this.exit();
        else if (this.paused) this.setPaused(false);
        else if (this.state.phase === "intermission") this.continueRun();
        return;
      case "KeyC":
        if (this.state.phase === "intermission" && this.ended === null) {
          this.finishRun("cashOut");
        }
        return;
      case "KeyL":
        if (this.paused && this.ended === null) this.finishRun("retreat");
        return;
      case "KeyF":
        if (!e.repeat) this.autoFire = !this.autoFire;
        return;
      case "KeyB":
        if (!e.repeat && this.state.phase === "playing" && !this.paused) {
          this.bombQueued = true;
        }
        return;
      case "KeyP":
        if (this.paused) this.setPaused(false);
        else if (this.canPause()) this.setPaused(true);
        return;
      default:
        break;
    }
    this.keys.add(e.code);
    if (e.code === "Space") this.firingHeld = true;
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.code)
    ) {
      this.keyboardMode = true;
    }
  }

  private buildInput(): ArcadeInput {
    const k = this.keys;
    const moveX =
      (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) -
      (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const moveY =
      (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) -
      (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0);
    const useMouse = !this.keyboardMode && this.pointerField !== null;
    const bomb = this.bombQueued;
    this.bombQueued = false;
    return {
      targetX: useMouse ? this.pointerField!.x : null,
      targetY: useMouse ? this.pointerField!.y : null,
      moveX,
      moveY,
      firing: this.autoFire || this.firingHeld || k.has("Space"),
      bomb,
    };
  }

  private toggleSound(): void {
    if (!this.sound) return;
    this.sound.toggle();
    this.sound.unlock();
  }

  private updateMusic(): void {
    if (!this.sound) return;
    const s = this.state;
    let mode: ArcadeMusicMode = "off";
    if (!this.paused && this.ended === null && s.phase === "playing") {
      mode = s.enemies.some((e) => e.isBoss) ? "boss" : "calm";
    }
    this.sound.setMusic(mode, s.plan.theme);
  }

  private handleEvents(): void {
    const p = this.state.player;
    for (const event of this.state.events) {
      this.fx?.handle(event, p.x, p.y);
      this.sound?.handle(event);
      if (event.kind === "playerHit" && !event.shielded) this.buzz(40);
      else if (event.kind === "bombStart") this.buzz(90);
      else if (event.kind === "bossDown") this.buzz(200);
      if (event.kind === "pickup") {
        this.toastMs = TOAST_MS;
        if (this.toastText)
          this.toastText.text = t(`arcade.pickup.${event.pickup}`);
      }
    }
  }

  private handlePhaseChange(): void {
    const phase = this.state.phase;
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    switch (phase) {
      case "levelClear":
        this.showBanner(
          t("arcade.level.cleared", { n: this.state.level }),
          t("arcade.end.reward", { n: arcadeLevelReward(this.state.level) }),
          0x5eea7a,
          CLEAR_BANNER_MS,
        );
        break;
      case "intermission":
        this.showIntermission();
        break;
      case "lost":
        this.sound?.cue("lost");
        this.finishRun("lost");
        break;
      case "won":
        this.sound?.cue("won");
        this.finishRun("won");
        break;
      case "playing":
        break;
    }
  }

  private setOverlay(kind: OverlayKind, node: Container | null): void {
    if (this.overlay) {
      this.overlayLayer?.removeChild(this.overlay);
      this.overlay.destroy({ children: true });
    }
    this.overlay = node;
    this.overlayKind = node ? kind : "none";
    if (node) this.overlayLayer?.addChild(node);
    this.setCursorHidden(
      this.overlayKind === "none" || this.overlayKind === "banner",
    );
  }

  private showBanner(
    title: string,
    subtitle: string | null,
    color: number,
    ms: number,
  ): void {
    if (this.overlayKind === "intermission" || this.overlayKind === "end")
      return;
    this.bannerMs = ms;
    this.setOverlay(
      "banner",
      buildBanner(this.overlayArea(), title, subtitle, color),
    );
  }

  private showLevelIntro(): void {
    const plan = this.state.plan;
    const warn =
      plan.bossType === "boss"
        ? t("arcade.level.boss")
        : plan.bossType === "cruiser"
          ? t("arcade.level.miniboss")
          : null;
    this.sound?.cue(warn ? "bossWarning" : "levelStart");
    this.showBanner(
      t("arcade.level.title", { n: this.state.level }),
      warn,
      warn ? 0xff6a6a : 0xffe9a8,
      INTRO_BANNER_MS,
    );
  }

  private label(text: string): string {
    return this.touchUi ? text.replace(/\s*\[[^\]]+\]\s*$/, "") : text;
  }

  private buzz(ms: number): void {
    if (!this.touchUi || typeof navigator === "undefined") return;
    if (typeof navigator.vibrate === "function") navigator.vibrate(ms);
  }

  private applyQuality(level: number): void {
    if (level === this.qualityApplied) return;
    this.qualityApplied = level;
    this.fx?.setQuality(ARCADE_FX_QUALITY[level]);
    this.background?.setDetail(level);
  }

  private showIntermission(): void {
    const s = this.state;
    this.setOverlay(
      "intermission",
      buildIntermission(
        this.overlayArea(),
        {
          title: t("arcade.inter.title"),
          cleared: t("arcade.inter.cleared", { n: s.levelsCleared }),
          reward: this.practice
            ? t("arcade.inter.practice")
            : t("arcade.inter.reward", { n: arcadeRunReward(s, "cashOut") }),
          next: t("arcade.inter.next", { n: s.level + 1 }),
          continueLabel: this.label(t("arcade.inter.continue")),
          cashOutLabel: this.label(
            this.practice
              ? t("arcade.pause.leavePractice")
              : t("arcade.inter.cashout"),
          ),
        },
        () => this.continueRun(),
        () => this.finishRun("cashOut"),
      ),
    );
  }

  private showPause(): void {
    this.setOverlay(
      "pause",
      buildPause(
        this.overlayArea(),
        {
          title: t("arcade.pause.title"),
          resumeLabel: this.label(t("arcade.pause.resume")),
          leaveLabel: this.label(
            this.practice
              ? t("arcade.pause.leavePractice")
              : t("arcade.pause.leave", {
                  n: arcadeRunReward(this.state, "retreat"),
                }),
          ),
        },
        () => this.setPaused(false),
        () => this.finishRun("retreat"),
      ),
    );
  }

  private showEnd(): void {
    if (this.ended === null) return;
    const ending = this.ended;
    const s = this.state;
    const color =
      ending === "won"
        ? 0xffd166
        : ending === "cashOut"
          ? 0x5eea7a
          : ending === "lost"
            ? 0xf87171
            : 0xa59cc8;
    this.setOverlay(
      "end",
      buildEnd(
        this.overlayArea(),
        {
          title: t(`arcade.end.${ending}`),
          stats: t("arcade.end.stats", {
            levels: s.levelsCleared,
            score: s.score,
            kills: s.kills,
          }),
          reward: this.practice
            ? t("arcade.end.practice")
            : t("arcade.end.reward", { n: this.payout ?? 0 }),
          exit: this.label(t("arcade.end.exit")),
        },
        color,
        () => this.exit(),
      ),
    );
  }

  private rebuildOverlay(): void {
    switch (this.overlayKind) {
      case "intermission":
        this.showIntermission();
        break;
      case "pause":
        this.showPause();
        break;
      case "end":
        this.showEnd();
        break;
      case "banner":
        this.setOverlay("none", null);
        break;
      case "none":
        break;
    }
  }

  private tickOverlays(frameMs: number): void {
    if (this.overlayKind === "banner") {
      this.bannerMs -= frameMs;
      if (this.overlay) this.overlay.alpha = Math.min(1, this.bannerMs / 400);
      if (this.bannerMs <= 0) this.setOverlay("none", null);
    }
    if (this.toastMs > 0 && this.toastText) {
      this.toastMs = Math.max(0, this.toastMs - frameMs);
      this.toastText.alpha = Math.min(1, this.toastMs / 400);
      if (this.toastMs === 0) this.toastText.text = "";
    }
  }

  private setPaused(value: boolean): void {
    if (value === this.paused) return;
    this.paused = value;
    this.firingHeld = false;
    if (value) this.showPause();
    else this.setOverlay("none", null);
  }

  private continueRun(): void {
    if (this.state.phase !== "intermission" || this.ended !== null) return;
    if (!advanceLevel(this.state)) return;
    this.lastPhase = "playing";
    this.background?.setTheme(this.state.plan.theme);
    this.setOverlay("none", null);
    this.showLevelIntro();
  }

  private safeBank() {
    try {
      return this.gameEngine?.bank ?? null;
    } catch {
      return null;
    }
  }

  private finishRun(ending: ArcadeEnding): void {
    if (this.ended !== null) return;
    this.ended = ending;
    this.paused = false;
    this.firingHeld = false;
    const amount = this.practice ? 0 : arcadeRunReward(this.state, ending);
    this.payout = amount;
    const player = this.gameEngine?.player;
    if (player && amount > 0) {
      adjustPlayerCredits(
        this.safeBank(),
        player,
        amount,
        GL_COUNTERPARTY.REWARDS,
        t("arcade.reward.reason"),
      );
    }
    this.showEnd();
  }

  private exit(): void {
    if (this.exiting || !this.gameEngine) return;
    this.exiting = true;
    stripArcadeQuery();
    void this.gameEngine
      .transitionTo(
        this.practice ? SceneType.MAIN_MENU : SceneType.SPACE_FLIGHT,
        {
          gameEngine: this.gameEngine,
        },
      )
      .catch((error) => {
        logger.error("Black hole arcade exit failed", error);
      });
  }

  private pilotMaxHull(): number {
    const engine = this.gameEngine;
    const fromLoadout = engine?.playerLoadout?.derivedStats().maxHull;
    if (typeof fromLoadout === "number" && fromLoadout > 0) return fromLoadout;
    return engine?.player?.ship?.maxHull ?? 0;
  }

  private enemyTexture(enemy: ArcadeEnemy): Texture | null {
    const art = ENEMY_ART[enemy.type];
    if (!art.prefix) return null;
    const keys = this.shipKeys.get(art.prefix) ?? [];
    if (keys.length === 0) return null;
    const key = keys[(enemy.id + enemy.variant) % keys.length];
    let cached = this.enemyTextureCache.get(key);
    if (cached === undefined || cached === null) {
      cached = tex(key) ?? null;
      this.enemyTextureCache.set(key, cached);
    }
    return cached;
  }

  private resolvePlayerTexture(): Texture | null {
    if (this.playerTexture) return this.playerTexture;
    const hull = this.gameEngine?.player?.ship?.hullClass ?? "";
    const prefix = resolveHullArtKey(hull.toLowerCase()) || "light_fighter";
    const found =
      pickVariant("player_ships", prefix, "arcade_player") ??
      pickVariant("player_ships", "light_fighter", "arcade_player") ??
      pickVariant("ships", "ranger", "arcade_player") ??
      null;
    if (found) {
      this.playerTexture = found;
      return found;
    }
    const key =
      pickVariantKey("player_ships", prefix, "arcade_player") ??
      pickVariantKey("player_ships", "light_fighter", "arcade_player");
    if (key && key !== this.playerTextureKey) {
      this.playerTextureKey = key;
      void loadTextureAsync(key).then((loaded) => {
        if (loaded && this.root) this.playerTexture = loaded;
      });
    }
    return null;
  }

  private fit(
    sprite: Sprite,
    texture: Texture,
    width: number,
    height?: number,
  ): void {
    const tw = texture.width || 1;
    const th = texture.height || 1;
    const h = height ?? (width * th) / tw;
    sprite.scale.set(width / tw, h / th);
  }

  private bulletTexture(b: ArcadeBullet, art: ArcadeArt): Texture {
    return art.bullets[b.kind];
  }

  private placeBullet(sprite: Sprite, b: ArcadeBullet, texture: Texture): void {
    sprite.x = b.x;
    sprite.y = b.y;
    const fixed = BULLET_HEIGHT[b.kind];
    if (fixed !== undefined) {
      const ratio = (texture.width || 1) / (texture.height || 1);
      this.fit(sprite, texture, fixed * ratio, fixed);
      sprite.rotation = Math.atan2(b.vx, -b.vy);
    } else {
      const size =
        b.kind === "plasma"
          ? b.radius * 3.4
          : b.kind === "enemyBig"
            ? b.radius * 5.2
            : b.kind === "wave"
              ? b.radius * 5
              : b.radius * 5.6;
      this.fit(sprite, texture, size, size);
      sprite.rotation = 0;
    }
  }

  private render(frameMs: number): void {
    const art = this.art;
    const s = this.state;
    if (
      !art ||
      !this.background ||
      !this.groundPool ||
      !this.shadowPool ||
      !this.pickupPool ||
      !this.enemyPool ||
      !this.auraPool ||
      !this.playerBulletPool ||
      !this.enemyBulletPool ||
      !this.player ||
      !this.fx ||
      !this.hud
    ) {
      return;
    }

    this.background.update(s.scrollY, this.clockMs);

    const fxq = ARCADE_FX_QUALITY[Math.max(0, this.qualityApplied)];
    const reducedMotion = this.reducedMotionEnabled;
    this.groundPool.begin();
    this.shadowPool.begin();
    this.enemyPool.begin();
    this.auraPool.begin();
    let boss: ArcadeEnemy | null = null;
    for (const enemy of s.enemies) {
      const def = ENEMY_ART[enemy.type];
      if (enemy.isBoss && !boss) boss = enemy;
      if (enemy.ground) {
        const texture = enemy.type === "tank" ? art.tank : art.turret;
        const sprite = this.groundPool.use(enemy.id, texture);
        sprite.x = enemy.x;
        sprite.y = enemy.y;
        this.fit(sprite, texture, def.size);
        sprite.rotation =
          enemy.type === "turret"
            ? Math.atan2(s.player.x - enemy.x, -(s.player.y - enemy.y))
            : Math.PI;
        sprite.tint = enemy.hitFlashMs > 0 ? 0xffb4b4 : 0xffffff;
        continue;
      }
      if (fxq.shadows) {
        const shadow = this.shadowPool.use(enemy.id, art.glow);
        shadow.x = enemy.x + 16;
        shadow.y = enemy.y + 22;
        this.fit(shadow, art.glow, def.size * 0.95, def.size * 0.7);
        shadow.tint = 0x000000;
        shadow.alpha = 0.32;
      }

      const texture = this.enemyTexture(enemy) ?? art.glow;
      const sprite = this.enemyPool.use(enemy.id, texture);
      sprite.x = enemy.x;
      sprite.y = enemy.y;
      this.fit(sprite, texture, def.size);
      sprite.rotation = Math.PI;
      const base =
        enemy.type === "boss"
          ? BOSS_TINTS[enemy.variant % BOSS_TINTS.length]
          : 0xffffff;
      sprite.tint = enemy.hitFlashMs > 0 ? 0xff9a9a : base;

      if (fxq.auras && (enemy.type === "carrier" || enemy.isBoss)) {
        const aura = this.auraPool.use(enemy.id, art.glow);
        aura.x = enemy.x;
        aura.y = enemy.y;
        const pulse = reducedMotion
          ? 1
          : 1 + Math.sin(this.clockMs / 260 + enemy.id) * 0.12;
        this.fit(
          aura,
          art.glow,
          def.size * (enemy.type === "carrier" ? 1.5 : 1.8) * pulse,
        );
        aura.tint =
          enemy.type === "carrier"
            ? 0xffd166
            : ARCADE_THEMES[s.plan.theme].accent;
        aura.alpha = enemy.type === "carrier" ? 0.75 : 0.45;
      }
    }
    this.groundPool.end();
    this.shadowPool.end();
    this.enemyPool.end();
    this.auraPool.end();

    this.playerBulletPool.begin();
    for (const b of s.playerBullets) {
      const texture = this.bulletTexture(b, art);
      const sprite = this.playerBulletPool.use(b.id, texture);
      this.placeBullet(sprite, b, texture);
    }
    this.playerBulletPool.end();

    this.enemyBulletPool.begin();
    for (const b of s.enemyBullets) {
      const texture = this.bulletTexture(b, art);
      const sprite = this.enemyBulletPool.use(b.id, texture);
      this.placeBullet(sprite, b, texture);
      if (b.kind === "enemyMine") {
        sprite.rotation = reducedMotion ? 0 : b.ageMs / 700;
      }
    }
    this.enemyBulletPool.end();

    this.pickupPool.begin();
    for (const pickup of s.pickups) {
      const texture = art.pickups[pickup.kind];
      const sprite = this.pickupPool.use(pickup.id, texture);
      sprite.x = pickup.x;
      sprite.y = pickup.y;
      const pulse = reducedMotion ? 1 : 1 + Math.sin(pickup.ageMs / 180) * 0.08;
      this.fit(sprite, texture, 58 * pulse);
    }
    this.pickupPool.end();

    this.renderPlayer(art);
    this.renderBossBar(boss);

    this.fx.update(frameMs);
    const shake = this.fx.shakeOffset();
    this.positionWorld(shake.x, shake.y);
    if (this.flashSprite) this.flashSprite.alpha = this.fx.flash * 0.6;

    const reward = arcadeRunReward(s, "cashOut");
    const plan = s.plan;
    const lastSpawn =
      plan.spawns.length > 0 ? plan.spawns[plan.spawns.length - 1].atMs : 1;
    this.hud.update(s, {
      autoFire: this.autoFire,
      levelProgress:
        s.phase === "playing"
          ? Math.min(1, s.levelTimeMs / (lastSpawn + 4000))
          : 1,
      rewardNow: reward,
      practice: this.practice,
      difficulty: s.difficulty,
      soundOn: this.sound?.enabled ?? false,
    });
    this.buttons?.update({
      soundOn: this.sound?.enabled ?? false,
      bombs: s.player.bombs,
      touch: this.touchUi,
      paused: this.paused,
      controlsVisible:
        this.ended === null &&
        (this.overlayKind === "none" ||
          this.overlayKind === "banner" ||
          this.paused) &&
        (s.phase === "playing" || s.phase === "levelClear"),
    });
  }

  private renderPlayer(art: ArcadeArt): void {
    const p = this.state.player;
    const v = this.player;
    if (!v) return;
    const hidden = this.state.phase === "lost";
    const texture = this.resolvePlayerTexture();
    v.ship.visible = !hidden;
    v.shadow.visible = !hidden;
    v.shield.visible = !hidden && p.shield > 0.5;
    for (const flame of v.flames) flame.visible = !hidden;
    for (const drone of v.drones) drone.visible = false;
    if (hidden) return;

    const bombing = this.state.bombFxMs > 0;
    const blink =
      p.invulnMs > 0 && !bombing && Math.floor(this.clockMs / 70) % 2 === 1;
    if (texture) {
      v.ship.texture = texture;
      this.fit(v.ship, texture, 118);
    } else {
      v.ship.texture = art.glow;
      this.fit(v.ship, art.glow, 70);
    }
    v.ship.x = p.x;
    v.ship.y = p.y;
    v.ship.alpha = blink ? 0.35 : 1;
    v.ship.tint = bombing ? 0xffe0e0 : 0xffffff;

    v.shadow.x = p.x + 16;
    v.shadow.y = p.y + 24;
    this.fit(v.shadow, art.glow, 120, 90);

    const flicker = this.reducedMotionEnabled
      ? 1
      : 0.85 + Math.sin(this.clockMs / 38) * 0.15;
    v.flames.forEach((flame, i) => {
      flame.x = p.x + (i === 0 ? -15 : 15);
      flame.y = p.y + 56;
      this.fit(flame, art.flame, 22 * flicker, 70 * flicker);
      flame.alpha = blink ? 0.3 : 0.9;
    });

    v.shield.x = p.x;
    v.shield.y = p.y;
    const ratio = p.shieldMax > 0 ? p.shield / p.shieldMax : 0;
    this.fit(
      v.shield,
      art.shieldBubble,
      150 + (this.reducedMotionEnabled ? 0 : Math.sin(this.clockMs / 220) * 4),
    );
    v.shield.alpha = 0.35 + ratio * 0.55;

    for (let i = 0; i < p.drones; i++) {
      const drone = v.drones[i];
      const side = i % 2 === 0 ? -1 : 1;
      drone.visible = true;
      drone.x = p.x + side * 62;
      drone.y =
        p.y +
        18 +
        (this.reducedMotionEnabled
          ? 0
          : Math.sin(this.clockMs / 300 + i * 2) * 5);
      this.fit(drone, art.drone, 44);
    }
  }

  private renderBossBar(boss: ArcadeEnemy | null): void {
    const g = this.bossGfx;
    if (!g || !this.bossLabel) return;
    g.clear();
    if (!boss) {
      this.bossLabel.text = "";
      return;
    }
    const w = 460;
    const x = FIELD_W / 2 - w / 2;
    const ratio = Math.max(0, boss.hp / boss.maxHp);
    g.roundRect(x - 3, 28, w + 6, 16, 5).fill({ color: 0x0b0818, alpha: 0.85 });
    g.roundRect(x, 31, w * ratio, 10, 3).fill({
      color: ratio > 0.66 ? 0xff6a6a : ratio > 0.33 ? 0xff9a3c : 0xffd166,
    });
    g.roundRect(x - 3, 28, w + 6, 16, 5).stroke({
      color: 0xa59cc8,
      width: 1.5,
    });
    this.bossLabel.text = ARCADE_ENEMY_DEFS[boss.type]
      ? t("arcade.hud.boss")
      : "";
  }
}
