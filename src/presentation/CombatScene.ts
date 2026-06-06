import { GameScene } from "./GameScene";
import { Container, Graphics, Text } from "pixi.js";
import type { TacticalEncounter } from "@/domain/TacticalEncounter";
import type { GameEngine } from "@/systems/GameEngine";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { EncounterState, SceneType } from "@/types";
import type { EnemyType, AIProfile } from "@/types";
import { logger } from "@/utils/logger";

export interface CombatContext {
  encounter?: TacticalEncounter;
  gameEngine?: GameEngine;
  /** Optional NPC-sourced enemy for Task 11 */
  npcEnemy?: {
    id: string;
    hullHP: number;
    shields: number;
    damage: number;
    techLevel: number;
  };
  /** True when this is the OVERMIND core encounter (win condition). */
  isOvermindCore?: boolean;
}

export class CombatScene extends GameScene {
  private _encounter?: TacticalEncounter;
  private _gameEngine?: GameEngine;
  private _system: CombatSystem | null = null;
  private _uiContainer: Container | null = null;
  private _weaponPanelContainer: Container | null = null;
  private _outcomeShown = false;
  private _npcId: string | null = null;
  private _isOvermindCore = false;

  initialize(context?: object): void {
    const ctx = context as CombatContext | undefined;
    this._gameEngine = ctx?.gameEngine;
    this._encounter = ctx?.encounter;
    this._outcomeShown = false;
    this._npcId = ctx?.npcEnemy?.id ?? null;
    this._isOvermindCore = ctx?.isOvermindCore ?? false;

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Build a default encounter if one wasn't provided but we have a game engine + player
    if (!this._encounter && this._gameEngine?.player) {
      const player = this._gameEngine.player;
      const system = new CombatSystem(this._gameEngine.qualityProfile);

      let enemy: EnemyShip;
      if (ctx?.npcEnemy) {
        const npc = ctx.npcEnemy;
        enemy = new EnemyShip(
          npc.id,
          "FIGHTER" as EnemyType,
          npc.hullHP,
          npc.shields,
          0.1,
          npc.damage,
          false,
          [],
          {} as AIProfile,
          npc.techLevel,
        );
      } else {
        enemy = new EnemyShip(
          `enemy_${Date.now()}`,
          "FIGHTER" as EnemyType,
          60,
          20,
          0.1,
          15,
          false,
          [],
          {} as AIProfile,
          2,
        );
      }

      this._encounter = system.startCombat(player.ship, [enemy], {
        obstacles: [],
        cover: [],
        nebulae: [],
      });
      this._system = system;
    }

    this.renderCombatGrid();
    this.renderActionButtons();
    this.renderWeaponPanel();
    logger.info("CombatScene initialized");
  }

  update(_deltaTime: number): void {
    // Combat is turn-based; no continuous updates needed
  }

  destroy(): void {
    this._uiContainer = null;
    this._weaponPanelContainer = null;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
  }

  private getSystem(): CombatSystem | null {
    return this._system;
  }

  private renderCombatGrid(): void {
    const graphics = new Graphics();
    const hexSize = 24;
    const offsetX = 100;
    const offsetY = 80;

    for (let r = 0; r < 9; r++) {
      for (let q = 0; q < 9; q++) {
        const x = offsetX + q * hexSize * 1.8 + (r % 2) * hexSize * 0.9;
        const y = offsetY + r * hexSize * 1.5;

        graphics.stroke({ width: 1, color: 0x224466 });
        graphics.fill({ color: 0x0a1525 });

        const points: number[] = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          points.push(
            x + hexSize * Math.cos(angle),
            y + hexSize * Math.sin(angle),
          );
        }
        graphics.poly(points);
        graphics.fill(0x0a1525);
        graphics.stroke({ width: 1, color: 0x224466 });
      }
    }

    this.renderer.gameLayer.addChild(graphics);

