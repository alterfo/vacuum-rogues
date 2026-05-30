# Story Decomposition: Inventory and Ship Module Management

## INVEST Analysis

### Abstract Task

**"Player Inventory and Ship Module Equipping System"**

**Analysis Dimensions**:
- **Core Responsibility**: Allow the player to view their inventory, see equipped ship modules, and swap modules between inventory slots and ship slots.
- **Primary Operations**: Display inventory grid, display ship module slots (weapons, shield, engine, scanner), drag-and-drop or click-to-swap modules, update ship stats on swap.
- **Key Constraints**: Module swaps must be reversible; stats must update immediately.
- **Technical Complexity**: Low-Medium — UI grid layout, stat recalculation.
- **Business Complexity**: Low — clear equip/unequip rules.

### INVEST Evaluation

- ✅ **Independent**: Can be developed with mock items; does not require combat, dialogue, or save systems.
- ✅ **Negotiable**: UI layout, drag-and-drop vs. click-to-swap, and stat display format are discussable.
- ✅ **Valuable**: Core RPG progression — players improve their ship through loot and upgrades.
- ✅ **Estimable**: 2–3 days for a frontend developer.
- ✅ **Small**: Two core functional points (inventory view, module swapping).
- ✅ **Testable**: Inventory contents, equipped modules, and ship stats are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — inventory and equipment are tightly coupled in the "ship loadout" experience.

---

## [STORY-001-014] Inventory and Ship Module Management

### Background

The GDD describes a modular ship system where the player equips weapons, shields, engines, and scanners. This story delivers the inventory and ship module UI: viewing inventory contents, seeing currently equipped modules, and swapping modules. When a module is equipped, the ship's stats (attack, defense, speed, scanning range) update immediately.

Key points:
- This is the primary character progression UI of MVP1.
- Module stats will affect combat (Story-11) and exploration.
- The inventory will receive items from combat loot (Story-12) and quest rewards (Story-13).

### Business Value

- Provide tangible character progression through equipment upgrades.
- Create strategic decisions about which modules to equip for different situations.
- Establish the item system foundation for crafting (Phase 2).

### Dependencies and Assumptions

- **Prerequisites**: Story-1 (PixiJS renderer and scene system) is complete.
- **Data assumptions**: Module items have defined stats (attack, defense, speed, scan range) and slot types (weapon, shield, engine, scanner).
- **Integration points**: Combat system (Story-11) uses equipped weapon stats; save system (Story-14) persists inventory state.
- **Business constraints**: Inventory must support at least 50 items; module swaps must not destroy items.

### Scope In

- Display the inventory as a grid of item icons with names and quantities.
- Display the ship's module slots: Weapons (2 slots), Shield (1), Engine (1), Scanner (1).
- Show currently equipped modules in each slot with their stats.
- Allow the player to swap an inventory module into a ship slot.
- The previously equipped module moves back to inventory.
- Validate slot compatibility (e.g., a shield cannot go into a weapon slot).
- Update ship stats immediately when a module is swapped.
- Display total ship stats (attack, defense, speed, scan range) in the ship panel.
- Tooltips on hover showing module details.

### Scope Out

- Drag-and-drop interaction (click-to-swap is sufficient for MVP1).
- Module crafting or upgrading — Phase 2.
- Item sorting, filtering, or stacking logic beyond simple quantity.
- Cargo hold vs. equipped modules distinction (all items are in one inventory for now).

### Acceptance Criteria (ACs)

#### AC1: Inventory Display
**Given** the player has 5 items in inventory
**When** the player opens the inventory panel
**Then** all 5 items are visible as icons with names and quantities

#### AC2: Ship Module Slots
**Given** the ship has a weapon "Лазер Мк.I" equipped
**When** the player opens the ship panel
**Then** the weapon slot shows "Лазер Мк.I" with attack stat +10, and other slots show their equipped modules or "Пусто"

#### AC3: Module Swap
**Given** the inventory contains "Гамма-3" (attack +25) and the weapon slot has "Лазер Мк.I" (attack +10)
**When** the player selects "Гамма-3" and clicks the weapon slot
**Then** "Гамма-3" moves to the weapon slot, "Лазер Мк.I" moves to inventory, and ship attack increases from +10 to +25

#### AC4: Slot Compatibility Validation
**Given** the player attempts to equip a shield module into a weapon slot
**When** the action is attempted
**Then** the game prevents the swap and displays: "Этот модуль нельзя установить в данный слот"

#### AC5: Stat Update
**Given** the ship has total attack 20, defense 15, speed 8
**When** the player equips a new engine module that adds +3 speed
**Then** the ship stats display updates to attack 20, defense 15, speed 11

#### AC6: Tooltip Display
**Given** the player hovers over a module in inventory
**When** the hover persists for 500 ms
**Then** a tooltip appears showing module name, type, and all stats

#### Non-Functional Expectations
- Inventory panel must open within 200 ms.
- Module swap must complete instantly (<100 ms).
- UI must be readable at 1024×768 resolution.
