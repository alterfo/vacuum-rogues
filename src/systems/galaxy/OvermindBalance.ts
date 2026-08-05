export interface BalanceSystemNode {
  id: string;
  connections: { toSystemId: string }[];
}

export interface BalanceRng {
  next(): number;
}

export interface OwnershipBalanceConfig {
  pCapture: number;
  pRecaptureBase: number;
  feedbackStrength: number;
  freezeOvermind?: boolean;
}

export interface BalanceResult {
  overmindSystems: string[];
  pirateSystems: string[];
}

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
      let hasOvermindNeighbor = false;
      let hasPirateNeighbor = false;
      for (const conn of sys.connections) {
        if (overmindSet.has(conn.toSystemId)) hasOvermindNeighbor = true;
        if (pirateSet.has(conn.toSystemId)) hasPirateNeighbor = true;
      }
      const canCaptureAsOvermind = hasOvermindNeighbor && !freezeOvermind;
      const isBorderFaction = canCaptureAsOvermind || hasPirateNeighbor;
      if (isBorderFaction && rng.next() < effectivePCapture) {
        toCapture.push({ id: sys.id, asOvermind: canCaptureAsOvermind });
      }
    } else {
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
