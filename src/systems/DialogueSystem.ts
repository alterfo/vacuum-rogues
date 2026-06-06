import type { DialogueOption, NPCResponse, EmotionVectorData } from "@/types";
import type { Player } from "@/domain/Player";
import type { NPC } from "@/domain/NPC";
import { DialogueSession } from "@/domain/DialogueSession";
import { EmotionVector } from "@/domain/EmotionVector";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import { ONNXModelRegistry } from "@/ai/ONNXModelRegistry";
import { logger } from "@/utils/logger";
import { GameValidationException } from "@/exceptions/GameValidationException";

export interface DialogueAnchorRegistry {
  getOpeningAnchor(
    npc: NPC,
    reputation: number,
    questState: unknown,
  ): DialogueAnchorNode | null;
  getNextAnchors(
    currentNodeId: string,
    emotion: EmotionVectorData,
  ): DialogueAnchorNode[];
}

export interface DialogueAnchorNode {
  readonly id: string;
  readonly template: string;
  readonly options: DialogueOption[];
}

export class T5DialogueAdapter {
  constructor(_registry: ONNXModelRegistry) {}

  async generateResponse(prompt: string): Promise<string> {
    // Placeholder: actual T5 inference would construct tensors and call registry.infer
    logger.debug(`T5 generateResponse called with prompt: ${prompt}`);
    return `Generated response for: ${prompt}`;
  }
}

export class GRUEmotionAdapter {
  constructor(_registry: ONNXModelRegistry) {}

  async infer(
    _context: unknown,
    _history: unknown[],
  ): Promise<EmotionVectorData> {
    // Placeholder: actual GRU inference
    logger.debug("GRU infer called");
    return new EmotionVector({
      trust: 10,
      fear: -5,
      respect: 5,
      hostility: -10,
      curiosity: 15,
    }).toData();
  }
}

export class DialogueSystem {
  private anchorRegistry: DialogueAnchorRegistry;
  private t5Adapter: T5DialogueAdapter;
  private gruAdapter: GRUEmotionAdapter;
  private sessionHistory = new Map<string, DialogueSession>();
  private qualityProfile: AdaptiveQualityProfile;

  constructor(
    anchorRegistry: DialogueAnchorRegistry,
    t5Adapter: T5DialogueAdapter,
    gruAdapter: GRUEmotionAdapter,
    qualityProfile: AdaptiveQualityProfile,
  ) {
    this.anchorRegistry = anchorRegistry;
    this.t5Adapter = t5Adapter;
    this.gruAdapter = gruAdapter;
    this.qualityProfile = qualityProfile;
  }

  startDialogue(player: Player, npc: NPC): DialogueSession {
    const sessionId = `dlg_${npc.id}_${Date.now()}`;
    const baseline = new EmotionVector(npc.emotionBaseline);
    const session = new DialogueSession(
      sessionId,
      npc,
      player,
      baseline.toData(),
    );

    // Load historical messages if previous session exists
    const previous = this.sessionHistory.get(npc.id);
    if (previous) {
      session.history.push(...previous.history);
    }

    // Select opening anchor
    const reputation = player.reputation[npc.id] ?? 0;
    const anchor = this.anchorRegistry.getOpeningAnchor(npc, reputation, null);

    if (anchor) {
      session.addNPCResponse(anchor.template);
    }

    this.sessionHistory.set(sessionId, session);
    logger.info(`Dialogue started with NPC ${npc.name}`);
    return session;
  }

  async submitPlayerChoice(
    sessionId: string,
    choice: DialogueOption,
  ): Promise<NPCResponse> {
    const session = this.sessionHistory.get(sessionId);
    if (!session) {
      throw new GameValidationException(
        "DIALOGUE_SESSION_NOT_FOUND",
        `Dialogue session ${sessionId} not found.`,
      );
    }

    session.sendPlayerMessage(choice.text);

    // Update emotion via GRU if profile allows
    let emotionData = session.currentEmotion;
    if (
      this.qualityProfile.level !== ("LOW" as import("@/types").ProfileLevel)
    ) {
      try {
        emotionData = await this.gruAdapter.infer(
          { npc: session.npc, choice },
          session.history,
        );
        session.currentEmotion = emotionData;
      } catch (e) {
        logger.warn("GRU emotion inference failed, using current emotion:", e);
      }
    }

    let responseText: string;
    let confidence = 1.0;

    // Try T5 generation if High profile and model loaded
    if (
      this.qualityProfile.level === ("HIGH" as import("@/types").ProfileLevel)
    ) {
      try {
        const prompt = this.buildPrompt(session, choice);
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("T5 timeout")), 3000),
        );
        responseText = await Promise.race([
          this.t5Adapter.generateResponse(prompt),
          timeoutPromise,
        ]);
        confidence = 0.85;
      } catch (e) {
        logger.warn(
          "T5 generation failed or timed out, falling back to anchors:",
          e,
        );
        confidence = 0.0;
        responseText = "";
      }
    } else {
      confidence = 0.0;
      responseText = "";
    }

    // Fallback to anchors if needed
    if (!responseText || confidence < 0.7) {
      const anchors = this.anchorRegistry.getNextAnchors(
        choice.id,
        emotionData,
      );
      if (anchors.length > 0) {
        responseText = anchors[0].template;
      } else {
        responseText = "...";
      }
    }

    // Apply reputation delta
    const reputationDelta = choice.tags.includes("friendly")
      ? 5
      : choice.tags.includes("hostile")
        ? -5
        : 0;
    session.player.adjustReputation(session.npc.id, reputationDelta);

    session.addNPCResponse(responseText);

    // Prune history if exceeds 50 turns
    while (session.history.length > 50) {
      session.history.shift();
    }

    return {
      text: responseText,
      emotionIndicators: emotionData,
      options: this.getFallbackOptions(session),
      reputationDelta,
    };
  }

  getFallbackOptions(session: DialogueSession): DialogueOption[] {
    const anchors = this.anchorRegistry.getNextAnchors(
      "current",
      session.currentEmotion,
    );
    const options: DialogueOption[] = [];
    for (const anchor of anchors) {
      options.push(...anchor.options);
    }
    return options.slice(0, 4);
  }

  private buildPrompt(
    session: DialogueSession,
    choice: DialogueOption,
  ): string {
    return `Faction: ${session.npc.race ?? "Unknown"}, Tone: friendly, Context: ${choice.text}`;
  }
}
