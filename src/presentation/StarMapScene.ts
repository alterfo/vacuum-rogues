import { GameScene } from "./GameScene";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import { Graphics, Text, Container, Sprite, BlurFilter } from "pixi.js";
import type { Texture } from "pixi.js";
import { tex, loadTextureAsync } from "./textures";
import { overmindMoodArtKey } from "./overmindMoodArt";
import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { getSystemVisibility, pickLabelPosition } from "@/utils/starMapUtils";
import type { LabelBound, StarPos, WarpLine } from "@/utils/starMapUtils";
import { computeGalaxyThreat } from "@/systems/galaxy/GalaxyStatusIndicator";
import {
  buildThreatBanner,
  shouldPulseThreatBanner,
  threatBannerPulseAlpha,
} from "./ui/starMapThreatBanner";
import { isDowned } from "@/systems/combat/godMode";
import { FACTION_LABEL } from "@/config/factionConfig";

export interface StarMapContext {
  galaxy?: Galaxy;
  gameEngine?: GameEngine;
  pendingSelectedSystemId?: string;
}

export class StarMapScene extends GameScene {
  private galaxy?: Galaxy;
  private selectedSystemId: string | null = null;
  private playerSystemId: string | null = null;
  private infoPanel: Container | null = null;
  private confirmDialog: Container | null = null;
  private fixedUIContainer: Container | null = null;
  private gameEngine: GameEngine | null = null;

  private readonly MAP_SCALE = 4;

  private readonly DOUBLE_CLICK_MS = 350;
  private lastTapSystemId: string | null = null;
  private lastTapAt = 0;

  private viewportX = 0;
  private viewportY = 0;
  private zoomLevel = 1;
  private isDragging = false;
  private hasDragged = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private mapContainer: Container | null = null;

  private threatBanner: Container | null = null;
  private threatBannerPulsing = false;
  private threatBannerElapsedMs = 0;
  private boundHandleWheel: ((e: WheelEvent) => void) | null = null;
  private boundMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: ((e: MouseEvent) => void) | null = null;
  private messageTimers: ReturnType<typeof setTimeout>[] = [];
  private helpTeardown: (() => void) | null = null;
  private moodBackdrop: Sprite | null = null;
  private moodRenderGen = 0;

