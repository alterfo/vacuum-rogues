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

/**
 * Everything the interaction controller reads from (or pushes back to) the
 * owning {@link NpcShipManager} without depending on the concrete manager class.
 *
 * The scene-facing accessors are re-exposed via {@link NpcShipManagerDeps}
 * (`flight`); the shared auto-pursuit/aim state (`followNpcId`/`approachNpcId`/
 * `steerTargetId`/`pursuitSuspended`/`lastAim`) still lives on the manager for
 * now (relocated into `CombatPursuitController` in a later task), so the
 * controller mutates it through the setter callbacks here rather than owning it.
 */
export interface NpcInteractionDeps {
  /** Scene-facing accessors (the manager's own {@link NpcShipManagerDeps}). */
  flight: NpcShipManagerDeps;
  /** The contact-panel lifecycle manager (shared with the manager). */
  panels: ContactPanelManager;
  /** The owning engine (nullable in lightweight test/host setups). */
  getGameEngine(): GameEngine | null;
  /** Live NPC sprites present in the player's system. */
  getNpcSprites(): NpcShipSprite[];
  /** Radar/scanner reach (world px) — the hail/trade offer gate. */
  scannerRange: number;
  /** Weapon reach (world px) — the immediate-engage gate. */
  weaponRange: number;
  /** Turn the target (and its faction, in-system) openly hostile. */
  escalateHostility(npc: NpcShip): void;
  /** Engage real-time in-flight combat against a specific NPC. */
  launchCombatWithNpc(npc: NpcShip): void;
  /** Shared auto-follow target id (owned by the manager until the combat split). */
  setFollowNpcId(id: string | null): void;
  /** Shared non-combat approach target id. */
  setApproachNpcId(id: string | null): void;
  /** Shared smoothed-lead chase target id (reset on a fresh chase leg). */
  setSteerTargetId(id: string | null): void;
  /** Shared break-off flag: true while a manual route overrides auto-pursuit. */
  setPursuitSuspended(v: boolean): void;
  /** Remember the live route destination (the lead point) for re-aiming. */
  setLastAim(x: number, y: number): void;
  /** Drop a sprite's orbit anchor when a pirate disengages. */
  clearNpcAnchor(sprite: NpcShipSprite): void;
}

/**
 * Owns the player-vs-NPC contact-panel action cluster extracted from
 * {@link NpcShipManager}: the click-to-open gate, the hail/trade/attack/
 * approach/hire actions, and the pirate "кошелёк или жизнь" shakedown flow
 * (roll → hail → pay tribute / flee / disengage).
 *
 * Mirrors the {@link ContactPanelManager} shape — constructed with a narrow
 * deps bundle, owned by the manager as a property, its methods forwarded 1:1 so
 * the manager's public/tested surface is unchanged. Money moves only through the
 * banking bus ({@link payTribute}) — never a direct credit write.
 */
export class NpcInteractionController {
  constructor(private readonly deps: NpcInteractionDeps) {}

  private get engine(): GameEngine | null {
    return this.deps.getGameEngine();
  }

  onNpcClick(npc: NpcShip): void {
    // During an in-flight fight a click on an enemy ship retargets the combat
    // module instead of opening the contact panel (Task 13).
    if (this.deps.flight.isInCombat?.()) {
      const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
      if (sprite) this.deps.flight.selectCombatTarget?.(sprite);
      // Clicking an enemy mid-fight is an explicit "engage this one" — drop any
      // break-off so the auto-pursuit resumes toward the (re)selected target.
      this.deps.setPursuitSuspended(false);
      return;
    }
    if (this.deps.flight.isTurnRunning()) return;

    // Hailing/trading and the detailed readout are offered within radar/scanner
    // range; beyond it the panel only offers "Приблизиться" to close the gap
    // (US-070 #3). The gate is the scanner range, not the (much shorter) firing
    // range — you can talk and trade well before you are in weapons reach.
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

    // Hailing an Overmind ("Предтечи") craft is futile: it answers with nonsense
    // and the panel surfaces no actionable options (commsOptionsFor → []). Emit a
    // gibberish transmission so the dead-end reads as alien static, not a bug.
    if (inRange && commsContextFor(npc) === "overmind") {
      const day = this.engine?.galaxy?.gameDays ?? 0;
      const line = overmindGibberish(
        new SeededRNG(`overmind:${npc.id}:${day}`),
      );
      this.deps.flight.showMessage(`${npc.name}: «${line}»`, 0xaa66ff);
    }
  }

  /**
   * The player's current combat strength (hull + shields + weapon damage), used
   * to gauge how a passing pirate sizes the player up before a shakedown. Reads
   * the live ship pools + the loadout's derived weapon damage; 0 when no ship.
   */
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

