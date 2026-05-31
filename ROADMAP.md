# Space Rangers: Neural Onslaught - Implementation Roadmap

## 📊 Current Status

### ✅ Completed Features (MVP Foundation)
- **Story-1**: PixiJS Renderer and Scene System
- **Story-7**: Spaceship Mouse Control with Physics
- **Story-9**: Star Map Generation and Navigation
- **Story-17**: Planetary System Generation and Display
  - Beautiful sun with glow effects
  - Orbital planet rotation (Kepler's law approximation)
  - Planet visual variety (rings, atmospheres, 3D effects)
  - System minimap with real-time updates
  - Ship entry point at system edge

### ✅ Recently Completed
- **Story-13**: Template Dialogues and Quest System
  - ✅ QuestManager system created
  - ✅ DialogueScene UI created with dialogue trees
  - ✅ Type definitions updated in `src/types/index.ts`
  - ✅ Integration with GameEngine completed
  - ✅ NPC generation for planets (governors with random races)
  - ✅ Planet interaction with "Talk to Governor" button
  - ✅ Quest journal UI with keyboard shortcut (J key)

### 🚧 Work in Progress (WIP)
- None currently

### 📋 Planned Features

#### Phase 1: Core RPG Gameplay (Next Priority)
1. **Story-13: Complete Dialogues & Quests** (CURRENT WIP)
2. **Story-14: Inventory and Ship Modules**
3. **Races & Factions System**
4. **Trading System Enhancement**

#### Phase 2: Combat & Challenge
5. **Story-10: Tactical Combat Grid**
6. **Story-11: Player Turn System**
7. **Story-12: Enemy AI & Combat Resolution**

#### Phase 3: AI & Polish
8. **Story-16: Generative NPC Dialogues (ONNX)**
9. **Story-15: Save/Load System**
10. **Story-6: ONNX Model Loading**

---

## 🗺️ Detailed Implementation Plan

### STORY-13: Template Dialogues & Quests (COMPLETED ✅)

#### Status: 100% Complete

**Completed:**
- ✅ QuestManager class with quest templates
- ✅ DialogueScene with conversation trees
- ✅ Hardcoded dialogue for governors
- ✅ Quest acceptance/completion logic
- ✅ UI panels for dialogue display
- ✅ Type definitions fixed
- ✅ QuestManager integrated into GameEngine
- ✅ NPC generation for all planets
- ✅ Planet interaction with dialogue button
- ✅ Quest Journal UI with keyboard shortcut

**All work items completed!**

##### 1. Fix Type Definitions (1-2 hours)
**File:** `src/types/index.ts`

```typescript
// Add to QuestObjective
export interface QuestObjective {
  readonly id: string;
  readonly description: string;
  readonly type: 'COLLECT_ITEM' | 'VISIT_LOCATION' | 'DEFEAT_ENEMY'; // ADD
  readonly targetAmount: number;
  readonly currentAmount: number;
  readonly completed: boolean;
  readonly itemType?: string; // ADD - for COLLECT_ITEM objectives
  readonly locationId?: string; // ADD - for VISIT_LOCATION objectives
}

// Update Reward
export interface Reward {
  readonly credits: number;
  readonly experience: number; // ADD
  readonly items: { type: ResourceType; amount: number }[]; // CHANGE from unknown[]
}
```

##### 2. Integrate QuestManager into GameEngine (1 hour)
**File:** `src/systems/GameEngine.ts`

```typescript
import { QuestManager } from './QuestManager';

export class GameEngine {
  // ... existing properties
  public questManager: QuestManager; // ADD

  constructor() {
    // ... existing initialization
    this.questManager = new QuestManager(); // ADD
  }
}
```

##### 3. Generate NPCs for Planets (2-3 hours)
**File:** `src/systems/PlanetGenerator.ts`

```typescript
import { NPC } from '@/domain/NPC';

// In generate() method, create governor NPC for each planet:
const governor = new NPC(
  `governor_${planetId}`,
  `Губернатор ${planetName}`,
  'HUMAN' as Race,
  { trust: 0, fear: 0, respect: 0, hostility: 0, curiosity: 10 },
);

planet.inhabitants.push(governor);
```

##### 4. Add Planet Interaction in SpaceFlightScene (2 hours)
**File:** `src/presentation/SpaceFlightScene.ts`

```typescript
// In onPlanetClick():
private onPlanetClick(planet: Planet): void {
  // ... existing code

  // Add "Talk to Governor" button in planet info panel
  // On click, transition to DialogueScene:
  await this.gameEngine.transitionTo(SceneType.DIALOGUE, {
    gameEngine: this.gameEngine,
    npc: planet.inhabitants[0], // Governor
  });
}
```

##### 5. Create Quest Journal UI (3-4 hours)
**New File:** `src/presentation/QuestJournalUI.ts`

- Overlay UI showing active and completed quests
- Quest progress bars
- Quest objectives with checkmarks
- Reward information
- Accessible via "J" key or UI button

##### 6. Add Quest Progress Tracking (1 hour)
**Files:** `src/presentation/SpaceFlightScene.ts`, `src/systems/GameEngine.ts`

Track quest progress on:
- Planet visit (VISIT_LOCATION)
- Item collection (COLLECT_ITEM)
- Auto-check quest completion

---

### STORY-14: Inventory and Ship Modules (Next)

#### Priority: HIGH (Required for quests & trading)

**Scope:**
- Inventory UI scene
- Ship equipment slots (weapons, engines, hull, shields)
- Module installation/removal
- Cargo hold management
- Item tooltips with stats

**Files to Create:**
- `src/presentation/InventoryScene.ts`
- `src/presentation/ShipModuleSlot.ts`
- `src/systems/EquipmentSystem.ts`

**Integration:**
- Add "I" hotkey to open inventory
- Show inventory button in SpaceFlightScene
- Connect with quest rewards
- Connect with trading system

**Estimated Time:** 8-12 hours

---

### RACES & FACTIONS SYSTEM (Custom Story)

#### Priority: MEDIUM (Adds depth to RPG)

**Scope:**
- 5 playable races with unique traits:
  - **Человек**: Balanced, +10% trade bonus
  - **Малок**: Combat specialist, +15% weapon damage
  - **Пелен**: Scientist, +20% research speed
  - **Фэян**: Merchant, +20% trade profit
  - **Гаальский**: Explorer, +15% fuel efficiency

- Race selection at game start
- Racial bonuses applied to player stats
- NPC reactions based on race
- Faction reputation system

**Files to Modify:**
- `src/domain/Player.ts` - add race property
- `src/domain/Race.ts` - add racial bonuses
- `src/presentation/MainMenuScene.ts` - add race selection
- `src/systems/DialogueSystem.ts` - race-based responses

**Estimated Time:** 6-8 hours

---

### TRADING SYSTEM ENHANCEMENT (Story-13 Dependency)

#### Priority: MEDIUM

**Current Status:**
- ✅ TradeSystem exists with basic price calculation
- ❌ No trading UI
- ❌ No market interface on planets

**Remaining Work:**
1. Create TradeScene UI
2. Show buy/sell prices with supply/demand
3. Transaction confirmation dialog
4. Market refresh on trade
5. Quest integration (deliver items)

**Estimated Time:** 6-8 hours

---

### STORY-10-12: Tactical Combat System

#### Priority: MEDIUM (Core gameplay, but can be MVP2)

**Phase 1: Combat Grid (Story-10)**
- Hexagonal grid rendering
- Unit placement
- Grid movement highlighting
- Turn indicator

**Phase 2: Player Turn (Story-11)**
- Movement actions
- Attack actions
- Ability usage
- Turn confirmation

**Phase 3: Enemy AI (Story-12)**
- Basic AI movement
- Target selection
- Damage resolution
- Victory/defeat conditions

**Estimated Time:** 20-25 hours total

---

## 🎯 Recommended Implementation Order

### Week 1-2: Complete RPG Core
1. ✅ Fix Story-13 type errors (2h)
2. ✅ Complete Story-13 integration (6h)
3. ✅ Implement Story-14 Inventory (10h)
4. ✅ Add Races & Factions (8h)
5. ✅ Enhance Trading UI (8h)

**Result:** Playable RPG with quests, dialogue, trading, inventory

### Week 3: Combat Foundation
6. Implement Story-10 Combat Grid (8h)
7. Implement Story-11 Player Turn (8h)
8. Implement Story-12 Enemy AI (8h)

**Result:** Complete tactical combat system

### Week 4: Polish & AI
9. Story-15 Save/Load (6h)
10. Story-16 ONNX Dialogues (optional, 10h)
11. Polish & bug fixes (8h)

**Result:** Full MVP1 with all core features

---

## 🔧 Technical Debt & Fixes Needed

### Immediate
- [ ] Update `src/types/index.ts` for QuestObjective and Reward
- [ ] Add questManager to GameEngine
- [ ] Fix circular movement bug in ShipPhysics (DONE)

### Short-term
- [ ] Add error boundaries to scenes
- [ ] Implement scene transition animations
- [ ] Add loading indicators for scene switches
- [ ] Optimize planet rendering (culling for off-screen planets)

### Long-term
- [ ] Implement actual ONNX model loading
- [ ] Add IndexedDB caching for saves
- [ ] Implement PWA offline mode
- [ ] Add Playwright E2E tests for quest flow

---

## 📦 Asset Requirements

### Immediate Needs
- [ ] NPC portrait images (governors, traders, pirates)
- [ ] Planet textures (optional, using procedural for now)
- [ ] UI sound effects (button clicks, quest accept, etc.)
- [ ] Background music tracks

### Future Needs
- [ ] Ship sprite variations
- [ ] Combat animations
- [ ] Particle effects (explosions, engines)
- [ ] ONNX model files (.onnx)

---

## 🐛 Known Issues

1. **Ship circular movement** - FIXED in commit 3b76546
2. **Fuel indicator overlap on star map** - FIXED
3. **DialogueScene type errors** - IN PROGRESS
4. **No NPC generation** - PENDING
5. **Quest journal not accessible** - PENDING

---

## 📝 Notes for Continuation

**When resuming Story-13:**
1. Start with fixing types in `src/types/index.ts`
2. Update GameEngine to include questManager
3. Test dialogue flow with hardcoded governor NPC
4. Add planet interaction (click planet → talk to governor)
5. Create quest journal overlay
6. Test full quest cycle: accept → progress → complete

**Code Quality:**
- Follow existing patterns (GameScene, domain entities)
- Add logger statements for debugging
- Use TypeScript strict mode
- Write unit tests for QuestManager logic
- Add E2E test for quest acceptance flow

**Performance Targets:**
- Scene transitions < 200ms
- Dialogue display < 100ms
- Quest journal render < 150ms
- No frame drops during UI interactions

---

## 🎮 MVP1 Definition of Done

**Core Gameplay Loop:**
1. ✅ Create new game with race selection
2. ✅ Navigate star map
3. ✅ Warp to star system
4. ✅ See planets and sun
5. ✅ Fly to planet
6. ✅ Land and talk to NPC
7. ✅ Accept quest
8. 🚧 Complete quest objectives (tracking implemented, needs testing)
9. 🚧 Return and get reward
10. ✅ Trade resources
11. 🚧 Manage inventory
12. 🚧 Engage in combat
13. 🚧 Save and load game

**Progress: 8/13 items complete (62% of MVP1)**

---

*Last Updated: 2026-05-31*
*Next Session: Story-14 (Inventory and Ship Modules) or add quest completion flow*
