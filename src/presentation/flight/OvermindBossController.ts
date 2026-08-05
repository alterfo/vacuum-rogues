import { Container, Graphics, Text } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { NpcShipManagerDeps } from "./NpcShipManager";
import { OVERMIND_CORE_ID } from "./NpcShipManager";
import { SeededRNG } from "@/utils/seededRNG";
import { scaledFont } from "@/utils/fontScale";
import { OVERMIND_BOSS_TIER } from "@/config/balance";
import type { NpcSizeTier } from "@/types";

export interface OvermindBossControllerDeps {
  uiLayer: Container;
  getScreenSize(): { width: number; height: number };
  flight: NpcShipManagerDeps;
  getGameEngine(): GameEngine | null;
  getNpcSprites(): NpcShipSprite[];
  addNpcSprite(npc: NpcShip, entry: boolean): void;
  spawnOvermindInSystem(
    rng: SeededRNG,
    id: string,
    systemId: string,
    sizeTier?: NpcSizeTier,
  ): NpcShip;
}

export class OvermindBossController {
  private overlay: Container | null = null;

  constructor(private readonly deps: OvermindBossControllerDeps) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  destroy(): void {
    if (this.overlay) {
      if (!this.overlay.destroyed) {
        this.overlay.destroy({ children: true });
      }
      this.overlay = null;
    }
  }

  close(): void {
    if (!this.overlay) return;
    const ov = this.overlay;
    this.overlay = null;
    queueMicrotask(() => {
      if (!ov.destroyed) ov.destroy({ children: true });
    });
  }

  refreshFontScale(): void {
    if (this.overlay && !this.overlay.destroyed) {
      this.overlay.destroy({ children: true });
      this.overlay = null;
      this.showOvermindCorePrompt();
    }
  }

  spawnOvermindCoreCombatant(): void {
    const gameEngine = this.deps.getGameEngine();
    if (this.deps.getNpcSprites().some((s) => s.npc.id === OVERMIND_CORE_ID))
      return;
    const systemId = gameEngine?.player?.currentSystemId ?? "";
    const rng = new SeededRNG(`overmind-core:${systemId}`);
    const core = this.deps.spawnOvermindInSystem(
      rng,
      OVERMIND_CORE_ID,
      systemId,
      "boss",
    );
    core.name = "Ядро OVERMIND";
    core.sizeTier = "boss";
    core.hullHP = OVERMIND_BOSS_TIER.hull;
    core.maxHull = OVERMIND_BOSS_TIER.hull;
    core.damage = OVERMIND_BOSS_TIER.damage;
    core.markHostile();

    const galaxy = gameEngine?.galaxy;
    if (galaxy) galaxy.npcShips.push(core);

    this.deps.addNpcSprite(core, true); // enter from the boundary and fly in
    const sprite = this.deps
      .getNpcSprites()
      .find((s) => s.npc.id === OVERMIND_CORE_ID);
    if (!sprite) return;
    sprite.setAggressive(true); // pursue the player to weapon range
    this.deps.flight.startInFlightCombat?.(sprite);
    this.deps.flight.selectCombatTarget?.(sprite);
    this.deps.flight.showMessage("Ядро OVERMIND вступает в бой!", 0xff2200);
  }

  showOvermindCorePrompt(): void {
    if (!this.deps.getGameEngine()) return;
    const { width, height } = this.deps.getScreenSize();

    const overlay = new Container();
    this.overlay = overlay;
    const bg = new Graphics();
    bg.roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6).fill({
      color: 0x000000,
      alpha: 0.85,
    });
    bg.eventMode = "static";
    bg.on("pointerdown", (e) => e.stopPropagation());

    const border = new Graphics();
    border
      .roundRect(width / 2 - 240, height / 2 - 110, 480, 220, 6)
      .stroke({ width: 2, color: 0xff2200 });

    const title = new Text({
      text: "ЯДРО OVERMIND",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(20),
        fill: 0xff2200,
        fontWeight: "bold",
      },
    });
    title.anchor.set(0.5);
    title.x = width / 2;
    title.y = height / 2 - 80;
    title.eventMode = "none";

    const desc = new Text({
      text: "Вы вошли в систему ядра OVERMIND.\nУничтожьте его, чтобы спасти галактику.",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xcccccc,
        align: "center",
      },
    });
    desc.anchor.set(0.5);
    desc.x = width / 2;
    desc.y = height / 2 - 30;
    desc.eventMode = "none";

    const attackBtn = new Container();
    const attackBg = new Graphics();
    attackBg
      .roundRect(0, 0, 180, 36, 4)
      .fill({ color: 0x330000 })
      .stroke({ width: 1, color: 0xff2200 });
    const attackLabel = new Text({
      text: "[ Атаковать ядро ]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0xff4444,
      },
    });
    attackLabel.x = 8;
    attackLabel.y = 9;
    attackLabel.eventMode = "none";
    attackBtn.addChild(attackBg, attackLabel);
    attackBtn.x = width / 2 - 200;
    attackBtn.y = height / 2 + 40;
    attackBtn.eventMode = "static";
    attackBtn.cursor = "pointer";
    attackBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.close();
      this.spawnOvermindCoreCombatant();
    });

    const retreatBtn = new Container();
    const retreatBg = new Graphics();
    retreatBg
      .roundRect(0, 0, 180, 36, 4)
      .fill({ color: 0x0d1b2a })
      .stroke({ width: 1, color: 0x4488ff });
    const retreatLabel = new Text({
      text: "[ Отступить ]",
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: 0x4488ff,
      },
    });
    retreatLabel.x = 8;
    retreatLabel.y = 9;
    retreatLabel.eventMode = "none";
    retreatBtn.addChild(retreatBg, retreatLabel);
    retreatBtn.x = width / 2 + 20;
    retreatBtn.y = height / 2 + 40;
    retreatBtn.eventMode = "static";
    retreatBtn.cursor = "pointer";
    retreatBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      this.close();
    });

    overlay.addChild(bg, border, title, desc, attackBtn, retreatBtn);
    this.deps.uiLayer.addChild(overlay);
  }
}
