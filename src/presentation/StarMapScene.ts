import { GameScene } from "./GameScene";
import { Graphics, Text, Container, BlurFilter } from "pixi.js";
import type { Galaxy } from "@/domain/Galaxy";
import type { StarSystem } from "@/domain/StarSystem";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";

export interface StarMapContext {
  galaxy?: Galaxy;
  gameEngine?: GameEngine;
}

export class StarMapScene extends GameScene {
  private galaxy?: Galaxy;
  private selectedSystemId: string | null = null;
  private playerSystemId: string | null = null;
  private infoPanel: Container | null = null;
  private confirmDialog: Container | null = null;
  private fixedUIContainer: Container | null = null;
  private gameEngine: GameEngine | null = null;

  // Viewport state for zoom/pan
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
  private boundHandleWheel: ((e: WheelEvent) => void) | null = null;
  private boundMouseDown: ((e: MouseEvent) => void) | null = null;
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;
  private boundMouseUp: ((e: MouseEvent) => void) | null = null;

  initialize(context?: object): void {
    // Ensure PixiJS events are active (previous scene may have disabled them)
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
        // Fresh game: fallback to first system
        this.playerSystemId = this.galaxy.systems[0].id;
      }
      // Reveal starting system and its neighbors (AC3)
      this.galaxy.revealSystemAndNeighbors(this.playerSystemId);
    }

    // Clear layers first, then render
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Setup zoom/pan handlers
    this.setupViewportControls();

    // Render the star map
    this.renderStarMap();

    logger.info("StarMapScene initialized");
  }

  private setupViewportControls(): void {
    const canvas = this.renderer.app.canvas;

    // Mouse wheel zoom
    this.boundHandleWheel = this.handleWheel.bind(this);
    canvas.addEventListener("wheel", this.boundHandleWheel, { passive: false });

    // Mouse drag for pan (using DOM events for reliability)
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    canvas.addEventListener("mousedown", this.boundMouseDown);
    canvas.addEventListener("mousemove", this.boundMouseMove);
    canvas.addEventListener("mouseup", this.boundMouseUp);
    canvas.addEventListener("mouseleave", this.boundMouseUp);
  }

  private handleMouseDown(e: MouseEvent): void {
    // Right or middle mouse button for pan
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
    // Left button - only pan if not on a system
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

    // Threshold to distinguish click from drag
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
    // Don't reset hasDragged here - let click handlers check it
    setTimeout(() => {
      this.hasDragged = false;
    }, 10);
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    this.zoomLevel = Math.max(0.5, Math.min(3, this.zoomLevel * zoomDelta));
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

  update(_deltaTime: number): void {
    // Star map animations could go here
  }

  destroy(): void {
    this.closeConfirmDialog();
    const canvas = this.renderer.app.canvas;
    // Remove DOM event listeners
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
    // Clean up map container
    if (this.mapContainer) {
      this.mapContainer.destroy({ children: true });
      this.mapContainer = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.infoPanel = null;
    this.fixedUIContainer = null;
    this.gameEngine = null;
  }

  private renderStarMap(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Draw background (lowest layer)
    const background = new Graphics();
    background.fill({ color: 0x000510 });
    background.rect(0, 0, width, height);
    this.renderer.gameLayer.addChildAt(background, 0);

    // Clear and recreate fixed UI container
    if (this.fixedUIContainer) {
      if (this.fixedUIContainer.parent) {
        this.renderer.uiLayer.removeChild(this.fixedUIContainer);
      }
      this.fixedUIContainer.destroy({ children: true });
    }
    this.fixedUIContainer = new Container();

    // Fixed UI elements
    const title = new Text({
      text: "SECTOR MAP",
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

    // Fuel indicator
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

    const instructions = new Text({
      text: "Колесо мыши — зум | Перетаскивание — пан | 2x Клик — вход в систему",
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0x888888,
      },
    });
    instructions.x = 20;
    instructions.y = height - 30;
    this.fixedUIContainer.addChild(instructions);

    this.renderer.uiLayer.addChild(this.fixedUIContainer);

    if (!this.galaxy) {
      logger.warn("No galaxy available for rendering");
      return;
    }

    // Create map container for zoom/pan
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
    const scale = 4;

    // Draw warp lanes (only between explored systems)
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

    // Collect star positions and warp lines for label collision detection
    const starPositions: { x: number; y: number; r: number }[] = [];
    const warpLines: { x1: number; y1: number; x2: number; y2: number }[] = [];

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

    // Helper: check if rectangle intersects a line segment
    const rectIntersectsLine = (
      rx: number,
      ry: number,
      rw: number,
      rh: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ): boolean => {
      // Check if line segment intersects rectangle
      const left = rx,
        right = rx + rw,
        top = ry,
        bottom = ry + rh;

      // If both endpoints are on same side of rect, no intersection
      if ((x1 < left && x2 < left) || (x1 > right && x2 > right)) return false;
      if ((y1 < top && y2 < top) || (y1 > bottom && y2 > bottom)) return false;

      // Check if line passes through rectangle
      const dx = x2 - x1,
        dy = y2 - y1;
      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return false;

      // Parametric line intersection with rect edges
      const tLeft = dx !== 0 ? (left - x1) / dx : -Infinity;
      const tRight = dx !== 0 ? (right - x1) / dx : Infinity;
      const tTop = dy !== 0 ? (top - y1) / dy : -Infinity;
      const tBottom = dy !== 0 ? (bottom - y1) / dy : Infinity;

      const tMin = Math.max(
        Math.min(tLeft, tRight),
        Math.min(tTop, tBottom),
        0,
      );
      const tMax = Math.min(
        Math.max(tLeft, tRight),
        Math.max(tTop, tBottom),
        1,
      );

      return tMin <= tMax;
    };

    // Helper: check if rectangle overlaps a circle
    const rectOverlapsCircle = (
      rx: number,
      ry: number,
      rw: number,
      rh: number,
      cx: number,
      cy: number,
      cr: number,
    ): boolean => {
      const nearestX = Math.max(rx, Math.min(cx, rx + rw));
      const nearestY = Math.max(ry, Math.min(cy, ry + rh));
      const dx = cx - nearestX,
        dy = cy - nearestY;
      return dx * dx + dy * dy < cr * cr;
    };

    // Draw only explored systems
    let systemsDrawn = 0;
    const labelBounds: { x: number; y: number; w: number; h: number }[] = [];

    // Sort systems: current first, then selected, then others (for label priority)
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

      let color = 0x00ffff;
      let radius = 4;

      if (system.id === this.playerSystemId) {
        color = 0x00ff00;
        radius = 7;
      } else if (system.id === this.selectedSystemId) {
        color = 0xffff00;
        radius = 5;
      }

      // Draw system circle
      graphics.circle(x, y, radius);
      graphics.fill({ color });
      systemsDrawn++;

      // Add clickable hit area with double-click support
      const hitArea = new Graphics();
      hitArea.circle(x, y, 12);
      hitArea.fill({ color: 0xffffff, alpha: 0.001 });
      hitArea.eventMode = "static";
      hitArea.cursor = "pointer";

      // Double-click detection: track last click time
      let lastClickTime = 0;
      const doubleClickDelay = 300; // ms

      hitArea.on("pointerdown", () => {
        if (this.hasDragged) return;

        const now = Date.now();
        const timeSinceLastClick = now - lastClickTime;

        if (timeSinceLastClick < doubleClickDelay) {
          // Double-click detected
          logger.debug(`System double-clicked: ${system.name}`);
          this.handleSystemDoubleClick(system);
          lastClickTime = 0; // Reset to prevent triple-click from triggering
        } else {
          // Single click
          logger.debug(`System clicked: ${system.name}`);
          this.handleSystemClick(system);
          lastClickTime = now;
        }
      });

      this.mapContainer.addChild(hitArea);

      // Smart label placement: try right, left, above, below
      const labelW = system.name.length * 6;
      const labelH = 12;
      const offset = 12; // Distance from star center

      const positions = [
        { x: x + offset, y: y - labelH / 2 }, // Right
        { x: x - offset - labelW, y: y - labelH / 2 }, // Left
        { x: x - labelW / 2, y: y - offset - labelH }, // Above
        { x: x - labelW / 2, y: y + offset }, // Below
      ];

      let bestPos: { x: number; y: number } | null = null;

      for (const pos of positions) {
        const lx = pos.x,
          ly = pos.y;

        // Check overlap with other labels
        const overlapsLabel = labelBounds.some(
          (b) =>
            lx < b.x + b.w &&
            lx + labelW > b.x &&
            ly < b.y + b.h &&
            ly + labelH > b.y,
        );
        if (overlapsLabel) continue;

        // Check overlap with stars (except current one)
        const overlapsStar = starPositions.some(
          (s) =>
            !(Math.abs(s.x - x) < 1 && Math.abs(s.y - y) < 1) &&
            rectOverlapsCircle(lx, ly, labelW, labelH, s.x, s.y, s.r),
        );
        if (overlapsStar) continue;

        // Check intersection with warp lines (skip lines from/to this star)
        const intersectsLine = warpLines.some((line) => {
          const isFromThisStar =
            Math.abs(line.x1 - x) < 1 && Math.abs(line.y1 - y) < 1;
          const isToThisStar =
            Math.abs(line.x2 - x) < 1 && Math.abs(line.y2 - y) < 1;
          if (isFromThisStar || isToThisStar) return false;
          return rectIntersectsLine(
            lx,
            ly,
            labelW,
            labelH,
            line.x1,
            line.y1,
            line.x2,
            line.y2,
          );
        });
        if (intersectsLine) continue;

        bestPos = pos;
        break;
      }

      if (bestPos) {
        labelBounds.push({ x: bestPos.x, y: bestPos.y, w: labelW, h: labelH });

        const label = new Text({
          text: system.name,
          style: {
            fontFamily: "Courier New",
            fontSize: 10,
            fill: system.id === this.playerSystemId ? 0x00ff00 : 0x88ccff,
          },
        });
        label.x = bestPos.x;
        label.y = bestPos.y;
        label.eventMode = "none";
        this.mapContainer.addChild(label);
      }
    }

    this.mapContainer.addChild(graphics);
    this.renderer.gameLayer.addChild(this.mapContainer);
    logger.info(
      `Star map rendered: ${systemsDrawn} systems, player at ${this.playerSystemId}`,
    );
  }

  /**
   * E2E helper: trigger system click by ID
   */
  handleSystemClickById(systemId: string): void {
    const system = this.galaxy?.systems.find((s) => s.id === systemId);
    if (system) {
      this.handleSystemClick(system);
    }
  }

  /**
   * E2E helper: perform warp jump to system by ID
   */
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
    setTimeout(() => {
      this.renderer.uiLayer.removeChild(msg);
      msg.destroy();
    }, 2000);
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

    // Calculate dynamic panel height based on number of planets
    const basePanelHeight = 180;
    const planetListHeight = system.planets.length * 18; // 18px per planet
    const totalPanelHeight = basePanelHeight + planetListHeight;

    const bg = new Graphics();
    bg.fill({ color: 0x000000, alpha: 0.8 });
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
      text: `Владелец: ${system.ownerFaction}`,
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

    // List of planets with types
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
          fill: 0x666666,
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

    // Base Y position for interactive elements (after planet list)
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

      // Add "Enter System" button for current system
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
      enterBtn.on("pointerdown", async () => {
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
      // Check bidirectional: player→target OR target→player
      const hasPathFromPlayer = playerSystem?.connections.some(
        (c) => c.toSystemId === system.id,
      );
      const hasPathToPlayer = system.connections.some(
        (c) => c.toSystemId === this.playerSystemId,
      );
      const isConnected = hasPathFromPlayer || hasPathToPlayer;

      // Calculate distance and fuel cost
      const fuelCost = this.calculateFuelCost(
        playerSystem!,
        system,
        isConnected,
      );
      const currentFuel = this.gameEngine?.player?.ship.energy ?? 0;
      const hasEnoughFuel = currentFuel >= fuelCost;

      // Show fuel cost
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

        // Add hover effect
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
      // Connected systems: base cost of 5 fuel
      return 5;
    } else {
      // Non-connected: 2 fuel per unit of distance, minimum 10
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

    // Apply blur to game layer
    this.renderer.gameLayer.filters = [new BlurFilter({ strength: 4 })];

    this.confirmDialog = new Container();

    // Dark overlay to block background clicks
    const overlay = new Graphics();
    overlay.fill({ color: 0x000510, alpha: 0.85 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    this.confirmDialog.addChild(overlay);

    // Dialog box
    const dialogWidth = 320;
    const dialogHeight = 160;
    const dialogX = (width - dialogWidth) / 2;
    const dialogY = (height - dialogHeight) / 2;

    const dialogBg = new Graphics();
    dialogBg.fill({ color: 0x001122 });
    dialogBg.rect(dialogX, dialogY, dialogWidth, dialogHeight);
    dialogBg.stroke({ width: 2, color: isConnected ? 0x00ffff : 0xffaa00 });
    this.confirmDialog.addChild(dialogBg);

    // Jump type text
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

    // Fuel cost text
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

    // "Да" button
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

    // "Нет" button
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
      // Remove blur from game layer
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

    const fromSystem = this.galaxy?.systems.find(
      (s) => s.id === this.playerSystemId,
    );
    const dx = target.coordinates.q - (fromSystem?.coordinates.q ?? 0);
    const dy = target.coordinates.r - (fromSystem?.coordinates.r ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const entryVector = { x: dx / dist, y: dy / dist };

    this.gameEngine.player.ship.energy -= fuelCost;
    logger.info(
      `Fuel consumed: ${fuelCost}, remaining: ${this.gameEngine.player.ship.energy}`,
    );

    this.playerSystemId = target.id;
    this.selectedSystemId = null;
    this.gameEngine.player.currentSystemId = target.id;

    this.galaxy?.revealSystemAndNeighbors(target.id);

    this.gameEngine.saveGame("auto").catch((e) => {
      logger.error("Auto-save after warp jump failed:", e);
    });

    logger.info(`Warp jump completed to ${target.name}`);
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      entryVector,
    });
  }

  /**
   * Get Russian translation for planet type
   */
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
}
