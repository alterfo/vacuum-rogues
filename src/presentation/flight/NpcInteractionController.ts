import type { GameEngine } from "@/systems/GameEngine";
import type { NpcShip } from "@/domain/NpcShip";
import type { NpcShipSprite } from "../NpcShipSprite";
import type { ContactPanelManager } from "./ContactPanelManager";
import type { NpcShipManagerDeps } from "./NpcShipManager";
import {
  wantsToShakedownPlayer,
  shipCombatStrength,
  shakedownTribute,
  attemptFlee,
  grappleHoldFraction,
  acceptsHire,
  hireFee,
  hireGoal,
} from "@/systems/npc/NpcBrain";
import { isHostile } from "@/systems/npc/factionHostility";
import {
  PIRATE_FACTION_ID,
  grantPirateTributeRep,
} from "@/systems/galaxy/landingAccess";
import { payTribute } from "@/systems/banking/economy";
import { SeededRNG } from "@/utils/seededRNG";
import { solveInterceptPoint } from "@/utils/intercept";
import { SceneType, QuestType } from "@/types";
import {
  commsContextFor,
  overmindGibberish,
} from "@/systems/comms/commsOptions";
import { t } from "@/i18n/i18n";

export interface NpcInteractionDeps {
  flight: NpcShipManagerDeps;
  panels: ContactPanelManager;
  getGameEngine(): GameEngine | null;
  getNpcSprites(): NpcShipSprite[];
  scannerRange: number;
  weaponRange: number;
  escalateHostility(npc: NpcShip): void;
  launchCombatWithNpc(npc: NpcShip): void;
  setFollowNpcId(id: string | null): void;
  setApproachNpcId(id: string | null): void;
  setSteerTargetId(id: string | null): void;
  setPursuitSuspended(v: boolean): void;
  setLastAim(x: number, y: number): void;
  clearNpcAnchor(sprite: NpcShipSprite): void;
}

export class NpcInteractionController {
  constructor(private readonly deps: NpcInteractionDeps) {}

  private get engine(): GameEngine | null {
    return this.deps.getGameEngine();
  }

  onNpcClick(npc: NpcShip): void {
    if (this.deps.flight.isInCombat?.()) {
      const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
      if (sprite) this.deps.flight.selectCombatTarget?.(sprite);
      this.deps.setPursuitSuspended(false);
      return;
    }
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    const physics = this.deps.flight.getShipPhysics();
    const inRange =
      !!sprite &&
      !!physics &&
      Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY) <=
        this.deps.scannerRange;
    const scanPower = this.engine?.playerLoadout?.derivedStats().scanPower ?? 0;
    this.deps.panels.open(
      npc,
      {
        onHail: () => this.onHailNpc(npc),
        onTrade: () => this.onTradeNpc(npc),
        onAttack: () => this.onAttackNpc(npc),
        onApproach: () => this.onApproachNpc(npc),
        onClose: () => this.deps.panels.close(),
        onHire: () => this.offerHireContract(npc, "hire"),
        onAlly: () => this.offerHireContract(npc, "ally"),
      },
      inRange,
      scanPower,
    );

