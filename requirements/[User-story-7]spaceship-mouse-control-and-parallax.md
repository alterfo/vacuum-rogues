# Story Decomposition: Spaceship Mouse Control and Parallax Background

## INVEST Analysis

### Abstract Task

**"Player Ship Movement and Parallax Space Environment Rendering"**

**Analysis Dimensions**:
- **Core Responsibility**: Render a parallax starfield/nebula background and allow the player to control their ship sprite via mouse input.
- **Primary Operations**: Render multi-layer parallax background, display ship sprite, calculate movement vector toward mouse click, rotate ship sprite to face direction, interpolate movement over time.
- **Key Constraints**: Movement must feel smooth (60 FPS); rotation must look natural; parallax layers must scroll at different speeds.
- **Technical Complexity**: Low — PixiJS sprite manipulation and simple vector math.
- **Business Complexity**: Low — clear visual and control requirements from GDD.

### INVEST Evaluation

- ✅ **Independent**: Builds on Story-1 (PixiJS renderer) but can be developed in parallel by a different developer; only requires the Scene base class.
- ✅ **Negotiable**: Exact parallax speeds, ship acceleration curve, and rotation speed are open to discussion.
- ✅ **Valuable**: First interactive gameplay moment — player can move a ship in space, creating immediate immersion.
- ✅ **Estimable**: 2–3 days for a frontend developer familiar with PixiJS.
- ✅ **Small**: Two core functional points (parallax background rendering, mouse-driven ship movement).
- ✅ **Testable**: Ship position, rotation angle, and parallax layer offsets are measurable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — parallax background and ship movement are tightly coupled in the "space scene" experience.

---

## [STORY-001-007] Spaceship Mouse Control and Parallax Background

### Background

The GDD describes the opening game experience as "a ranger in space" — the player sees their ship against a dynamic starfield and can direct movement with the mouse. This story delivers that first interactive moment. The parallax background creates depth with multiple layers (distant stars, nebulae) scrolling at different speeds. The ship responds to mouse clicks by calculating a movement vector, rotating to face the target, and gliding toward it with smooth acceleration.

Key points:
- This is the first player-facing gameplay feature after the renderer is established.
- The parallax system will be reused in the Star Map scene (Phase 1).
- Ship movement logic (vector interpolation, rotation) is foundational for tactical combat positioning.

### Business Value

- Deliver the first interactive gameplay moment, proving the game is playable.
- Create immediate sci-fi immersion through dynamic space visuals.
- Establish movement and rotation primitives reused in combat and navigation.

### Dependencies and Assumptions

- **Prerequisites**: Story-1 (PixiJS renderer and scene system) is complete; a scene can be mounted and updated.
- **Data assumptions**: Ship sprite and parallax background assets (tileable starfield, nebula textures) are available.
- **Integration points**: The ship movement system will later integrate with the Star Map (Story-9) and Combat System (Story-11).
- **Business constraints**: Movement must feel responsive on both mouse and touch devices.

### Scope In

- Render a multi-layer parallax background (at least 3 layers: distant stars, mid-range nebulae, nearby dust) that scrolls continuously.
- Display the player ship sprite centered on the scene.
- When the player clicks (or taps) on the scene, calculate the target world coordinate.
- Rotate the ship sprite to face the target direction.
- Move the ship toward the target with smooth interpolation (acceleration and deceleration).
- Stop the ship when it reaches the target (within a small tolerance).
- Support continuous updates: if the player holds the mouse button, the ship follows the cursor.

### Scope Out

- Camera following the ship (camera is static for this story).
- Collision detection with other objects.
- Ship statistics (speed, agility) affecting movement — fixed values are used.
- Sound effects for engine thrust.

### Acceptance Criteria (ACs)

#### AC1: Parallax Background Rendering
**Given** the space scene is active
**When** the game loop updates
**Then** at least 3 parallax layers are visible, each scrolling at a distinct speed, creating a sense of depth

#### AC2: Ship Appears on Scene
**Given** the space scene is loaded
**When** the scene mounts
**Then** the player ship sprite is visible in the center of the screen

#### AC3: Ship Moves to Clicked Point
**Given** the ship is stationary at coordinate (400, 300)
**When** the player clicks at coordinate (600, 300)
**Then** the ship begins moving toward (600, 300) and arrives within 2 seconds

#### AC4: Ship Rotates Toward Target
**Given** the ship is facing upward (0 degrees)
**When** the player clicks to the right of the ship
**Then** the ship rotates clockwise to face the target direction, and the rotation completes before or during movement

#### AC5: Smooth Movement Interpolation
**Given** the ship is moving toward a distant target
**When** observed over time
**Then** the ship accelerates from rest, maintains speed, and decelerates as it approaches the target, stopping smoothly within 10 pixels

#### AC6: Touch Input Support
**Given** the player is on a touch-enabled device
**When** the player taps on the scene
**Then** the ship moves toward the tapped point exactly as it would with a mouse click

#### Non-Functional Expectations
- Parallax scrolling must maintain 60 FPS without frame drops.
- Ship rotation must complete within 300 ms for a 90-degree turn.
- Movement calculations must support screen resolutions from 1024×768 to 2560×1440.
