import type { QuestScript } from "./QuestScript";
import { customsScript } from "./scripts/customs";
import { gravitySlalomScript } from "./scripts/gravity-slalom";
import { investigationScript } from "./scripts/investigation";
import { cargoSortScript } from "./scripts/cargo-sort";
import { reactorScript } from "./scripts/reactor";
import { auctionScript } from "./scripts/auction";
import { derelictSalvageScript } from "./scripts/derelict-salvage";
import { smugglingRunScript } from "./scripts/smuggling-run";
import { hostageRescueScript } from "./scripts/hostage-rescue";

export const ALL_QUEST_SCRIPTS: readonly QuestScript[] = [
  customsScript,
  gravitySlalomScript,
  investigationScript,
  cargoSortScript,
  reactorScript,
  auctionScript,
  derelictSalvageScript,
  smugglingRunScript,
  hostageRescueScript,
];

const REGISTRY = new Map<string, QuestScript>(
  ALL_QUEST_SCRIPTS.map((s) => [s.id, s]),
);

export function getQuestScript(id: string): QuestScript | undefined {
  return REGISTRY.get(id);
}

/** Deterministically returns 1-2 script IDs available on a planet (by hash of planetId). */
export function getAvailableQuestScriptIds(planetId: string): string[] {
  let hash = 0;
  for (let i = 0; i < planetId.length; i++) {
    hash = (hash * 31 + planetId.charCodeAt(i)) >>> 0;
  }
  const n = ALL_QUEST_SCRIPTS.length;
  const idx1 = hash % n;
  const idx2 = (hash >> 4) % n;
  const ids = [ALL_QUEST_SCRIPTS[idx1].id];
  if (idx2 !== idx1) {
    ids.push(ALL_QUEST_SCRIPTS[idx2].id);
  }
  return ids;
}