  initialize(context?: object): void {
    this.renderer.app.stage.eventMode = "static";

    const ctx = context as StarMapContext | undefined;
    this.galaxy = ctx?.galaxy;
    this.gameEngine = ctx?.gameEngine ?? null;

    if (this.galaxy?.systems.length) {
      const playerCurrentId = this.gameEngine?.player?.currentSystemId;
      if (playerCurrentId) {
        const resolved = this.galaxy.systems.find(
          (s) => s.id === playerCurrentId,
        );
        this.playerSystemId = resolved
          ? resolved.id
          : this.galaxy.systems[0].id;
      } else {
        this.playerSystemId = this.galaxy.systems[0].id;
      }
      this.galaxy.revealSystemAndNeighbors(this.playerSystemId);
    }

    if (ctx?.pendingSelectedSystemId) {
      this.selectedSystemId = ctx.pendingSelectedSystemId;
    }

    this.initializeViewport();

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    this.setupViewportControls();

    this.renderStarMap();

    if (this.selectedSystemId && this.galaxy) {
      const preSelected = this.galaxy.systems.find(
        (s) => s.id === this.selectedSystemId,
      );
      if (preSelected) this.showSystemInfo(preSelected);
    }

    this.mountHelp();

    logger.info("StarMapScene initialized");
  }

  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "STAR_MAP",
    );
  }

  private initializeViewport(): void {
    if (!this.galaxy) return;
    const exploredSystems = this.galaxy.systems.filter((s) => s.explored);
    if (exploredSystems.length === 0) return;

    let minQ = Infinity,
      maxQ = -Infinity,
      minR = Infinity,
      maxR = -Infinity;
    for (const sys of exploredSystems) {
      minQ = Math.min(minQ, sys.coordinates.q);
      maxQ = Math.max(maxQ, sys.coordinates.q);
      minR = Math.min(minR, sys.coordinates.r);
      maxR = Math.max(maxR, sys.coordinates.r);
    }

    const mapW = (maxQ - minQ) * this.MAP_SCALE;
    const mapH = (maxR - minR) * this.MAP_SCALE;
    const screenW = this.renderer.app.screen.width;
    const screenH = this.renderer.app.screen.height;

    if (mapW < 1 && mapH < 1) {
      this.zoomLevel = 2;
    } else {
      const zoomW = mapW > 0 ? (screenW * 0.7) / mapW : Infinity;
      const zoomH = mapH > 0 ? (screenH * 0.7) / mapH : Infinity;
      this.zoomLevel = Math.max(0.5, Math.min(4, Math.min(zoomW, zoomH)));
    }

    const playerSystem = this.galaxy.systems.find(
      (s) => s.id === this.playerSystemId,
    );
    const centerQ = playerSystem
      ? playerSystem.coordinates.q
      : (minQ + maxQ) / 2;
    const centerR = playerSystem
      ? playerSystem.coordinates.r
      : (minR + maxR) / 2;

    this.viewportX = -centerQ * this.MAP_SCALE * this.zoomLevel;
    this.viewportY = -centerR * this.MAP_SCALE * this.zoomLevel;
  }

  private setupViewportControls(): void {
    const canvas = this.renderer.app.canvas;

    this.boundHandleWheel = this.handleWheel.bind(this);
    canvas.addEventListener("wheel", this.boundHandleWheel, { passive: false });

    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    canvas.addEventListener("mousedown", this.boundMouseDown);
    canvas.addEventListener("mousemove", this.boundMouseMove);
    canvas.addEventListener("mouseup", this.boundMouseUp);
    canvas.addEventListener("mouseleave", this.boundMouseUp);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      this.isDragging = true;
      this.hasDragged = false;
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
      this.dragStartX = e.clientX - this.viewportX;
      this.dragStartY = e.clientY - this.viewportY;
      return;
    }
    if (e.button === 0) {
      this.isDragging = true;
      this.hasDragged = false;
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
      this.dragStartX = e.clientX - this.viewportX;
      this.dragStartY = e.clientY - this.viewportY;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const dx = e.clientX - this.pointerStartX;
    const dy = e.clientY - this.pointerStartY;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      this.hasDragged = true;
    }

    if (this.hasDragged) {
      this.viewportX = e.clientX - this.dragStartX;
      this.viewportY = e.clientY - this.dragStartY;
      this.updateMapTransform();
    }
  }

  private handleMouseUp(): void {
    this.isDragging = false;
    setTimeout(() => {
      this.hasDragged = false;
    }, 10);
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    this.zoomLevel = Math.max(0.5, Math.min(4, this.zoomLevel * zoomDelta));
    this.updateMapTransform();
  }

  private updateMapTransform(): void {
    if (!this.mapContainer) return;
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;
    this.mapContainer.x = width / 2 + this.viewportX;
    this.mapContainer.y = height / 2 + this.viewportY;
    this.mapContainer.scale.set(this.zoomLevel);
  }

  update(deltaTime: number): void {
    if (this.threatBanner && this.threatBannerPulsing) {
      this.threatBannerElapsedMs += deltaTime;
      this.threatBanner.alpha = threatBannerPulseAlpha(
        this.threatBannerElapsedMs,
      );
    }
  }

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    this.closeConfirmDialog();
    for (const t of this.messageTimers) clearTimeout(t);
    this.messageTimers = [];
    const canvas = this.renderer.app.canvas;
    if (this.boundHandleWheel) {
      canvas.removeEventListener("wheel", this.boundHandleWheel);
      this.boundHandleWheel = null;
    }
    if (this.boundMouseDown) {
      canvas.removeEventListener("mousedown", this.boundMouseDown);
      this.boundMouseDown = null;
    }
    if (this.boundMouseMove) {
      canvas.removeEventListener("mousemove", this.boundMouseMove);
      this.boundMouseMove = null;
    }
    if (this.boundMouseUp) {
      canvas.removeEventListener("mouseup", this.boundMouseUp);
      canvas.removeEventListener("mouseleave", this.boundMouseUp);
      this.boundMouseUp = null;
    }
    if (this.mapContainer) {
      this.mapContainer.destroy({ children: true });
      this.mapContainer = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.infoPanel = null;
    this.fixedUIContainer = null;
    this.threatBanner = null;
    this.threatBannerPulsing = false;
    this.gameEngine = null;
    this.moodBackdrop = null;
  }

  private mountOvermindMoodBackdrop(width: number, height: number): void {
    if (this.moodBackdrop) {
      this.moodBackdrop.parent?.removeChild(this.moodBackdrop);
      this.moodBackdrop.destroy();
      this.moodBackdrop = null;
    }
    if (!this.galaxy || !this.gameEngine) return;

    const total = this.galaxy.systems.length;
    const key = overmindMoodArtKey({
      peakPower: this.gameEngine.campaignPeakPower ?? 0,
      overmindShare:
        total === 0 ? 0 : this.galaxy.overmindSystems.length / total,
      arcStatus: this.galaxy.overmindArc.status,
    });
    const gen = ++this.moodRenderGen;
    if (!key) return;
    const mount = (t: Texture): void => {
      if (gen !== this.moodRenderGen || !this.gameEngine) return;
      const sp = new Sprite(t);
      const cover = Math.max(width / t.width, height / t.height);
      sp.scale.set(cover);
      sp.anchor.set(0.5);
      sp.x = width / 2;
      sp.y = height / 2;
      sp.alpha = 0.25;
      sp.eventMode = "none";
      this.moodBackdrop = sp;
      this.renderer.gameLayer.addChildAt(sp, 1);
    };

    const cached = tex(key);
    if (cached) mount(cached);
    else
      void loadTextureAsync(key).then((t) => {
        if (t) mount(t);
      });
  }

  private renderStarMap(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const background = new Graphics();
    background.fill({ color: 0x000510 });
    background.rect(0, 0, width, height);
    this.renderer.gameLayer.addChildAt(background, 0);

    this.mountOvermindMoodBackdrop(width, height);

    if (this.fixedUIContainer) {
      if (this.fixedUIContainer.parent) {
        this.renderer.uiLayer.removeChild(this.fixedUIContainer);
      }
      this.fixedUIContainer.destroy({ children: true });
    }
    this.fixedUIContainer = new Container();
    this.threatBanner = null;
    this.threatBannerPulsing = false;

    const title = new Text({
      text: "КАРТА ГАЛАКТИКИ",
      style: {
        fontFamily: "Courier New",
        fontSize: 24,
        fill: 0x00ffff,
        letterSpacing: 4,
      },
    });
    title.x = 20;
    title.y = 20;
    this.fixedUIContainer.addChild(title);

    const currentFuel = this.gameEngine?.player?.ship.energy ?? 0;
    const maxFuel = this.gameEngine?.player?.ship.maxEnergy ?? 100;
    const fuelPercent = Math.round((currentFuel / maxFuel) * 100);
    const fuelColor =
      fuelPercent > 50 ? 0x00ff00 : fuelPercent > 20 ? 0xffaa00 : 0xff4444;

    const fuelText = new Text({
      text: `ТОПЛИВО: ${Math.floor(currentFuel)}/${maxFuel}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: fuelColor,
      },
    });
    fuelText.x = 20;
    fuelText.y = 50;
    this.fixedUIContainer.addChild(fuelText);

    if (this.galaxy) {
      const threat = computeGalaxyThreat(
        this.galaxy.overmindSystems,
        this.galaxy.pirateSystems,
        this.galaxy.systems.length,
      );
      const overmindPct = Math.round(threat.overmindShare * 100);
      const piratePct = Math.round(threat.pirateShare * 100);

      const overmindColor =
        threat.threatLevel === "critical"
          ? 0xff2222
          : threat.threatLevel === "warning"
            ? 0xff8844
            : threat.threatLevel === "caution"
              ? 0xffcc44
              : 0x88ff88;

      const overmindIndicator = new Text({
        text: `РАЗУМ: ${threat.overmindCount}/${threat.totalSystems} (${overmindPct}%)`,
        style: { fontFamily: "Courier New", fontSize: 12, fill: overmindColor },
      });
      overmindIndicator.x = 20;
      overmindIndicator.y = 72;
      overmindIndicator.eventMode = "none";
      this.fixedUIContainer.addChild(overmindIndicator);

      const pirateIndicator = new Text({
        text: `ПИРАТЫ: ${threat.pirateCount}/${threat.totalSystems} (${piratePct}%)`,
        style: { fontFamily: "Courier New", fontSize: 12, fill: 0xff9944 },
      });
      pirateIndicator.x = 20;
      pirateIndicator.y = 90;
      pirateIndicator.eventMode = "none";
      this.fixedUIContainer.addChild(pirateIndicator);

      if (
        threat.threatLevel === "warning" ||
        threat.threatLevel === "critical"
      ) {
        const banner = buildThreatBanner(threat.threatLevel, 20, 108);
        this.threatBanner = banner;
        this.threatBannerPulsing = shouldPulseThreatBanner(threat.threatLevel);
        this.threatBannerElapsedMs = 0;
        this.fixedUIContainer.addChild(banner);
      }
    }

    const instructions = new Text({
      text: "Колесо мыши — зум | Перетаскивание — пан | 2x Клик — вход в систему",
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    instructions.x = 20;
    instructions.y = height - 30;
    instructions.eventMode = "none";
    this.fixedUIContainer.addChild(instructions);

    const backBtn = new Text({
      text: "[ Назад ]",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0x88ccff,
      },
    });
    backBtn.x = width - 120;
    backBtn.y = 20;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      if (this.gameEngine) {
        void this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
          gameEngine: this.gameEngine,
        });
      }
    });
    backBtn.on("pointerover", () => {
      backBtn.alpha = 0.7;
    });
    backBtn.on("pointerout", () => {
      backBtn.alpha = 1;
    });
    this.fixedUIContainer.addChild(backBtn);

    this.renderer.uiLayer.addChild(this.fixedUIContainer);

    if (!this.galaxy) {
      logger.warn("No galaxy available for rendering");
      return;
    }

    if (this.mapContainer) {
      this.renderer.gameLayer.removeChild(this.mapContainer);
      this.mapContainer.destroy({ children: true });
    }
    this.mapContainer = new Container();
    this.mapContainer.x = width / 2 + this.viewportX;
    this.mapContainer.y = height / 2 + this.viewportY;
    this.mapContainer.scale.set(this.zoomLevel);

    const graphics = new Graphics();
    graphics.eventMode = "none";
    const scale = this.MAP_SCALE;

    for (const system of this.galaxy.systems) {
      if (!system.explored) continue;
      for (const conn of system.connections) {
        const target = this.galaxy.systems.find(
          (s) => s.id === conn.toSystemId,
        );
        if (!target || !target.explored) continue;
        graphics.moveTo(
          system.coordinates.q * scale,
          system.coordinates.r * scale,
        );
        graphics.lineTo(
          target.coordinates.q * scale,
          target.coordinates.r * scale,
        );
      }
    }
    graphics.stroke({ width: 1, color: 0x1a3a5c });

    const starPositions: StarPos[] = [];
    const warpLines: WarpLine[] = [];

    for (const system of this.galaxy.systems) {
      if (!system.explored) continue;
      const sx = system.coordinates.q * scale;
      const sy = system.coordinates.r * scale;
      starPositions.push({ x: sx, y: sy, r: 10 }); // Include margin around stars

      for (const conn of system.connections) {
        const target = this.galaxy.systems.find(
          (s) => s.id === conn.toSystemId,
        );
        if (!target || !target.explored) continue;
        warpLines.push({
          x1: sx,
          y1: sy,
          x2: target.coordinates.q * scale,
          y2: target.coordinates.r * scale,
        });
      }
    }

    const visitedSystemIds = this.gameEngine?.player?.visitedSystems ?? [];
    const overmindSystems = new Set(this.galaxy.overmindSystems ?? []);
    const pirateSystems = new Set(this.galaxy.pirateSystems ?? []);
    const chartedSystemIds = this.galaxy.systems
      .filter((s) => s.explored)
      .map((s) => s.id);
    const battleSet =
      this.gameEngine?.npc?.battleSystemIds(this.galaxy) ?? new Set<string>();

    let systemsDrawn = 0;
    const labelBounds: LabelBound[] = [];

    const sortedSystems = [...this.galaxy.systems]
      .filter((s) => s.explored)
      .sort((a, b) => {
        if (a.id === this.playerSystemId) return -1;
        if (b.id === this.playerSystemId) return 1;
        if (a.id === this.selectedSystemId) return -1;
        if (b.id === this.selectedSystemId) return 1;
        return 0;
      });

    for (const system of sortedSystems) {
      const x = system.coordinates.q * scale;
      const y = system.coordinates.r * scale;

      const isPlayer = system.id === this.playerSystemId;
      const isSelected = system.id === this.selectedSystemId;
      const isOvermind = overmindSystems.has(system.id);
      const isPirate = pirateSystems.has(system.id);
      const visibility = isPlayer
        ? "visited"
        : getSystemVisibility(
            system.id,
            visitedSystemIds,
            this.galaxy.systems,
            chartedSystemIds,
          );
      const isVisited = visibility === "visited";

      let color: number;
      let radius: number;

      if (isPlayer) {
        color = 0x00ff00;
        radius = 7;
      } else if (isOvermind) {
        color = isSelected ? 0xff6600 : 0xff2222;
        radius = isSelected ? 5 : 4;
      } else if (isPirate) {
        color = isSelected ? 0xffcc00 : 0xff8800;
        radius = isSelected ? 5 : 4;
      } else if (isSelected) {
        color = 0xffff00;
        radius = 5;
      } else if (visibility === "neighbor" || visibility === "charted") {
        color = 0x334455;
        radius = 3;
      } else if (!isVisited) {
        color = 0x223344;
        radius = 2;
      } else {
        color = 0x00ffff;
        radius = 4;
      }

      graphics.circle(x, y, radius);
      graphics.fill({ color });

      if (battleSet.has(system.id)) {
        const battleR = Math.max(radius, 5) + 1;
        graphics.moveTo(x, y);
        graphics.arc(x, y, battleR, Math.PI / 2, (3 * Math.PI) / 2);
        graphics.closePath();
        graphics.fill({ color: 0xff2222 });
        graphics.moveTo(x, y);
        graphics.arc(x, y, battleR, -Math.PI / 2, Math.PI / 2);
        graphics.closePath();
        graphics.fill({ color: 0x22ff44 });
        graphics.circle(x, y, battleR);
        graphics.stroke({ width: 1, color: 0xffffff });
      }
      systemsDrawn++;

      this.mapContainer.addChild(this.createSystemHitArea(x, y, system));

      if (visibility === "unknown" && !isPlayer && !isOvermind && !isPirate) {
        const qLabel = new Text({
          text: "?",
          style: {
            fontFamily: "Courier New",
            fontSize: 10,
            fill: 0x88aacc,
          },
        });
        qLabel.x = x + 6;
        qLabel.y = y - 6;
        qLabel.eventMode = "none";
        this.mapContainer.addChild(qLabel);
        continue;
      }

      const labelW = system.name.length * 6;
      const labelH = 12;
      const offset = 12;

      const candidatePositions = [
        { x: x + offset, y: y - labelH / 2 }, // Right
        { x: x - offset - labelW, y: y - labelH / 2 }, // Left
        { x: x - labelW / 2, y: y - offset - labelH }, // Above
        { x: x - labelW / 2, y: y + offset }, // Below
      ];

      const otherStars = starPositions.filter(
        (s) => !(Math.abs(s.x - x) < 1 && Math.abs(s.y - y) < 1),
      );
      const otherLines = warpLines.filter(
        (line) =>
          !(Math.abs(line.x1 - x) < 1 && Math.abs(line.y1 - y) < 1) &&
          !(Math.abs(line.x2 - x) < 1 && Math.abs(line.y2 - y) < 1),
      );

      const bestPos = pickLabelPosition(
        candidatePositions,
        labelBounds,
        otherStars,
        otherLines,
        labelW,
        labelH,
      );

      labelBounds.push({ x: bestPos.x, y: bestPos.y, w: labelW, h: labelH });

      const labelFill = isOvermind
        ? 0xff6666
        : isPirate
          ? 0xffaa66
          : system.id === this.playerSystemId
            ? 0x00ff00
            : visibility === "neighbor" || visibility === "charted"
              ? 0x88aacc
              : 0x88ccff;

      const label = new Text({
        text: system.name,
        style: {
          fontFamily: "Courier New",
          fontSize: 10,
          fill: labelFill,
        },
      });
      label.x = bestPos.x;
      label.y = bestPos.y;
      label.eventMode = "none";
      this.mapContainer.addChild(label);
    }

    this.mapContainer.addChild(graphics);
    this.renderer.gameLayer.addChild(this.mapContainer);
    logger.info(
      `Star map rendered: ${systemsDrawn} systems, player at ${this.playerSystemId}`,
    );
  }

  handleSystemClickById(systemId: string): void {
    const system = this.galaxy?.systems.find((s) => s.id === systemId);
    if (system) {
      this.handleSystemClick(system);
    }
  }

  async performWarpJumpTo(systemId: string): Promise<void> {
    const system = this.galaxy?.systems.find((s) => s.id === systemId);
    if (system && this.playerSystemId) {
      const playerSystem = this.galaxy?.systems.find(
        (s) => s.id === this.playerSystemId,
      );
      if (playerSystem) {
        const hasPathFromPlayer = playerSystem.connections.some(
          (c) => c.toSystemId === system.id,
        );
        const hasPathToPlayer = system.connections.some(
          (c) => c.toSystemId === this.playerSystemId,
        );
        const isConnected = hasPathFromPlayer || hasPathToPlayer;
        const fuelCost = this.calculateFuelCost(
          playerSystem,
          system,
          isConnected,
        );
        await this.performWarpJump(system, fuelCost);
      }
    }
  }

  private createSystemHitArea(
    x: number,
    y: number,
    system: StarSystem,
  ): Graphics {
    const hitArea = new Graphics();
    hitArea.circle(x, y, 12);
    hitArea.fill({ color: 0xffffff, alpha: 0.001 });
    hitArea.eventMode = "static";
    hitArea.cursor = "pointer";

    hitArea.on("pointertap", () => {
      if (this.hasDragged) return;

      const now = Date.now();
      const isDouble =
        this.lastTapSystemId === system.id &&
        now - this.lastTapAt < this.DOUBLE_CLICK_MS;
      if (isDouble) {
        this.lastTapSystemId = null;
        this.lastTapAt = 0;
        logger.debug(`System double-clicked: ${system.name}`);
        this.handleSystemDoubleClick(system);
      } else {
        this.lastTapSystemId = system.id;
        this.lastTapAt = now;
        logger.debug(`System clicked: ${system.name}`);
        this.handleSystemClick(system);
      }
    });

    return hitArea;
  }

  private handleSystemClick(system: StarSystem): void {
    if (!system.explored && system.id !== this.playerSystemId) return;
    logger.info(`System clicked: ${system.name}`);
    this.selectedSystemId = system.id;
    this.renderStarMap();
    this.showSystemInfo(system);
  }

  private handleSystemDoubleClick(system: StarSystem): void {
    if (!system.explored && system.id !== this.playerSystemId) return;
    if (system.id === this.playerSystemId) {
      this.enterCurrentSystem();
      return;
    }
    const playerSystem = this.galaxy?.systems.find(
      (s) => s.id === this.playerSystemId,
    );
    if (!playerSystem || !this.gameEngine?.player) return;
    const isConnected =
      playerSystem.connections.some((c) => c.toSystemId === system.id) ||
      system.connections.some((c) => c.toSystemId === this.playerSystemId);
    const fuelCost = this.calculateFuelCost(playerSystem, system, isConnected);
    if (this.gameEngine.player.ship.energy >= fuelCost) {
      this.performWarpJump(system, fuelCost);
    } else {
      this.showMessage("Недостаточно топлива");
    }
  }

  private showMessage(message: string): void {
    const msg = new Text({
      text: message,
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0xff4444 },
    });
    msg.anchor.set(0.5);
    msg.x = this.renderer.app.screen.width / 2;
    msg.y = this.renderer.app.screen.height / 2 + 120;
    this.renderer.uiLayer.addChild(msg);
    const handle = setTimeout(() => {
      if (!msg.destroyed) {
        this.renderer.uiLayer.removeChild(msg);
        msg.destroy();
      }
      this.messageTimers = this.messageTimers.filter((t) => t !== handle);
    }, 2000);
    this.messageTimers.push(handle);
  }

  private showSystemInfo(system: StarSystem): void {
    if (this.infoPanel) {
      if (this.infoPanel.parent) {
        this.renderer.uiLayer.removeChild(this.infoPanel);
      }
      this.infoPanel.destroy(true);
      this.infoPanel = null;
    }

    const width = this.renderer.app.screen.width;
    this.infoPanel = new Container();
    this.infoPanel.x = width - 220;
    this.infoPanel.y = 60;

    const basePanelHeight = 180;
    const planetListHeight = system.planets.length * 18; // 18px per planet
    const totalPanelHeight = basePanelHeight + planetListHeight;

    const bg = new Graphics();
    bg.fill({ color: 0x000000, alpha: 0.95 });
    bg.rect(0, 0, 200, totalPanelHeight);
    bg.stroke({ width: 2, color: 0x00ffff });
    this.infoPanel.addChild(bg);

    const nameText = new Text({
      text: system.name,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0x00ffff,
        fontWeight: "bold",
      },
    });
    nameText.x = 10;
    nameText.y = 10;
    this.infoPanel.addChild(nameText);

    const factionText = new Text({
      text: `Владелец: ${FACTION_LABEL[system.ownerFaction] ?? system.ownerFaction}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    factionText.x = 10;
    factionText.y = 35;
    this.infoPanel.addChild(factionText);

    const planetsText = new Text({
      text: `Планеты (${system.planets.length}):`,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xaaaaaa,
        fontWeight: "bold",
      },
    });
    planetsText.x = 10;
    planetsText.y = 55;
    this.infoPanel.addChild(planetsText);

    let planetYOffset = 75;
    for (const planet of system.planets) {
      const planetType = this.getPlanetTypeRussian(planet.type);
      const planetItem = new Text({
        text: `• ${planet.name}`,
        style: {
          fontFamily: "Courier New",
          fontSize: 10,
          fill: 0x88ccff,
        },
      });
      planetItem.x = 15;
      planetItem.y = planetYOffset;
      this.infoPanel.addChild(planetItem);

      const typeLabel = new Text({
        text: planetType,
        style: {
          fontFamily: "Courier New",
          fontSize: 9,
          fill: 0x889999,
        },
      });
      typeLabel.x = 25;
      typeLabel.y = planetYOffset + 11;
      this.infoPanel.addChild(typeLabel);

      planetYOffset += 18;
    }

    const neighborNames = system.connections
      .map((c) => this.galaxy?.systems.find((s) => s.id === c.toSystemId)?.name)
      .filter(Boolean)
      .join(", ");
    const connectionsText = new Text({
      text: neighborNames
        ? `Соседи (можно прыгнуть): ${neighborNames}`
        : "Соседи: нет",
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xaaaaaa,
      },
    });
    connectionsText.x = 10;
    connectionsText.y = planetYOffset + 5;
    this.infoPanel.addChild(connectionsText);

    const interactiveYStart = planetYOffset + 30;

    if (system.id === this.playerSystemId) {
      const hereText = new Text({
        text: "(Здесь)",
        style: {
          fontFamily: "Courier New",
          fontSize: 11,
          fill: 0x00ff00,
          fontWeight: "bold",
        },
      });
      hereText.x = 10;
      hereText.y = interactiveYStart;
      this.infoPanel.addChild(hereText);

      const enterBtn = new Text({
        text: "[Войти в систему]",
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: 0x00ffff,
          fontWeight: "bold",
        },
      });
      enterBtn.x = 10;
      enterBtn.y = interactiveYStart + 20;
      enterBtn.eventMode = "static";
      enterBtn.cursor = "pointer";
      enterBtn.on("pointerdown", async (event) => {
        event.stopPropagation();
        logger.info("Entering current system");
        await this.enterCurrentSystem();
      });
      enterBtn.on("pointerover", () => {
        enterBtn.alpha = 0.7;
      });
      enterBtn.on("pointerout", () => {
        enterBtn.alpha = 1.0;
      });
      this.infoPanel.addChild(enterBtn);
    }

    if (system.id !== this.playerSystemId && this.playerSystemId) {
      const playerSystem = this.galaxy?.systems.find(
        (s) => s.id === this.playerSystemId,
      );
      if (!playerSystem) return;
      const hasPathFromPlayer = playerSystem.connections.some(
        (c) => c.toSystemId === system.id,
      );
      const hasPathToPlayer = system.connections.some(
        (c) => c.toSystemId === this.playerSystemId,
      );
      const isConnected = hasPathFromPlayer || hasPathToPlayer;

      const fuelCost = this.calculateFuelCost(
        playerSystem,
        system,
        isConnected,
      );
      const currentFuel = this.gameEngine?.player?.ship.energy ?? 0;
      const hasEnoughFuel = currentFuel >= fuelCost;

      const fuelText = new Text({
        text: `Топливо: ${fuelCost} (есть: ${Math.floor(currentFuel)})`,
        style: {
          fontFamily: "Courier New",
          fontSize: 10,
          fill: hasEnoughFuel ? 0x88ff88 : 0xff8888,
        },
      });
      fuelText.x = 10;
      fuelText.y = interactiveYStart;
      this.infoPanel.addChild(fuelText);

      if (hasEnoughFuel) {
        const warpBtn = new Text({
          text: isConnected ? "[ПРЫЖОК]" : "[ГИПЕР-ПРЫЖОК]",
          style: {
            fontFamily: "Courier New",
            fontSize: 12,
            fill: isConnected ? 0x00ff00 : 0xffaa00,
            fontWeight: "bold",
          },
        });
        warpBtn.x = 10;
        warpBtn.y = interactiveYStart + 25;
        warpBtn.eventMode = "static";
        warpBtn.cursor = "pointer";
        warpBtn.on("pointerdown", () => {
          logger.info(
            `Warp confirmation for: ${system.name}, fuel cost: ${fuelCost}`,
          );
          this.showWarpConfirmation(system, fuelCost, isConnected);
        });

        warpBtn.on("pointerover", () => {
          warpBtn.alpha = 0.7;
        });
        warpBtn.on("pointerout", () => {
          warpBtn.alpha = 1;
        });

        this.infoPanel.addChild(warpBtn);
      } else {
        const noFuelText = new Text({
          text: "Недостаточно топлива",
          style: {
            fontFamily: "Courier New",
            fontSize: 11,
            fill: 0xff4444,
          },
        });
        noFuelText.x = 10;
        noFuelText.y = interactiveYStart + 25;
        this.infoPanel.addChild(noFuelText);
      }
    }

    this.renderer.uiLayer.addChild(this.infoPanel);
  }

  private calculateFuelCost(
    from: StarSystem,
    to: StarSystem,
    isConnected: boolean,
  ): number {
    const dx = to.coordinates.q - from.coordinates.q;
    const dy = to.coordinates.r - from.coordinates.r;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (isConnected) {
      return 5;
    } else {
      return Math.max(10, Math.ceil(distance * 2));
    }
  }

  private showWarpConfirmation(
    system: StarSystem,
    fuelCost: number,
    isConnected: boolean,
  ): void {
    this.closeConfirmDialog();

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    this.renderer.gameLayer.filters = [new BlurFilter({ strength: 4 })];

    this.confirmDialog = new Container();

    const overlay = new Graphics();
    overlay.fill({ color: 0x000510, alpha: 0.85 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    this.confirmDialog.addChild(overlay);

    const dialogWidth = 320;
    const dialogHeight = 160;
    const dialogX = (width - dialogWidth) / 2;
    const dialogY = (height - dialogHeight) / 2;

    const dialogBg = new Graphics();
    dialogBg.fill({ color: 0x001122 });
    dialogBg.rect(dialogX, dialogY, dialogWidth, dialogHeight);
    dialogBg.stroke({ width: 2, color: isConnected ? 0x00ffff : 0xffaa00 });
    this.confirmDialog.addChild(dialogBg);

    const jumpType = isConnected ? "Прыжок" : "Гипер-прыжок";
    const confirmText = new Text({
      text: `${jumpType} в систему ${system.name}?`,
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: isConnected ? 0x00ffff : 0xffaa00,
        align: "center",
      },
    });
    confirmText.anchor.set(0.5, 0);
    confirmText.x = width / 2;
    confirmText.y = dialogY + 20;
    this.confirmDialog.addChild(confirmText);

    const fuelText = new Text({
      text: `Расход топлива: ${fuelCost}`,
      style: {
        fontFamily: "Courier New",
        fontSize: 13,
        fill: 0x88ff88,
        align: "center",
      },
    });
    fuelText.anchor.set(0.5, 0);
    fuelText.x = width / 2;
    fuelText.y = dialogY + 50;
    this.confirmDialog.addChild(fuelText);

    const yesBtn = new Text({
      text: "Да",
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0x00ff00,
        fontWeight: "bold",
      },
    });
    yesBtn.anchor.set(0.5);
    yesBtn.x = width / 2 - 60;
    yesBtn.y = dialogY + dialogHeight - 40;
    yesBtn.eventMode = "static";
    yesBtn.cursor = "pointer";
    yesBtn.on("pointerdown", () => {
      this.performWarpJump(system, fuelCost);
    });
    yesBtn.on("pointerover", () => {
      yesBtn.alpha = 0.7;
    });
    yesBtn.on("pointerout", () => {
      yesBtn.alpha = 1;
    });
    this.confirmDialog.addChild(yesBtn);

    const noBtn = new Text({
      text: "Нет",
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0xff4444,
        fontWeight: "bold",
      },
    });
    noBtn.anchor.set(0.5);
    noBtn.x = width / 2 + 60;
    noBtn.y = dialogY + dialogHeight - 40;
    noBtn.eventMode = "static";
    noBtn.cursor = "pointer";
    noBtn.on("pointerdown", () => {
      this.closeConfirmDialog();
    });
    noBtn.on("pointerover", () => {
      noBtn.alpha = 0.7;
    });
    noBtn.on("pointerout", () => {
      noBtn.alpha = 1;
    });
    this.confirmDialog.addChild(noBtn);

    this.renderer.uiLayer.addChild(this.confirmDialog);
  }

  private closeConfirmDialog(): void {
    if (this.confirmDialog) {
      this.renderer.gameLayer.filters = [];

      if (this.confirmDialog.parent) {
        this.renderer.uiLayer.removeChild(this.confirmDialog);
      }
      this.confirmDialog.destroy({ children: true });
      this.confirmDialog = null;
    }
  }

  private async enterCurrentSystem(): Promise<void> {
    if (!this.gameEngine?.player) {
      logger.warn("Cannot enter system: no player or game engine");
      return;
    }
    logger.info("Entering current system");
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      entryVector: { x: 0, y: 1 },
    });
  }

  private async performWarpJump(
    target: StarSystem,
    fuelCost: number,
  ): Promise<void> {
    this.closeConfirmDialog();

    if (!this.gameEngine?.player) {
      logger.warn("Cannot warp: no player or game engine");
      return;
    }

    if (isDowned(this.gameEngine.player)) {
      this.showMessage("Корабль повреждён — нужен ремонт");
      return;
    }

    if (this.gameEngine.player.ship.energy < fuelCost) {
      this.showMessage("Недостаточно топлива");
      return;
    }

    const fromSystem = this.galaxy?.systems.find(
      (s) => s.id === this.playerSystemId,
    );
    const dx = target.coordinates.q - (fromSystem?.coordinates.q ?? 0);
    const dy = target.coordinates.r - (fromSystem?.coordinates.r ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const exitVector = { x: dx / dist, y: dy / dist };

    this.selectedSystemId = null;

    logger.info(
      `Warp initiated to ${target.name}; ship will jump from the system edge`,
    );
    this.gameEngine.showLoadingOverlay("Прыжок...");
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      pendingWarp: { targetSystemId: target.id, fuelCost, exitVector },
    });
  }

  private getPlanetTypeRussian(type: string): string {
    const translations: Record<string, string> = {
      TERRESTRIAL: "Земной",
      GAS_GIANT: "Газовый гигант",
      ICE: "Ледяной",
      VOLCANIC: "Вулканический",
      INDUSTRIAL: "Промышленный",
      HABITAT: "Обитаемый",
    };
    return translations[type] ?? type;
  }

  e2eSelectSystem(index: number): void {
    const system = this.galaxy?.systems[index];
    if (system) {
      this.handleSystemClick(system);
    }
  }

  e2eGetViewport(): {
    zoomLevel: number;
    viewportX: number;
    viewportY: number;
  } {
    return {
      zoomLevel: this.zoomLevel,
      viewportX: this.viewportX,
      viewportY: this.viewportY,
    };
  }
}