    const title = new Text({
      text: "TACTICAL COMBAT",
      style: {
        fontFamily: "Courier New",
        fontSize: 20,
        fill: 0xff4444,
        letterSpacing: 3,
      },
    });
    title.x = 20;
    title.y = 20;
    title.eventMode = "none";
    this.renderer.uiLayer.addChild(title);
  }

  private renderActionButtons(): void {
    if (!this._system) return;

    const uiContainer = new Container();
    this._uiContainer = uiContainer;

    const btnY = 430;

    const attackBtn = this.makeButton("[ Атаковать ]", 0xff4444, 50, btnY);
    attackBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.onPlayerAttack();
    });

    const waitBtn = this.makeButton("[ Ждать ]", 0x888888, 230, btnY);
    waitBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.onPlayerWait();
    });

    const retreatBtn = this.makeButton("[ Отступить ]", 0x4488ff, 370, btnY);
    retreatBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.onPlayerRetreat();
    });

    uiContainer.addChild(attackBtn, waitBtn, retreatBtn);
    this.renderer.uiLayer.addChild(uiContainer);
  }

  private makeButton(
    label: string,
    color: number,
    x: number,
    y: number,
  ): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.fill({ color: 0x0d1b2a });
    bg.stroke({ width: 1, color });
    bg.roundRect(0, 0, 160, 36, 4);
    bg.fill();
    bg.stroke();

    const text = new Text({
      text: label,
      style: { fontFamily: "Courier New", fontSize: 14, fill: color },
    });
    text.x = 8;
    text.y = 8;
    text.eventMode = "none";

    btn.addChild(bg, text);
    btn.x = x;
    btn.y = y;
    btn.eventMode = "static";
    btn.cursor = "pointer";
    return btn;
  }

  private renderWeaponPanel(): void {
    if (this._weaponPanelContainer) {
      this.renderer.uiLayer.removeChild(this._weaponPanelContainer);
      this._weaponPanelContainer = null;
    }

    const system = this.getSystem();
    const player = this._gameEngine?.player;
    if (!system || !player) return;

    const weaponModules = (
      player.ship.modules as (import("@/domain/ShipModule").ShipModule | null)[]
    ).filter((m) => m !== null && m.category === "WEAPON");
    if (weaponModules.length === 0) return;

    const container = new Container();
    this._weaponPanelContainer = container;

    const label = new Text({
      text: "ВООРУЖЕНИЕ:",
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0x888888 },
    });
    label.x = 50;
    label.y = 368;
    label.eventMode = "none";
    container.addChild(label);

    let btnX = 50;
    for (const mod of weaponModules) {
      if (!mod) continue;
      const cooldown = system.getWeaponCooldown(mod.id);
      const onCd = cooldown > 0;
      const btn = this.makeWeaponButton(mod.name, cooldown, onCd, btnX, 385);
      if (!onCd) {
        const weaponId = mod.id;
        btn.on("pointerdown", (e) => {
          e.stopPropagation();
          void this.onPlayerAttackWithWeapon(weaponId);
        });
      }
      container.addChild(btn);
      btnX += 175;
    }

    this.renderer.uiLayer.addChild(container);
  }

  private makeWeaponButton(
    name: string,
    cooldown: number,
    disabled: boolean,
    x: number,
    y: number,
  ): Container {
    const btn = new Container();
    const color = disabled ? 0x444444 : 0xffaa00;
    const bg = new Graphics();
    bg.fill({ color: 0x0d1b2a });
    bg.stroke({ width: 1, color });
    bg.roundRect(0, 0, 165, 36, 4);
    bg.fill();
    bg.stroke();

    const shortName = name.length > 18 ? name.slice(0, 16) + "…" : name;
    const cdSuffix = disabled ? ` [${cooldown}]` : "";
    const label = new Text({
      text: shortName + cdSuffix,
      style: { fontFamily: "Courier New", fontSize: 11, fill: color },
    });
    label.x = 6;
    label.y = 10;
    label.eventMode = "none";

    btn.addChild(bg, label);
    btn.x = x;
    btn.y = y;
    btn.eventMode = disabled ? "none" : "static";
    if (!disabled) btn.cursor = "pointer";
    return btn;
  }

  private async onPlayerAttackWithWeapon(weaponId: string): Promise<void> {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return;

    const result = system.processPlayerAction({ type: "ATTACK", weaponId });
    this.renderWeaponPanel();

    if (result.loot !== undefined || result.xpGained !== undefined) {
      // Player action ended combat — player killed the last enemy
      this.applyRewardsToPlayer(
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        result.killPointsGained ?? 0,
      );
      this.showOutcomePanel(
        result.message,
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        "victory",
      );
      return;
    }

    const enemyResult = await system.executeEnemyTurns();
    this.renderWeaponPanel();
    if (enemyResult.result) {
      this.applyRewardsToPlayer(
        enemyResult.result.xpGained,
        enemyResult.result.loot as import("@/domain/ShipModule").ShipModule[],
        enemyResult.result.killPointsGained,
      );
      this.showOutcomePanel(
        enemyResult.result.message,
        enemyResult.result.xpGained,
        enemyResult.result.loot as import("@/domain/ShipModule").ShipModule[],
        enemyResult.result.xpGained > 0 ? "victory" : "defeat",
      );
    }
  }

  private async onPlayerAttack(): Promise<void> {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return;

    this._gameEngine?.audio.playSfx("hit").catch(() => {});
    const result = system.processPlayerAction({ type: "ATTACK" });
    this.renderWeaponPanel();
    if (result.loot !== undefined || result.xpGained !== undefined) {
      // Player action ended combat — player killed the last enemy
      this.applyRewardsToPlayer(
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        result.killPointsGained ?? 0,
      );
      this.showOutcomePanel(
        result.message,
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        "victory",
      );
      return;
    }

    // Run enemy turns
    const enemyResult = await system.executeEnemyTurns();
    this.renderWeaponPanel();
    if (enemyResult.result) {
      this.applyRewardsToPlayer(
        enemyResult.result.xpGained,
        enemyResult.result.loot as import("@/domain/ShipModule").ShipModule[],
        enemyResult.result.killPointsGained,
      );
      this.showOutcomePanel(
        enemyResult.result.message,
        enemyResult.result.xpGained,
        enemyResult.result.loot as import("@/domain/ShipModule").ShipModule[],
        enemyResult.result.xpGained > 0 ? "victory" : "defeat",
      );
    }
  }

  private async onPlayerWait(): Promise<void> {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return;

    system.processPlayerAction({ type: "WAIT" });
    this.renderWeaponPanel();

    const enemyResult = await system.executeEnemyTurns();
    this.renderWeaponPanel();
    if (enemyResult.result) {
      this.applyRewardsToPlayer(
        enemyResult.result.xpGained,
        enemyResult.result.loot as import("@/domain/ShipModule").ShipModule[],
        enemyResult.result.killPointsGained,
      );
      this.showOutcomePanel(
        enemyResult.result.message,
        enemyResult.result.xpGained,
        enemyResult.result.loot as import("@/domain/ShipModule").ShipModule[],
        enemyResult.result.xpGained > 0 ? "victory" : "defeat",
      );
    }
  }

  private async onPlayerRetreat(): Promise<void> {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return;

    if (system.encounter) {
      system.encounter.state = EncounterState.RETREAT;
    }
    this.showOutcomePanel("Отступление — корабль цел.", 0, [], "retreat");
  }

  private applyRewardsToPlayer(
    credits: number,
    loot: import("@/domain/ShipModule").ShipModule[],
    killPoints: number = 0,
  ): void {
    const player = this._gameEngine?.player;
    if (!player) return;
    if (credits > 0) player.credits += credits;
    if (killPoints > 0) player.killPoints += killPoints;
    for (const item of loot) {
      player.inventory.addItem(item);
    }
  }

  private showOutcomePanel(
    message: string,
    credits: number,
    loot: import("@/domain/ShipModule").ShipModule[],
    combatResult: "victory" | "defeat" | "retreat" = "defeat",
  ): void {
    if (this._outcomeShown) return;
    this._outcomeShown = true;

    // Play outcome SFX
    if (combatResult === "victory") {
      this._gameEngine?.audio.playSfx("reward").catch(() => {});
    }

    // Hide action buttons
    if (this._uiContainer) {
      this._uiContainer.visible = false;
    }

    const isVictory = combatResult === "victory";
    const overlay = new Container();
    const bg = new Graphics();
    bg.fill({ color: 0x000000, alpha: 0.85 });
    bg.rect(60, 140, 500, 220);
    bg.fill();

    const border = new Graphics();
    border.stroke({ width: 2, color: isVictory ? 0x44ff88 : 0xff4444 });
    border.rect(60, 140, 500, 220);
    border.stroke();

    const msgText = new Text({
      text: message,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: isVictory ? 0x44ff88 : 0xff4444,
      },
    });
    msgText.x = 80;
    msgText.y = 165;
    msgText.eventMode = "none";

    let rewardText = "";
    if (credits > 0) rewardText += `Кредиты: +${credits} ₡\n`;
    for (const item of loot) rewardText += `Найдено: ${item.name}\n`;

    const rewardDisplay = new Text({
      text: rewardText,
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0xcccccc },
    });
    rewardDisplay.x = 80;
    rewardDisplay.y = 205;
    rewardDisplay.eventMode = "none";

    const continueBtn = this.makeButton("[ Продолжить ]", 0xffffff, 230, 315);
    continueBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      if (this._gameEngine) {
        // OVERMIND core destroyed → trigger game win screen.
        if (this._isOvermindCore && combatResult === "victory") {
          this._gameEngine.showGameOutcomeScreen(true);
          return;
        }
        void this._gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
          gameEngine: this._gameEngine,
          combatResult: combatResult === "victory" ? "victory" : "retreat",
          npcId: this._npcId ?? undefined,
        });
      }
    });

    overlay.addChild(bg, border, msgText, rewardDisplay, continueBtn);
    this.renderer.uiLayer.addChild(overlay);
  }

  // ── E2E test helpers (accessible at runtime, typed for page.evaluate) ────

  /** Returns the current encounter state for E2E assertions. */
  e2eGetEncounterState(): {
    enemyHp: number;
    playerHp: number;
    state: string;
    enemyCount: number;
  } | null {
    const enc = this._encounter;
    if (!enc) return null;
    const enemy = enc.enemies[0];
    const playerShip = enc.playerShip;
    return {
      enemyHp: enemy?.hullHP ?? 0,
      playerHp: (playerShip as unknown as { hullHP?: number })?.hullHP ?? 0,
      state: enc.state,
      enemyCount: enc.enemies.length,
    };
  }

  /** Reduce the first enemy to 1 HP so the next attack guarantees a kill. */
  e2eWeakenEnemy(): void {
    const enc = this._encounter;
    if (!enc || enc.enemies.length === 0) return;
    enc.enemies[0].hullHP = 1;
  }

  /** Trigger a player attack turn (async, resolves after AI counter-turn). */
  async e2eAttack(): Promise<void> {
    return this.onPlayerAttack();
  }

  /** Returns true when the outcome panel (victory/defeat) has been shown. */
  e2eIsOutcomeShown(): boolean {
    return this._outcomeShown;
  }
}