  /**
   * The player's current reputation with the pirate faction. A player at/above
   * the good-pirate-rep threshold is left alone by pirates (no attack, no ransom)
   * — see {@link playerIsGoodWithPirates} and {@link rollShakedown}. Optional
   * chaining tolerates a mock player without the method (treated as rep 0).
   */
  private playerPirateRep(): number {
    return this.engine?.player?.getReputation?.(PIRATE_FACTION_ID) ?? 0;
  }

  /**
   * Whether the player has good enough pirate reputation to be left alone: the
   * {@link isHostile} matrix (single source of truth) reports a pirate as
   * non-hostile to the player. Drives the in-flight attack exemption.
   */
  playerIsGoodWithPirates(): boolean {
    return !isHostile("pirate", "player", {
      pirateRep: this.playerPirateRep(),
    });
  }

  /**
   * Roll the pure {@link wantsToShakedownPlayer} decision for a pirate, seeded
   * deterministically by ship id + galaxy day so the outcome is stable for the
   * encounter (and reproducible in tests / replays). A player with good pirate
   * reputation is exempt — the decision short-circuits to `false`.
   */
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

  /**
   * Open the universal comms window in pirate-shakedown context ("Кошелёк или
   * жизнь!") and halt flight so the demand interrupts the player. The panel
   * surfaces the three responses: Откупиться (pay tribute → the pirate
   * disengages), Атаковать (refuse → fight), and Бежать (flee → escape-by-speed
   * roll). Pay/flee are resolved here (Task 3); attack reuses {@link onAttackNpc}.
   */
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

  /**
   * "Откупиться": pay the pirate's tribute through the bank bus (a balanced
   * player → pirate transfer — never a direct credit write) and the pirate
   * disengages, leaving the player alone this encounter. The tribute is a pure
   * function of the player's purse ({@link shakedownTribute}).
   *
   * Buying off a shakedown is also the **repeatable recovery path** for pirate
   * standing: it grants a small, capped +pirate-rep ({@link grantPirateTributeRep}),
   * so a player whose pirate rep fell to −50 can climb back to landable on
   * pirate-captured systems over several (costly) payoffs.
   */
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
    // Pirate standing is *bought*, not free: only a real (non-zero) payoff
    // raises rep, so a penniless player (tribute === 0) can't farm +rep for
    // nothing. The pirate still disengages either way.
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

