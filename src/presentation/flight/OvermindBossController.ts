import { Container, Graphics, Text } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { NpcShipManagerDeps } from "./NpcShipManager";
import { OVERMIND_CORE_ID } from "./NpcShipManager";
import { SeededRNG } from "@/utils/seededRNG";
import { scaledFont } from "@/utils/fontScale";

/**
 * Everything the OVERMIND-core boss controller reads from (or pushes back to)
 * the owning {@link NpcShipManager} without depending on the concrete manager
 * class. Mirrors the {@link NpcInteractionController}/{@link
 * CombatPursuitController}/{@link EncounterController} shape (Tasks 1–3): a
 * narrow deps bundle, owned by the manager as a property, its methods
 * forwarded 1:1.
 */
export interface OvermindBossControllerDeps {
  uiLayer: Container;
  getScreenSize(): { width: number; height: number };
  /** Scene-facing accessors (the manager's own {@link NpcShipManagerDeps}). */
  flight: NpcShipManagerDeps;
  getGameEngine(): GameEngine | null;
  getNpcSprites(): NpcShipSprite[];
  /** Spawn + mount a new NPC sprite (manager owns sprite/anchor bookkeeping). */
  addNpcSprite(npc: NpcShip, entry: boolean): void;
  /** The manager's shared {@link NpcSimulator} OVERMIND-core factory. */
  spawnOvermindInSystem(rng: SeededRNG, id: string, systemId: string): NpcShip;
}

/**
 * Owns the OVERMIND-core final-boss prompt + combatant spawn extracted from
 * {@link NpcShipManager} (plan Task 4): presenting the "attack the core /
 * retreat" prompt on entering the core's system, and spawning the boss as a
 * real in-flight combatant that auto-closes on the player. Killing it in
 * flight wins the game ({@link NpcShipManager.handleInFlightDeath}).
 */
export class OvermindBossController {
  private overlay: Container | null = null;

  constructor(private readonly deps: OvermindBossControllerDeps) {}

  /** True while the OVERMIND-core prompt overlay is open. */
  get isOpen(): boolean {
    return this.overlay !== null;
  }

  /** Tear down any open prompt overlay (manager destroy()). */
  destroy(): void {
    if (this.overlay) {
      if (!this.overlay.destroyed) {
        this.overlay.destroy({ children: true });
      }
      this.overlay = null;
    }
  }

  /** Close the prompt overlay (manager closeModals()). Idempotent. */
  close(): void {
    if (!this.overlay) return;
    const ov = this.overlay;
    this.overlay = null;
    // Guard: a scene transition may run clearUILayer() (which destroys this
    // overlay) before the microtask fires — destroying it twice throws.
    queueMicrotask(() => {
      if (!ov.destroyed) ov.destroy({ children: true });
    });
  }

  /** Rebuild the open prompt at the new font scale (manager refreshFontScale()). */
  refreshFontScale(): void {
    if (this.overlay && !this.overlay.destroyed) {
      this.overlay.destroy({ children: true });
      this.overlay = null;
      this.showOvermindCorePrompt();
    }
  }

  /**
   * Spawn the OVERMIND-core final boss as a real in-flight combatant — real-time
   * combat only, no hex CombatScene. The core enters as a hostile OVERMIND craft
   * that auto-closes on the player (aggressor maneuver) and is selected as the
   * player's auto-fire target; killing it in-flight wins the game. Idempotent: a
   * second prompt-attack while the core is already engaged is a no-op. Public
   * (not private) — exercised directly, via type-cast, by the existing
   * `combat/overmindCoreInflight.test.ts`.
   */
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
    );
    // Boss stats: far tougher than a patrol Доминатор. Real-time combat does NOT
    // model shields (firePlayerShot/fireNpcShot only touch hullHP), so fold the
    // old hex encounter's 150-shield layer into the hull — 300 hull + 150 shields
    // = 450 effective HP — to preserve the boss's intended toughness. Damage 45 as
    // before.
    core.name = "Ядро OVERMIND";
    core.hullHP = 450;
    core.maxHull = 450;
    core.damage = 45;
    core.markHostile();

    // Register the boss in the domain galaxy like every other in-system spawn
    // (garrison/capture-fleet callers push too): a day boundary during the fight
    // calls advanceGalaxyDay() → refresh(), which begins-departure on any sprite
    // absent from galaxy.npcShips. Without this the core flies out and the win
    // becomes unreachable; handleInFlightDeath's removeNpc would also no-op.
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

  /** Show a prompt when entering the OVERMIND core system so the player can fight the final encounter. */
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
    // Swallow clicks on the modal panel so they do not bubble to the stage
    // route-planning handler behind it (playtest3 F6 audit, CLAUDE.md Rule 2).
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
      // Real-time only: the core fights in-flight via the CombatModule (no hex
      // CombatScene hop). Killing it wins the game (handleInFlightDeath).
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
