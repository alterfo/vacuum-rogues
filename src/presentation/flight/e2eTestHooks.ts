import type { Container } from "pixi.js";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import type { GameEngine } from "@/systems/GameEngine";
import type { CameraController } from "./CameraController";
import type { FlightHud } from "./FlightHud";
import type { PlanetManager } from "./PlanetManager";
import type { NpcShipManager } from "./NpcShipManager";
import type { SpaceBackgroundLayer } from "../SpaceBackgroundLayer";
import { SceneType } from "@/types";

export interface E2ETestHooksDeps {
  returnToStarMap(): Promise<void>;
  onPlayPause(): void;
  getIsTurnRunning(): boolean;
  getShipPhysics(): ShipPhysics | null;
  getCamera(): CameraController;
  getHud(): FlightHud;
  getPlanetManager(): PlanetManager;
  getNpcManager(): NpcShipManager;
  getGameEngine(): GameEngine | null;
  getGameLayer(): Container;
  getSkyContainer(): Container | null;
  getBackground(): SpaceBackgroundLayer | null;
}

export class E2ETestHooks {
  constructor(private readonly deps: E2ETestHooksDeps) {}

  async clickBackToMap(): Promise<void> {
    if (!__DEBUG__) return;
    await this.deps.returnToStarMap();
  }

  setTarget(x: number, y: number): void {
    if (!__DEBUG__) return;
    this.deps.getShipPhysics()?.setTarget(x, y);
  }

  getCameraState(): { zoom: number; panX: number; panY: number } {
    if (!__DEBUG__) return { zoom: 1, panX: 0, panY: 0 };
    const camera = this.deps.getCamera();
    return { zoom: camera.zoom, panX: camera.panX, panY: camera.panY };
  }

  setCameraZoom(zoom: number): void {
    if (!__DEBUG__) return;
    this.deps.getCamera().setZoom(zoom);
  }

  setCameraPan(x: number, y: number): void {
    if (!__DEBUG__) return;
    this.deps.getCamera().setPan(x, y);
  }

  hasMinimap(): boolean {
    if (!__DEBUG__) return false;
    return this.deps.getHud().miniMap !== null;
  }

  getShipPosition(): { x: number; y: number } {
    if (!__DEBUG__) return { x: 0, y: 0 };
    const physics = this.deps.getShipPhysics();
    return { x: physics?.shipX ?? 0, y: physics?.shipY ?? 0 };
  }

  isQuestJournalOpen(): boolean {
    if (!__DEBUG__) return false;
    return this.deps.getHud().isQuestJournalVisible();
  }

  getPlanets(): { id: string; name: string }[] {
    if (!__DEBUG__) return [];
    return this.deps.getPlanetManager().planetSprites.map((ps) => ({
      id: ps.planet.id,
      name: ps.planet.name,
    }));
  }

  async landOnPlanet(): Promise<void> {
    if (!__DEBUG__) return;
    const planet = this.deps.getPlanetManager().planetSprites[0]?.planet;
    const gameEngine = this.deps.getGameEngine();
    if (!planet || !gameEngine) return;
    await gameEngine.transitionTo(SceneType.PLANET, { gameEngine, planet });
  }

  getNpcCount(): number {
    if (!__DEBUG__) return 0;
    return this.deps.getNpcManager().npcCount;
  }

  hasFilterPlanet(): boolean {
    if (!__DEBUG__) return false;
    return this.deps.getPlanetManager().e2eHasFilterPlanet();
  }

  isolateFilterPlanet(): {
    screenX: number;
    screenY: number;
    displayRadius: number;
  } | null {
    if (!__DEBUG__) return null;
    for (const child of this.deps.getGameLayer().children) {
      child.visible = false;
    }
    return this.deps.getPlanetManager().e2eIsolateFilterPlanet();
  }

  playPause(): void {
    if (!__DEBUG__) return;
    this.deps.onPlayPause();
  }

  setBackgroundVisible(visible: boolean): void {
    if (!__DEBUG__) return;
    const sky = this.deps.getSkyContainer();
    if (sky) sky.visible = visible;
    this.deps.getBackground()?.setVisible(visible);
  }

  getSceneState(): {
    planetsCount: number;
    npcsCount: number;
    isFlying: boolean;
    turnNumber: number;
  } {
    if (!__DEBUG__) {
      return { planetsCount: 0, npcsCount: 0, isFlying: false, turnNumber: 0 };
    }
    return {
      planetsCount: this.deps.getPlanetManager()?.planetSprites.length ?? 0,
      npcsCount: this.deps.getNpcManager()?.npcCount ?? 0,
      isFlying: this.deps.getShipPhysics()?.isMoving ?? false,
      turnNumber: this.deps.getGameEngine()?.galaxy?.gameDays ?? 0,
    };
  }

  clickPlanet(index: number): void {
    if (!__DEBUG__) return;
    const sprite = this.deps.getPlanetManager()?.planetSprites[index];
    if (sprite) this.deps.getPlanetManager().handlePlanetClick(sprite.planet);
  }

  clickNpc(index: number): void {
    if (!__DEBUG__) return;
    this.deps.getNpcManager()?.e2eClickNpc(index);
  }

  pressPause(): void {
    if (!__DEBUG__) return;
    if (this.deps.getIsTurnRunning()) this.deps.onPlayPause();
  }

  startTurn(): void {
    if (!__DEBUG__) return;
    if (!this.deps.getIsTurnRunning()) this.deps.onPlayPause();
  }
}
