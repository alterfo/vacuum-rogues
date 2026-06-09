import { GameScene } from "./GameScene";
import { Container, Graphics, Text } from "pixi.js";
import type { TacticalEncounter } from "@/domain/TacticalEncounter";
import type { GameEngine } from "@/systems/GameEngine";
import { CombatSystem } from "@/systems/CombatSystem";
import { EnemyShip } from "@/domain/EnemyShip";
import { EncounterState, SceneType } from "@/types";
import type { EnemyType, AIProfile } from "@/types";
import { logger } from "@/utils/logger";

const HEX_SIZE = 24;
const GRID_OFFSET_X = 100;
const GRID_OFFSET_Y = 80;
const HP_BAR_W = 140;
const HP_BAR_H = 10;
/** Reputation penalty applied to the enemy's faction on a kill. */
const KILL_REP_DELTA = -10;

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
    /** Faction the NPC belongs to — used for reputation adjustment on kill. */
    factionId?: string;
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
  private _npcFactionId: string | null = null;

  // Ship tokens rendered on the hex grid
  private _playerToken: Graphics | null = null;
  private _enemyTokens: Map<string, Graphics> = new Map();

  // HP bar fill graphics — redrawn on each HP change
  private _playerHpFill: Graphics | null = null;
  private _enemyHpFills: Map<string, Graphics> = new Map();

  // Combat log (last 5 entries)
  private _combatLog: string[] = [];
  private _combatLogText: Text | null = null;

  private _toastTimeout: ReturnType<typeof setTimeout> | null = null;

  initialize(context?: object): void {
    const ctx = context as CombatContext | undefined;
    this._gameEngine = ctx?.gameEngine;
    this._encounter = ctx?.encounter;
    this._outcomeShown = false;
    this._npcId = ctx?.npcEnemy?.id ?? null;
    this._isOvermindCore = ctx?.isOvermindCore ?? false;
    this._npcFactionId = ctx?.npcEnemy?.factionId ?? null;
    this._combatLog = [];
    this._enemyTokens.clear();
    this._enemyHpFills.clear();

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
    this.renderShipTokens();
    this.renderHpBars();
    this.renderCombatLog();
    this.renderActionButtons();
    this.renderWeaponPanel();
    logger.info("CombatScene initialized");
  }

  update(_deltaTime: number): void {
    // Combat is turn-based; no continuous updates needed
  }

  destroy(): void {
    if (this._toastTimeout) {
      clearTimeout(this._toastTimeout);
      this._toastTimeout = null;
    }
    this._uiContainer = null;
    this._weaponPanelContainer = null;
    this._playerToken = null;
    this._enemyTokens.clear();
    this._playerHpFill = null;
    this._enemyHpFills.clear();
    this._combatLogText = null;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private getSystem(): CombatSystem | null {
    return this._system;
  }

  private hexToScreen(q: number, r: number): { x: number; y: number } {
    return {
      x: GRID_OFFSET_X + q * HEX_SIZE * 1.8 + (r % 2) * HEX_SIZE * 0.9,
      y: GRID_OFFSET_Y + r * HEX_SIZE * 1.5,
    };
  }

  private hpBarColor(ratio: number): number {
    if (ratio > 0.6) return 0x44ff88;
    if (ratio > 0.3) return 0xffcc00;
    return 0xff4444;
  }

  // ── Render: grid ───────────────────────────────────────────────────────────

  private renderCombatGrid(): void {
    const graphics = new Graphics();

    for (let r = 0; r < 9; r++) {
      for (let q = 0; q < 9; q++) {
        const { x, y } = this.hexToScreen(q, r);

        graphics.stroke({ width: 1, color: 0x224466 });
        graphics.fill({ color: 0x0a1525 });

        const points: number[] = [];
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          points.push(
            x + HEX_SIZE * Math.cos(angle),
            y + HEX_SIZE * Math.sin(angle),
          );
        }
        graphics.poly(points);
        graphics.fill(0x0a1525);
        graphics.stroke({ width: 1, color: 0x224466 });
      }
    }

    this.renderer.gameLayer.addChild(graphics);

    const title = new Text({
      text: "ТАКТИЧЕСКИЙ БОЙ",
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

  // ── Render: ship tokens ────────────────────────────────────────────────────

  private renderShipTokens(): void {
    if (!this._encounter) return;

    // Player token — cyan circle at player start position {q:1, r:4}
    const pPos = this.hexToScreen(1, 4);
    const playerToken = new Graphics();
    playerToken.circle(pPos.x, pPos.y, 12).fill({ color: 0x00ccff });
    playerToken
      .circle(pPos.x, pPos.y, 12)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
    this._playerToken = playerToken;
    this.renderer.gameLayer.addChild(playerToken);

    // Enemy tokens — red circles at their start positions {q:7, r:2+index}
    this._encounter.enemies.forEach((enemy, index) => {
      const ePos = this.hexToScreen(7, 2 + index);
      const enemyToken = new Graphics();
      enemyToken.circle(ePos.x, ePos.y, 12).fill({ color: 0xff4444 });
      enemyToken
        .circle(ePos.x, ePos.y, 12)
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
      this._enemyTokens.set(enemy.id, enemyToken);
      this.renderer.gameLayer.addChild(enemyToken);
    });
  }

  // ── Render: HP bars ────────────────────────────────────────────────────────

  private renderHpBars(): void {
    if (!this._encounter) return;
    const { width: screenW } = this.renderer.app.screen;

    const container = new Container();

    // Player HP bar (left side)
    const playerLabel = new Text({
      text: "[ Игрок ]",
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0x00ccff },
    });
    playerLabel.x = 20;
    playerLabel.y = 46;
    playerLabel.eventMode = "none";
    container.addChild(playerLabel);

    const playerBg = new Graphics();
    playerBg.fill({ color: 0x222222 });
    playerBg.rect(20, 60, HP_BAR_W, HP_BAR_H);
    playerBg.fill();
    container.addChild(playerBg);

    const playerFill = new Graphics();
    this._playerHpFill = playerFill;
    container.addChild(playerFill);

    // Enemy HP bars (right side)
    this._encounter.enemies.forEach((enemy, index) => {
      const ex = screenW - 170;
      const ey = 46 + index * 30;

      const enemyLabel = new Text({
        text: "[ Враг ]",
        style: { fontFamily: "Courier New", fontSize: 11, fill: 0xff4444 },
      });
      enemyLabel.x = ex;
      enemyLabel.y = ey;
      enemyLabel.eventMode = "none";
      container.addChild(enemyLabel);

      const enemyBg = new Graphics();
      enemyBg.fill({ color: 0x222222 });
      enemyBg.rect(ex, ey + 14, HP_BAR_W, HP_BAR_H);
      enemyBg.fill();
      container.addChild(enemyBg);

      const enemyFill = new Graphics();
      this._enemyHpFills.set(enemy.id, enemyFill);
      container.addChild(enemyFill);
    });

    this.renderer.uiLayer.addChild(container);
    this.updateHpBars();
  }

  private updateHpBars(): void {
    const enc = this._encounter;
    if (!enc) return;
    const { width: screenW } = this.renderer.app.screen;

    // Player bar
    if (this._playerHpFill) {
      const ratio = Math.max(0, enc.playerShip.hullHP / enc.playerShip.maxHull);
      this._playerHpFill.clear();
      this._playerHpFill.fill({ color: this.hpBarColor(ratio) });
      this._playerHpFill.rect(20, 60, Math.floor(HP_BAR_W * ratio), HP_BAR_H);
      this._playerHpFill.fill();
    }

    // Enemy bars
    for (const enemy of enc.enemies) {
      const fill = this._enemyHpFills.get(enemy.id);
      if (!fill) continue;
      const ex = screenW - 170;
      const ratio = Math.max(0, enemy.hullHP / enemy.maxHull);
      fill.clear();
      fill.fill({ color: this.hpBarColor(ratio) });
      fill.rect(ex, 60, Math.floor(HP_BAR_W * ratio), HP_BAR_H);
      fill.fill();
    }
  }

  // ── Render: combat log ─────────────────────────────────────────────────────

  private renderCombatLog(): void {
    const { width: screenW } = this.renderer.app.screen;
    const logX = Math.min(510, screenW - 230);

    const logText = new Text({
      text: "",
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0x88aacc,
        wordWrap: true,
        wordWrapWidth: 220,
      },
    });
    logText.x = logX;
    logText.y = 80;
    logText.eventMode = "none";
    this._combatLogText = logText;
    this.renderer.uiLayer.addChild(logText);

    const logLabel = new Text({
      text: "— БОЙ —",
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0x446688 },
    });
    logLabel.x = logX;
    logLabel.y = 68;
    logLabel.eventMode = "none";
    this.renderer.uiLayer.addChild(logLabel);
  }

  private addLogEntry(text: string): void {
    this._combatLog.push(text);
    if (this._combatLog.length > 5) this._combatLog.shift();
    this.updateCombatLogDisplay();
  }

  private updateCombatLogDisplay(): void {
    if (!this._combatLogText) return;
    this._combatLogText.text = this._combatLog.join("\n");
  }

  // ── Flash effects ──────────────────────────────────────────────────────────

  private flashToken(token: Graphics, shieldHit: boolean): void {
    const original = token.alpha;
    token.alpha = shieldHit ? 0.2 : 0.05;
    setTimeout(() => {
      if (!token.destroyed) token.alpha = original;
    }, 180);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  private showToast(message: string, color: number = 0xffffff): void {
    const { width: screenW } = this.renderer.app.screen;

    const toast = new Text({
      text: message,
      style: { fontFamily: "Courier New", fontSize: 14, fill: color },
    });
    toast.anchor.set(0.5, 0);
    toast.x = screenW / 2;
    toast.y = 28;
    toast.eventMode = "none";
    this.renderer.uiLayer.addChild(toast);

    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
      this._toastTimeout = null;
    }, 3000);
  }

  // ── Render: action buttons ─────────────────────────────────────────────────

  private renderActionButtons(): void {
    if (!this._system) return;

    const { width: screenW, height: screenH } = this.renderer.app.screen;
    const btnY = Math.round(screenH * 0.78);

    const uiContainer = new Container();
    this._uiContainer = uiContainer;

    const attackBtn = this.makeButton(
      "[ Атаковать ]",
      0xff4444,
      Math.round(screenW * 0.06),
      btnY,
    );
    attackBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.onPlayerAttack();
    });

    const waitBtn = this.makeButton(
      "[ Ждать ]",
      0x888888,
      Math.round(screenW * 0.35),
      btnY,
    );
    waitBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      void this.onPlayerWait();
    });

    const retreatBtn = this.makeButton(
      "[ Отступить ]",
      0x4488ff,
      Math.round(screenW * 0.57),
      btnY,
    );
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

  // ── Render: weapon panel ───────────────────────────────────────────────────

  private renderWeaponPanel(): void {
    if (this._weaponPanelContainer) {
      this.renderer.uiLayer.removeChild(this._weaponPanelContainer);
      this._weaponPanelContainer = null;
    }

    const system = this.getSystem();
    const player = this._gameEngine?.player;
    if (!system || !player) return;

    const { height: screenH } = this.renderer.app.screen;
    const panelY = Math.round(screenH * 0.68);

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
    label.y = panelY;
    label.eventMode = "none";
    container.addChild(label);

    let btnX = 50;
    for (const mod of weaponModules) {
      if (!mod) continue;
      const cooldown = system.getWeaponCooldown(mod.id);
      const onCd = cooldown > 0;
      const btn = this.makeWeaponButton(
        mod.name,
        cooldown,
        onCd,
        btnX,
        panelY + 17,
      );
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
    const lbl = new Text({
      text: shortName + cdSuffix,
      style: { fontFamily: "Courier New", fontSize: 11, fill: color },
    });
    lbl.x = 6;
    lbl.y = 10;
    lbl.eventMode = "none";

    btn.addChild(bg, lbl);
    btn.x = x;
    btn.y = y;
    btn.eventMode = disabled ? "none" : "static";
    if (!disabled) btn.cursor = "pointer";
    return btn;
  }

  // ── Combat actions ─────────────────────────────────────────────────────────

  private async onPlayerAttackWithWeapon(weaponId: string): Promise<void> {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return;

    const result = system.processPlayerAction({ type: "ATTACK", weaponId });
    this.addLogEntry(
      `Игрок атакует (${weaponId.slice(0, 8)}): ${result.damageDealt} урона`,
    );
    this.renderWeaponPanel();
    this.updateHpBars();

    if (this._encounter?.enemies[0]) {
      const enemyToken0 = this._enemyTokens.get(this._encounter.enemies[0].id);
      if (enemyToken0) this.flashToken(enemyToken0, false);
    }

    if (result.outcome !== undefined) {
      this.applyRewardsToPlayer(
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        result.killPointsGained ?? 0,
      );
      this.showOutcomePanel(
        result.message,
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        result.outcome === EncounterState.PLAYER_WON ? "victory" : "defeat",
      );
      return;
    }

    const enemyResult = await system.executeEnemyTurns();
    this.renderWeaponPanel();
    this.updateHpBars();

    if (this._playerToken) {
      this.flashToken(
        this._playerToken,
        (this._encounter?.playerShip.shields ?? 0) > 0,
      );
    }

    if (this.checkAutoRetreat()) return;

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
        enemyResult.result.outcome === EncounterState.PLAYER_WON
          ? "victory"
          : "defeat",
      );
    }
  }

  private async onPlayerAttack(): Promise<void> {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return;

    this._gameEngine?.audio.playSfx("hit").catch(() => {});
    const result = system.processPlayerAction({ type: "ATTACK" });
    this.addLogEntry(`Игрок атакует: ${result.damageDealt} урона`);
    this.renderWeaponPanel();
    this.updateHpBars();

    if (this._encounter?.enemies[0]) {
      const enemyToken1 = this._enemyTokens.get(this._encounter.enemies[0].id);
      if (enemyToken1) this.flashToken(enemyToken1, false);
    }

    if (result.outcome !== undefined) {
      this.applyRewardsToPlayer(
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        result.killPointsGained ?? 0,
      );
      this.showOutcomePanel(
        result.message,
        result.xpGained ?? 0,
        (result.loot as import("@/domain/ShipModule").ShipModule[]) ?? [],
        result.outcome === EncounterState.PLAYER_WON ? "victory" : "defeat",
      );
      return;
    }

    const enemyResult = await system.executeEnemyTurns();
    this.renderWeaponPanel();
    this.updateHpBars();

    if (this._playerToken) {
      this.flashToken(
        this._playerToken,
        (this._encounter?.playerShip.shields ?? 0) > 0,
      );
    }

    if (this.checkAutoRetreat()) return;

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
        enemyResult.result.outcome === EncounterState.PLAYER_WON
          ? "victory"
          : "defeat",
      );
    }
  }

  private async onPlayerWait(): Promise<void> {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return;

    system.processPlayerAction({ type: "WAIT" });
    this.addLogEntry("Игрок ждёт…");
    this.renderWeaponPanel();

    const enemyResult = await system.executeEnemyTurns();
    this.renderWeaponPanel();
    this.updateHpBars();

    if (this._playerToken) {
      this.flashToken(
        this._playerToken,
        (this._encounter?.playerShip.shields ?? 0) > 0,
      );
    }

    if (this.checkAutoRetreat()) return;

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
        enemyResult.result.outcome === EncounterState.PLAYER_WON
          ? "victory"
          : "defeat",
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

  /** Check if auto-retreat should trigger; if so, initiate it. Returns true when triggered. */
  private checkAutoRetreat(): boolean {
    const system = this.getSystem();
    if (!system || this._outcomeShown) return false;
    if (system.isAutoRetreatTriggered()) {
      this.addLogEntry("⚠ Авто-отступление: HP < 30%!");
      this.showToast("Критические повреждения! Отступаю...", 0xff4444);
      void this.onPlayerRetreat();
      return true;
    }
    return false;
  }

  // ── Rewards ────────────────────────────────────────────────────────────────

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
    if (loot.length > 0) {
      this.showToast("Трофеи получены", 0x44ff88);
      this.addLogEntry(`Трофеи: ${loot.map((l) => l.name).join(", ")}`);
    }
    // Reputation penalty with the enemy's faction on a kill
    if (this._npcFactionId && (credits > 0 || killPoints > 0)) {
      player.adjustReputation(this._npcFactionId, KILL_REP_DELTA);
      logger.debug(`Reputation ${this._npcFactionId} ${KILL_REP_DELTA}`);
    }
  }

  // ── Outcome panel ──────────────────────────────────────────────────────────

  private showOutcomePanel(
    message: string,
    credits: number,
    loot: import("@/domain/ShipModule").ShipModule[],
    combatResult: "victory" | "defeat" | "retreat" = "defeat",
  ): void {
    if (this._outcomeShown) return;
    this._outcomeShown = true;

    if (combatResult === "victory") {
      this._gameEngine?.audio.playSfx("reward").catch(() => {});
      this.addLogEntry("✓ Победа!");
    } else if (combatResult === "defeat") {
      this.addLogEntry("✗ Поражение.");
    } else {
      this.addLogEntry("→ Отступление.");
    }

    if (this._uiContainer) {
      this._uiContainer.visible = false;
    }

    const { width: screenW, height: screenH } = this.renderer.app.screen;
    const panelX = Math.round(screenW * 0.1);
    const panelY = Math.round(screenH * 0.28);
    const panelW = Math.round(screenW * 0.8);
    const panelH = Math.round(screenH * 0.38);

    const isVictory = combatResult === "victory";
    const overlay = new Container();
    const bg = new Graphics();
    bg.fill({ color: 0x000000, alpha: 0.85 });
    bg.rect(panelX, panelY, panelW, panelH);
    bg.fill();

    const border = new Graphics();
    border.stroke({ width: 2, color: isVictory ? 0x44ff88 : 0xff4444 });
    border.rect(panelX, panelY, panelW, panelH);
    border.stroke();

    const msgText = new Text({
      text: message,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: isVictory ? 0x44ff88 : 0xff4444,
      },
    });
    msgText.x = panelX + 20;
    msgText.y = panelY + 25;
    msgText.eventMode = "none";

    let rewardText = "";
    if (credits > 0) rewardText += `Кредиты: +${credits} ₡\n`;
    for (const item of loot) rewardText += `Найдено: ${item.name}\n`;

    const rewardDisplay = new Text({
      text: rewardText,
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0xcccccc },
    });
    rewardDisplay.x = panelX + 20;
    rewardDisplay.y = panelY + 65;
    rewardDisplay.eventMode = "none";

    const continueBtn = this.makeButton(
      "[ Продолжить ]",
      0xffffff,
      Math.round(panelX + panelW / 2 - 80),
      panelY + panelH - 50,
    );
    continueBtn.on("pointerdown", (e) => {
      e.stopPropagation();
      if (this._gameEngine) {
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

  // ── E2E test helpers ────────────────────────────────────────────────────────

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