  /**
   * "Бежать": attempt to out-run the pirate. The escape is a pure
   * {@link attemptFlee} roll on the player's vs the pirate's speed, seeded
   * deterministically by ship id + galaxy day. Success → the pirate breaks off;
   * failure → the pirate runs you down and opens fire.
   */
  onFleeShakedown(npc: NpcShip): void {
    this.deps.panels.close();
    const physics = this.deps.flight.getShipPhysics();
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    const playerSpeed = physics?.getMaxSpeed() ?? 0;
    const day = this.engine?.galaxy?.gameDays ?? 0;
    const escaped = attemptFlee(
      playerSpeed,
      npc.speed,
      new SeededRNG(`flee:${npc.id}:${day}`),
    );
    if (escaped) {
      this.disengagePirate(npc);
      this.deps.flight.showMessage(`Вы оторвались от ${npc.name}!`, 0x88ff88);
      return;
    }
    // Caught — the pirate runs you down and opens fire. Engage in-flight combat
    // AND resume the turn that openShakedownHail froze via endTurn(): CombatModule
    // .update is gated on isTurnRunning, so without re-arming it the fight would sit
    // dormant (no NPC fire, no active-pause overlay) until the player manually
    // pressed Play. Closing on the pirate through executeRouteTo re-arms the turn
    // and tracks the (moving) mark — the same path the "refuse → Атаковать" button
    // uses when the target is out of weapon range.
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

  /**
   * A pirate breaks off its shakedown (paid off or out-run): drop its pursuit
   * aggression and orbit anchor so it stops chasing the player this encounter.
   */
  private disengagePirate(npc: NpcShip): void {
    const sprite = this.deps.getNpcSprites().find((s) => s.npc.id === npc.id);
    if (!sprite) return;
    sprite.setAggressive(false);
    this.deps.clearNpcAnchor(sprite);
  }

  /**
   * "Приблизиться": plot a course that LEADS the moving target so the ship
   * closes to firing range aiming where it will be, not where it is, without
   * opening fire (US-070 #2; lead added playtest4 C). The player can then
   * re-open the panel to hail/trade or attack.
   */
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

  /**
   * Plot a route to (x,y) and remember it as the live destination so a moving
   * target can be re-aimed against the true endpoint (the immediate waypoint
   * ShipPhysics exposes may be a sun-avoidance bend, not the destination).
   */
  aimRoute(x: number, y: number): void {
    this.deps.setLastAim(x, y);
    this.deps.flight.executeRouteTo(x, y);
  }

  /** "Связаться": if player has an active TEXT_ADVENTURE quest, launch it; otherwise show greeting. */
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

  /** "Торговать": trade-with-ships is not implemented yet — be honest. */
  private onTradeNpc(npc: NpcShip): void {
    this.deps.flight.showMessage(
      `Торговля с ${npc.name} пока недоступна в полёте.`,
      0xffaa00,
    );
  }

  /**
   * "Нанять" / "Союз": offer the hailed ship credits to turn on the player's
   * current threat. Both reduce to a merc contract against the nearest ship that
   * is openly hostile to the player (the target you actually need help with) —
   * they differ only in framing. The player pays the ship's {@link hireFee}
   * asking price; an accepted contract pays through the bank bus (a balanced
   * player → NPC transfer, never a direct credit write) and {@link hireGoal}
   * retargets the hired ship to hunt the mark. Declined when no hostile target is
   * present, the ship won't attack its own faction, or the player can't afford
   * the fee.
   */
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
    // acceptsHire still gates the meaningful declines (won't betray its own
    // faction / itself / won't take the coin while hostile to the player). The
    // price branch is always satisfied here since the offer equals the fee.
    if (!acceptsHire(npc, hireFee(target), target)) {
      this.deps.flight.showMessage(`${npc.name}: «Своих не трогаю.»`, 0xffaa00);
      return;
    }
    // Known Limitation #1 (plan 20260619-universal-comms-and-pirate-encounters):
    // the simulator has no NPC-vs-NPC engagement path yet, so a hire/ally contract
    // cannot actually be delivered. Do NOT debit the player (via payHire) for an
    // effect that will not occur — the previous code charged the full fee for an
    // inert contract, a money-loss bug. Payment is deferred until the merc can
    // really engage the mark. The hunt goal is still recorded for that future
    // path (harmless if the daily tick later recomputes it).
    //
    // NOTE: do NOT stash the mark in `npc.activeQuestTarget` — that field is a
    // *system* id consumed by NpcSimulator's RANGER questing (completion compares
    // it to `currentSystemId`; a ranger only accepts a new quest while it is null,
    // and it persists via the save schema). Writing a *ship* id here permanently
    // wedges a hired ranger out of questing. `npc.goal = hireGoal(target)` already
    // records the contract for any future NPC-vs-NPC engagement.
    npc.goal = hireGoal(target);
    const verb = mode === "ally" ? "готов вступить в бой" : "берёт контракт";
    this.deps.flight.showMessage(
      `${npc.name} ${verb} против ${target.name} — бой между кораблями пока не поддержан, плата не взята.`,
      0xffcc44,
    );
  }

  /**
   * The nearest NPC openly hostile to the player (excluding `excludeId`), by
   * world distance to the player ship — the threat a hired/allied ship is paid to
   * deal with. Null when no hostile ship is present or the player ship is absent.
   */
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

  /**
   * "Атаковать": if already within weapon range, engage real-time in-flight
   * combat immediately. Otherwise, close the panel and set the ship to
   * auto-follow (intercept) the target — updateCombat() engages once in range.
   */
  onAttackNpc(npc: NpcShip): void {
    // Declaring an attack turns the target — and every same-faction ship in the
    // player's system — openly hostile (Task 14). No-op for garrison/pirate ships
    // that already spawned hostile.
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

    // Not yet in range — auto-follow to close the gap, aiming at a lead point
    // so the intercept curves to where the target is heading (Task 5).
    this.deps.setFollowNpcId(npc.id);
    this.deps.setApproachNpcId(null); // attack supersedes a non-combat approach
    this.deps.flight.clearRouteTarget();
    const lead = this.npcLeadPoint(sprite);
    this.aimRoute(lead.x, lead.y);
    this.deps.flight.showMessage(`Перехват: ${npc.name}`, 0xff5555);
  }

  /**
   * Predicted intercept point for chasing an NPC: leads the target along its
   * current heading so the pursuit curves toward where it will be rather than
   * pointing at its present position (Task 5). NPC velocity is derived from its
   * sprite heading (the hull faces its direction of travel) and the ship's own
   * class cruise speed (`sprite.cruiseSpeed`) — basic ships drift slower than the
   * interceptor tier, so the lead must not over-predict a slow trader's travel.
   * Falls back to the NPC's current position when no lead solves.
   */
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
