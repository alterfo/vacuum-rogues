/** Minimal graph node required by the balance step function. */
export interface BalanceSystemNode {
  id: string;
  connections: { toSystemId: string }[];
}

/** Seeded-RNG interface (compatible with SeededRNG). */
export interface BalanceRng {
  next(): number;
}

export interface OwnershipBalanceConfig {
  /** Base capture probability per border faction system per tick. */
  pCapture: number;
  /** Base recapture probability per border hostile system per tick. */
  pRecaptureBase: number;
  /**
   * Negative-feedback multiplier: pCapture is reduced and pRecapture is
   * increased proportionally to (hostileShare × feedbackStrength).
   */
  feedbackStrength: number;
  /**
   * When set, the equilibrium leaves the **Overmind** front entirely alone —
   * no faction system is captured *as Overmind* and no Overmind system is
   * recaptured/liberated (pirates still churn normally). The endgame-arc spread
   * machine (`advanceOvermind`) is the sole authority on the Overmind front once
   * the arc owns it; without this the equilibrium's negative feedback (a hard
   * ~25% share ceiling) both **caps the arc below its loss line** and can
   * **liberate the Overmind core**, handing the player a spurious "core broken"
   * win. Defaults to `false` so the pre-arc / pure-function behaviour is intact.
   */
  freezeOvermind?: boolean;
}

export interface BalanceResult {
  overmindSystems: string[];
  pirateSystems: string[];
}

/**
 * Single self-balancing ownership tick.
 *
 * Border faction systems adjacent to a hostile (overmind/pirate) system may be
 * captured with effective probability = pCapture * max(0, 1 - share*fs).
 * Border hostile systems adjacent to a faction system may be recaptured with
 * effective probability = min(1, pRecaptureBase * (1 + share*fs)).
 *
 * The negative feedback means captures slow down and recaptures accelerate as
 * the hostile share grows, pinning a stable equilibrium without a runaway.
 * All flips are collected before applying so order does not matter.
 *
 * Pure function — no side effects, no GameEngine coupling.
 */
export function stepOwnershipTick(
  systems: BalanceSystemNode[],
  overmindSystems: string[],
  pirateSystems: string[],
  rng: BalanceRng,
  config: OwnershipBalanceConfig,
): BalanceResult {
  const total = systems.length;
  if (total === 0) return { overmindSystems: [], pirateSystems: [] };

  const overmindSet = new Set(overmindSystems);
  const pirateSet = new Set(pirateSystems);
  const hostileShare = (overmindSet.size + pirateSet.size) / total;

  const effectivePCapture =
    config.pCapture * Math.max(0, 1 - hostileShare * config.feedbackStrength);
  const effectivePRecapture = Math.min(
    1,
    config.pRecaptureBase * (1 + hostileShare * config.feedbackStrength),
  );

  const freezeOvermind = config.freezeOvermind ?? false;
  const toCapture: { id: string; asOvermind: boolean }[] = [];
  const toLiberate: string[] = [];

  for (const sys of systems) {
    const isHostile = overmindSet.has(sys.id) || pirateSet.has(sys.id);

    if (!isHostile) {
      // Faction system: can be captured if it borders a hostile system.
      let hasOvermindNeighbor = false;
      let hasPirateNeighbor = false;
      for (const conn of sys.connections) {
        if (overmindSet.has(conn.toSystemId)) hasOvermindNeighbor = true;
        if (pirateSet.has(conn.toSystemId)) hasPirateNeighbor = true;
      }
      // When the arc owns the Overmind front, the equilibrium grows pirates only:
      // an Overmind-only border is left for `advanceOvermind` to expand.
      const canCaptureAsOvermind = hasOvermindNeighbor && !freezeOvermind;
      const isBorderFaction = canCaptureAsOvermind || hasPirateNeighbor;
      if (isBorderFaction && rng.next() < effectivePCapture) {
        // Capture by whichever hostile neighbour exists (overmind takes priority;
        // if only pirate neighbours → becomes pirate).
        toCapture.push({ id: sys.id, asOvermind: canCaptureAsOvermind });
      }
    } else {
      // Hostile system: can be recaptured if it borders at least one faction
      // system — unless it's an Overmind system the arc has frozen (the arc +
      // player are the only forces that shrink the Overmind front).
      if (freezeOvermind && overmindSet.has(sys.id)) continue;
      let hasFactionNeighbor = false;
      for (const conn of sys.connections) {
        if (
          !overmindSet.has(conn.toSystemId) &&
          !pirateSet.has(conn.toSystemId)
        ) {
          hasFactionNeighbor = true;
          break;
        }
      }
      if (hasFactionNeighbor && rng.next() < effectivePRecapture) {
        toLiberate.push(sys.id);
      }
    }
  }

  // Apply all flips immutably.
  const liberateSet = new Set(toLiberate);
  const nextOvermind = overmindSystems
    .filter((id) => !liberateSet.has(id))
    .concat(toCapture.filter((c) => c.asOvermind).map((c) => c.id));
  const nextPirate = pirateSystems
    .filter((id) => !liberateSet.has(id))
    .concat(toCapture.filter((c) => !c.asOvermind).map((c) => c.id));

  return {
    overmindSystems: nextOvermind,
    pirateSystems: nextPirate,
  };
}
