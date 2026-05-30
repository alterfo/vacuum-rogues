# Story Decomposition: Generative NPC Dialogues with Context and Fallback

## INVEST Analysis

### Abstract Task

**"AI-Generated NPC Dialogues Using ONNX Models with Context Awareness and Template Fallback"**

**Analysis Dimensions**:
- **Core Responsibility**: Generate unique NPC dialogue responses based on player context (reputation, location, resources) using an ONNX dialogue model, with automatic fallback to templates when model confidence is low.
- **Primary Operations**: Build context prompt, run ONNX inference, parse response, generate player reply options, validate confidence, fallback to templates.
- **Key Constraints**: Inference must complete within 3 seconds; fallback must be seamless; context must include relevant game state.
- **Technical Complexity**: High — ONNX integration, prompt engineering, confidence thresholds.
- **Business Complexity**: Medium — narrative consistency and player agency.

### INVEST Evaluation

- ✅ **Independent**: Builds on Stories 2 and 6 (ONNX infrastructure) but can be developed in parallel; only requires a dialogue model.
- ✅ **Negotiable**: Confidence threshold, context fields, and fallback template selection are discussable.
- ✅ **Valuable**: Unique, context-aware dialogues dramatically increase immersion and replayability.
- ✅ **Estimable**: 4–5 days for a developer familiar with ONNX and NLP basics.
- ✅ **Small**: Three core functional points (context building, inference with fallback, reply generation).
- ✅ **Testable**: Response content, confidence values, and fallback triggers are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — context building, inference, and fallback form a single dialogue generation loop.

---

## [STORY-002-016] Generative NPC Dialogues with Context and Fallback

### Background

The GDD describes Phase 2 as "Living Galaxy," where NPCs respond uniquely based on the player's history. This story implements the generative dialogue system: when the player talks to an NPC, the game builds a context string (player reputation with the NPC's faction, current system, inventory, recent actions), sends it to the ONNX dialogue model, and displays the generated response. If the model returns low confidence (<0.5), the game seamlessly falls back to a pre-written template. The player is then offered generated reply options.

Key points:
- This is the flagship AI feature of Phase 2.
- Context awareness makes each playthrough feel unique.
- Fallback ensures the game never breaks even if the model fails.

### Business Value

- Deliver the core "AI-driven narrative" selling point of the game.
- Increase replayability through unique, context-sensitive conversations.
- Maintain narrative coherence even when AI generation is uncertain.

### Dependencies and Assumptions

- **Prerequisites**: Stories 2 (ONNX Worker inference) and 6 (model loading) are complete; a dialogue ONNX model is available.
- **Data assumptions**: Template dialogue library exists for fallback scenarios.
- **Integration points**: Reputation system (Story-20) provides faction standing; quest system (Story-13) provides active quests.
- **Business constraints**: Inference must complete within 3 seconds; fallback must be instant.

### Scope In

- Build a context string from: NPC type, player reputation with NPC's faction, current system name, active quests, recent player actions.
- Send context to the ONNX dialogue model via the AI Worker.
- Parse the model output into NPC response text and 2–4 player reply options.
- Display the generated response and options in the dialogue UI.
- Measure model confidence (via output logits or a dedicated confidence head).
- If confidence < 0.5, replace the generated response with a matching template from the template library.
- If the model fails (timeout, error), automatically fall back to templates without player-visible interruption.
- Log fallback events for analytics.

### Scope Out

- Quest generation via dialogue — covered in Story-17.
- Adaptive quality disabling on weak devices — covered in Story-18.
- Full emotional state tracking for NPCs — Phase 3.

### Acceptance Criteria (ACs)

#### AC1: Context-Aware Greeting
**Given** the player's reputation with the Malak faction is -50
**When** the player starts dialogue with a Malak trader
**Then** the model generates a hostile greeting (e.g., "Ты здесь не желан, человек. Говори быстро.") that references the negative reputation

#### AC2: Generated Reply Options
**Given** the NPC has generated a response
**When** the dialogue UI updates
**Then** 2–4 reply options are displayed, each offering a distinct tone or approach (e.g., aggressive, diplomatic, trade-focused)

#### AC3: High Confidence Response
**Given** the model returns a response with confidence 0.75
**When** the game processes the response
**Then** the generated text is displayed directly without fallback

#### AC4: Low Confidence Fallback
**Given** the model returns a response with confidence 0.35
**When** the game processes the response
**Then** a pre-written template matching the context is displayed instead (e.g., a standard trader greeting), and the event is logged

#### AC5: Model Error Fallback
**Given** the ONNX model throws an inference error or times out
**When** the dialogue system catches the error
**Then** a template response is displayed within 500 ms, and the player sees no error message

#### AC6: Context Building
**Given** the player is in system "Nexus", has reputation -50 with Malaks, and is carrying 100 ore
**When** dialogue context is built
**Then** the context string includes all three facts in a structured format readable by the model

#### Non-Functional Expectations
- Dialogue generation must complete within 3 seconds on a mid-tier device.
- Fallback to templates must occur within 500 ms.
- The dialogue UI must remain responsive during inference (handled by Story-2 Web Worker).
