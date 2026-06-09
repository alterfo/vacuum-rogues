import type { GameEngine } from "@/systems/GameEngine";
import { QuestType } from "@/types";
import { logger } from "@/utils/logger";

/**
 * Auto-completes the quests that resolve as a side-effect of flying into a
 * system or killing an NPC — exploration/defense on system entry, bounties on a
 * confirmed kill. Extracted from SpaceFlightScene: these are domain rules driven
 * by flight events, not part of the scene's render/input loop (SRP). The scene
 * fires the matching method at the relevant moment in initialize().
 */
export class QuestCompletion {
  constructor(private readonly gameEngine: GameEngine | null) {}

  /** Auto-complete BOUNTY quests targeting the defeated NpcShip. */
  bountyByNpcKill(npcId: string): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.BOUNTY) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      const matchesNpc = quest.targetObjectId === npcId;
      const matchesSystem =
        !quest.targetObjectId && quest.targetSystemId === currentSystemId;
      if (!matchesNpc && !matchesSystem) continue;
      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        logger.info(
          `BOUNTY quest auto-completed: ${quest.title} (npcId=${npcId})`,
        );
      }
    }
  }

  /** Auto-complete EXPLORATION quests whose target is the current system. */
  explorationBySystemEntry(): void {
    if (!this.gameEngine?.player) return;
    const player = this.gameEngine.player;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.EXPLORATION) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      if (quest.targetSystemId !== currentSystemId) continue;
      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        logger.info(
          `EXPLORATION quest auto-completed on system entry: ${quest.title}`,
        );
      }
    }
  }

  /**
   * Auto-complete DEFENSE quests targeting the current system and liberate the
   * adjacent OVERMIND system stored on the quest.
   */
  defenseBySystemEntry(): void {
    if (!this.gameEngine?.player || !this.gameEngine.galaxy) return;
    const player = this.gameEngine.player;
    const galaxy = this.gameEngine.galaxy;
    const questManager = this.gameEngine.questManager;
    const currentSystemId = player.currentSystemId;

    for (const quest of questManager.getActiveQuests()) {
      if (quest.type !== QuestType.DEFENSE) continue;
      if (quest.isCompleted || quest.isFailed) continue;
      if (quest.targetSystemId !== currentSystemId) continue;
      const completed = questManager.forceCompleteQuest(quest.id, player);
      if (completed) {
        // Remove the OVERMIND system stored in targetObjectId (the one being pushed back).
        if (quest.targetObjectId) {
          galaxy.removeOvermindSystem(quest.targetObjectId);
          logger.info(
            `DEFENSE quest completed: ${quest.title}, liberated OVERMIND system ${quest.targetObjectId}`,
          );
        }
      }
    }
  }
}