    if (inRange && commsContextFor(npc) === "overmind") {
      const day = this.engine?.galaxy?.gameDays ?? 0;
      const line = overmindGibberish(
        new SeededRNG(`overmind:${npc.id}:${day}`),
      );
      this.deps.flight.showMessage(`${npc.name}: «${line}»`, 0xaa66ff);
    }
  }

  private playerCombatStrength(): number {
    const ship = this.engine?.player?.ship;
    if (!ship) return 0;
    const damage = this.engine?.playerLoadout?.derivedStats().weaponDamage ?? 0;
    return shipCombatStrength({
      hullHP: ship.hullHP,
      shields: ship.shields,
      damage,
    });
  }

  private playerPirateRep(): number {
    return this.engine?.player?.getReputation?.(PIRATE_FACTION_ID) ?? 0;
  }

  playerIsGoodWithPirates(): boolean {
    return !isHostile("pirate", "player", {
      pirateRep: this.playerPirateRep(),
    });
  }

  rollShakedown(npc: NpcShip): boolean {
    const day = this.engine?.galaxy?.gameDays ?? 0;
    const rng = new SeededRNG(`shakedown:${npc.id}:${day}`);
    return wantsToShakedownPlayer(
      npc,
      this.playerCombatStrength(),
      this.playerPirateRep(),
      rng,
    );
  }

  openShakedownHail(npc: NpcShip): void {
    this.deps.flight.endTurn(); // freeze flight so the hail can't be flown past
    const scanPower = this.engine?.playerLoadout?.derivedStats().scanPower ?? 0;
    this.deps.panels.open(
      npc,
      {
        onHail: () => this.onHailNpc(npc),
        onTrade: () => this.onTradeNpc(npc),
        onAttack: () => this.onAttackNpc(npc),
        onApproach: () => this.onApproachNpc(npc),
        onClose: () => this.deps.panels.close(),
        onPayTribute: () => this.onPayTribute(npc),
        onFlee: () => this.onFleeShakedown(npc),
      },
      true, // the pirate has closed to talking distance — full readout + options
      scanPower,
      "pirate-shakedown",
    );
    this.deps.flight.showMessage(`${npc.name}: «Кошелёк или жизнь!»`, 0xff5555);
  }

  onPayTribute(npc: NpcShip): void {
    const player = this.engine?.player;
    this.deps.panels.close();
    if (!player) return;
    const tribute = shakedownTribute(player.credits);
    payTribute(
      this.engine?.bank,
      player,
      npc,
      tribute,
      t("flight.tributeReason", { name: npc.name }),
    );
    const gainedRep = tribute > 0;
    if (gainedRep) grantPirateTributeRep(player);
    this.disengagePirate(npc);
    this.deps.flight.showMessage(
      gainedRep
        ? t("flight.tributePaidRep", { amount: tribute, name: npc.name })
        : t("flight.tributePaid", { amount: tribute, name: npc.name }),
      0xffee88,
    );
  }

  onFleeShakedown(npc: NpcShip): void {
    this.deps.panels.close();
    const physics = this.deps.flight.getShipPhysics();
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    const playerSpeed = physics?.getMaxSpeed() ?? 0;
    const day = this.engine?.galaxy?.gameDays ?? 0;
    const grappleStrength =
      this.engine?.playerLoadout?.derivedStats().grappleStrength ?? 0;
    const grappleHold = grappleHoldFraction(grappleStrength, npc.maxHull);
    const escaped = attemptFlee(
      playerSpeed,
      npc.speed,
      new SeededRNG(`flee:${npc.id}:${day}`),
      grappleHold,
    );
    if (escaped) {
      this.disengagePirate(npc);
      this.deps.flight.showMessage(`Вы оторвались от ${npc.name}!`, 0x88ff88);
      return;
    }
    this.deps.flight.showMessage(
      `Уйти не удалось — ${npc.name} атакует!`,
      0xff5555,
    );
    if (sprite) {
      this.deps.setFollowNpcId(npc.id);
      this.deps.flight.startInFlightCombat?.(sprite);
      this.deps.flight.selectCombatTarget?.(sprite);
      this.deps.flight.executeRouteTo(sprite.x, sprite.y);
    }
  }

  private disengagePirate(npc: NpcShip): void {
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    if (!sprite) return;
    sprite.setAggressive(false);
    this.deps.clearNpcAnchor(sprite);
  }

  private onApproachNpc(npc: NpcShip): void {
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    this.deps.panels.close();
    if (!sprite || !this.deps.flight.getShipPhysics()) return;
    this.deps.setFollowNpcId(null); // approach only — not an attack
    this.deps.setApproachNpcId(npc.id); // …but keep tracking it so the course corrects
    this.deps.setSteerTargetId(null); // fresh chase leg — reset the lead smoother
    this.deps.flight.clearRouteTarget();
    const lead = this.npcLeadPoint(sprite);
    this.aimRoute(lead.x, lead.y);
    this.deps.flight.showMessage(`Сближение: ${npc.name}`, 0x88ccff);
  }

  aimRoute(x: number, y: number): void {
    this.deps.setLastAim(x, y);
    this.deps.flight.executeRouteTo(x, y);
  }

  private onHailNpc(npc: NpcShip): void {
    this.deps.panels.close();

    const engine = this.engine;
    const activeQuests = engine?.questManager.getActiveQuests() ?? [];
    const textAdventureQuest = activeQuests.find(
      (q) => q.type === QuestType.TEXT_ADVENTURE,
    );

    if (textAdventureQuest && engine) {
      const scriptId =
        textAdventureQuest.targetObjectId ?? textAdventureQuest.id;
      void engine.startTextQuest(
        scriptId,
        undefined,
        SceneType.SPACE_FLIGHT,
        { gameEngine: engine },
        textAdventureQuest.id,
      );
      return;
    }

    const lines = [
      "Приветствую, рейнджер. Чистого космоса.",
      "Не мешай — у меня груз по расписанию.",
      "Держись подальше, если не ищешь неприятностей.",
      "Слыхал о возмущениях у рубежа? Будь начеку.",
    ];
    const line = lines[Math.floor(Math.random() * lines.length)];
    this.deps.flight.showMessage(`${npc.name}: «${line}»`, 0x88ccff);
  }

  private onTradeNpc(npc: NpcShip): void {
    this.deps.flight.showMessage(
      `Торговля с ${npc.name} пока недоступна в полёте.`,
      0xffaa00,
    );
  }

  private offerHireContract(npc: NpcShip, mode: "hire" | "ally"): void {
    this.deps.panels.close();
    const target = this.nearestHostileNpc(npc.id);
    if (!target) {
      this.deps.flight.showMessage(
        "Рядом нет враждебных целей для контракта.",
        0xffaa00,
      );
      return;
    }
    if (!acceptsHire(npc, hireFee(target), target)) {
      this.deps.flight.showMessage(`${npc.name}: «Своих не трогаю.»`, 0xffaa00);
      return;
    }
    npc.goal = hireGoal(target);
    const verb = mode === "ally" ? "готов вступить в бой" : "берёт контракт";
    this.deps.flight.showMessage(
      `${npc.name} ${verb} против ${target.name} — бой между кораблями пока не поддержан, плата не взята.`,
      0xffcc44,
    );
  }

  private nearestHostileNpc(excludeId: string): NpcShip | null {
    const physics = this.deps.flight.getShipPhysics();
    if (!physics) return null;
    let best: NpcShip | null = null;
    let bestDist = Infinity;
    for (const sprite of this.deps.getNpcSprites()) {
      if (sprite.npc.id === excludeId || !sprite.npc.isAggressive()) continue;
      const d = Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);
      if (d < bestDist) {
        bestDist = d;
        best = sprite.npc;
      }
    }
    return best;
  }

  onAttackNpc(npc: NpcShip): void {
    this.deps.escalateHostility(npc);
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    this.deps.panels.close();
    const physics = this.deps.flight.getShipPhysics();
    if (!sprite || !physics) return;

    const dist = Math.hypot(sprite.x - physics.shipX, sprite.y - physics.shipY);

    if (dist <= this.deps.weaponRange) {
      this.deps.launchCombatWithNpc(npc);
      return;
    }

    this.deps.setFollowNpcId(npc.id);
    this.deps.setApproachNpcId(null); // attack supersedes a non-combat approach
    this.deps.flight.clearRouteTarget();
    const lead = this.npcLeadPoint(sprite);
    this.aimRoute(lead.x, lead.y);
    this.deps.flight.showMessage(`Перехват: ${npc.name}`, 0xff5555);
  }

  npcLeadPoint(sprite: NpcShipSprite): { x: number; y: number } {
    const physics = this.deps.flight.getShipPhysics();
    if (!physics) return { x: sprite.x, y: sprite.y };
    const heading = sprite.container.rotation;
    const v = sprite.cruiseSpeed;
    const vx = Math.cos(heading) * v;
    const vy = Math.sin(heading) * v;
    return solveInterceptPoint(
      physics.shipX,
      physics.shipY,
      physics.getMaxSpeed(),
      sprite.x,
      sprite.y,
      vx,
      vy,
    );
  }
}
