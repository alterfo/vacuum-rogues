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
import { sabotageHeistScript } from "./scripts/sabotage-heist";
import { firstContactScript } from "./scripts/first-contact";
import { plagueCrisisScript } from "./scripts/plague-crisis";
import { evacuationScript } from "./scripts/evacuation";
import { lockedRoomScript } from "./scripts/locked-room";
import { lifeSupportScript } from "./scripts/life-support";
import { boardingStandoffScript } from "./scripts/boarding-standoff";
import { signalDecodeScript } from "./scripts/signal-decode";
import { orbitalEscapeScript } from "./scripts/orbital-escape";
import { tribunalScript } from "./scripts/tribunal";
import { quarantineScript } from "./scripts/quarantine";

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
  sabotageHeistScript,
  firstContactScript,
  plagueCrisisScript,
  evacuationScript,
  lockedRoomScript,
  lifeSupportScript,
  boardingStandoffScript,
  signalDecodeScript,
  orbitalEscapeScript,
  tribunalScript,
  quarantineScript,
];

const REGISTRY = new Map<string, QuestScript>(
  ALL_QUEST_SCRIPTS.map((s) => [s.id, s]),
);

export function getQuestScript(id: string): QuestScript | undefined {
  return REGISTRY.get(id);
}
