import type {
  TextQuest,
  QuestNode,
  QuestCondition,
  QuestOutcome,
  TextQuestState,
  ResourceType,
} from "@/types";
import type { Player } from "@/domain/Player";
import { GameBusinessException } from "@/exceptions/GameBusinessException";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
  type BankAccess,
} from "@/systems/banking/economy";

export class TextQuestRuntime {
  private quest: TextQuest | null = null;

  start(quest: TextQuest, _player: Player): QuestNode {
    this.quest = quest;
    const node = this.getNode(quest.startNodeId);
    return node;
  }

  /**
   * Process a player choice.
   * Returns the next QuestNode, or null if the quest is complete (terminal node).
   * Throws GameBusinessException when a condition is not met.
   */
  choose(nodeId: string, choiceIdx: number, player: Player): QuestNode | null {
    if (!this.quest) {
      throw new GameBusinessException(
        "QUEST_NOT_STARTED",
        "No text quest is active.",
      );
    }

    const node = this.getNode(nodeId);
    const choice = node.choices[choiceIdx];
    if (!choice) {
      throw new GameBusinessException(
        "INVALID_CHOICE",
        `Choice index ${choiceIdx} does not exist on node ${nodeId}.`,
        { nodeId, choiceIdx },
      );
    }

    for (const cond of choice.conditions) {
      if (!this.checkCondition(cond, player)) {
        throw new GameBusinessException(
          "CONDITION_NOT_MET",
          this.conditionFailMessage(cond),
          { condition: cond },
        );
      }
    }

    if (choice.nextNodeId === null) {
      return null;
    }
    return this.getNode(choice.nextNodeId);
  }

  applyOutcome(
    outcome: QuestOutcome,
    player: Player,
    bank?: BankAccess | null,
  ): void {
    // Route the credit move through the bus (a gain credits the player, a loss
    // is clamped to the balance so credits never go negative — the old rule),
    // booking against rewards/fines so it shows up as a balanced GL posting.
    if (outcome.creditsDelta >= 0) {
      adjustPlayerCredits(
        bank,
        player,
        outcome.creditsDelta,
        GL_COUNTERPARTY.REWARDS,
        "Текстовый квест",
      );
    } else {
      const applied = Math.min(-outcome.creditsDelta, player.credits);
      adjustPlayerCredits(
        bank,
        player,
        -applied,
        GL_COUNTERPARTY.FINES,
        "Текстовый квест",
      );
    }

    if (outcome.reputationDelta !== 0 && outcome.factionId) {
      player.adjustReputation(outcome.factionId, outcome.reputationDelta);
    }

    if (outcome.itemGained) {
      const res = player.inventory.resources.find(
        (r) => r.type === (outcome.itemGained as ResourceType),
      );
      if (res) {
        res.amount += 1;
      } else {
        player.inventory.resources.push({
          type: outcome.itemGained as ResourceType,
          amount: 1,
        });
      }
    }

    if (outcome.itemLost) {
      const res = player.inventory.resources.find(
        (r) => r.type === (outcome.itemLost as ResourceType),
      );
      if (res && res.amount > 0) {
        res.amount -= 1;
      }
    }

    if (outcome.journalEntry) {
      const entry = {
        id: `journal_${Date.now()}`,
        date: Date.now(),
        text: outcome.journalEntry,
      };
      (
        player.journal.entries as typeof player.journal.entries & {
          push: (e: typeof entry) => void;
        }
      ).push(entry);
    }
  }

  getState(currentNodeId: string): TextQuestState | null {
    if (!this.quest) return null;
    return {
      questId: this.quest.id,
      currentNodeId,
      pendingOutcomes: [],
    };
  }

  private getNode(nodeId: string): QuestNode {
    const node = this.quest!.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new GameBusinessException(
        "QUEST_NODE_NOT_FOUND",
        `Quest node "${nodeId}" not found.`,
        { nodeId },
      );
    }
    return node;
  }

  private checkCondition(cond: QuestCondition, player: Player): boolean {
    let playerValue: number;

    switch (cond.type) {
      case "credits":
        playerValue = player.credits;
        break;
      case "reputation":
        playerValue = player.getReputation(cond.factionId ?? "");
        break;
      case "item": {
        const stack = player.inventory.resources.find(
          (r) => r.type === (cond.itemId as ResourceType),
        );
        playerValue = stack?.amount ?? 0;
        break;
      }
      default:
        return false;
    }

    switch (cond.comparison) {
      case ">=":
        return playerValue >= cond.value;
      case "<=":
        return playerValue <= cond.value;
      case "==":
        return playerValue === cond.value;
      case ">":
        return playerValue > cond.value;
      default:
        return false;
    }
  }

  private conditionFailMessage(cond: QuestCondition): string {
    switch (cond.type) {
      case "credits":
        return `Недостаточно кредитов. Требуется: ${cond.value}₡.`;
      case "reputation":
        return `Недостаточная репутация с фракцией.`;
      case "item":
        return `Необходимый предмет отсутствует в инвентаре.`;
      default:
        return "Условие не выполнено.";
    }
  }
}
