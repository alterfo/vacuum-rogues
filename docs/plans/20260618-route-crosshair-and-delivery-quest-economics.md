---
# Hide Heading Crosshair on Route Flight + Make Delivery Quests Profitable

## Overview
Two playtest issues. **(A) Redundant crosshair.** The pulsing heading crosshair is
shown whenever the ship is moving, including while auto-flying a clicked route — where
the dashed route line + destination marker already show where you're going, so the
crosshair is just noise. Hide it during route flight. **(B) Loss-making delivery
contracts.** "Местный подряд" tells the player to *buy* a good on the market and deliver
it, but pays a flat 120–220 credits regardless of cost. Buying 8 crystals (~250/unit
base) costs ~2000 and consumes them from the hold on completion, for a 241-credit
reward — a net loss, which makes the quest pointless. The reward must cover the goods'
purchase cost plus a margin so the contract is actually worth taking.

## Context
- **Crosshair:** `src/presentation/flight/PlayerShipRenderer.ts` — `targetIndicator`
  (L45), shown in `updateTargetIndicator` (~L259–268) whenever
  `shipPhysics.isMoving && distance > 20`. No awareness of route vs single-point move.
- **Route signal:** `src/systems/ShipPhysics.ts` — `flyThroughWaypoints()` (L53) queues
  waypoints; the route line is drawn by `RouteRenderer`. A "following a route" state can
  be derived from the queued waypoints / an active destination.
- **Loss-making quest:** `src/systems/quests/QuestGenerator.ts` `buildLocalDelivery`
  (L855–894) — `objectives: [{ type: "COLLECT_ITEM", targetAmount: rng.nextInt(4,10),
  itemType: cargo.resource }]`, `reward: { credits: rng.nextInt(120,220), ... }`. The
  reward ignores `cargo` cost and `targetAmount`.
- **Base prices:** `TradeSystem.getBasePrice(resource)` is public (base credit value per
  resource); or a shared base-price table. `pickCargo(rng)` returns `{ resource, label }`.
- **Existing test:** `src/tests/quests/localDeliveryQuest.test.ts` — may assert the old
  flat reward; changing the reward could red it (handle per repo rule, below).

## Development Approach
- **Testing approach: TDD / regression-first.** Reward math + crosshair gating are
  unit-testable; the crosshair-hidden-on-route behaviour is also screenshot/e2e-verified
  (green text tests are not sufficient for visual per repo rule).
- ⚠️ If the existing `localDeliveryQuest.test.ts` asserts the old 120–220 reward, that
  assertion encodes the *broken* economics. Do NOT silently weaken it — STOP and flag
  for review; the user authorizes updating it to the new profitable model (the whole
  point of this fix), then it's adapted.
- Do not modify other existing test assertions; add new tests. One concern per task.

## Testing Strategy
- Unit: crosshair hidden while a route is active, shown for a bare point-move (if kept);
  local-delivery reward ≥ `targetAmount × basePrice(cargo) × (1 + minMargin)` for every
  cargo type → the contract is always profitable.
- E2E/regression: fly a route and assert the crosshair Graphics is not visible.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers (esp. the reward test). Keep this file in sync.

## Implementation Steps

### Task 1: Hide the heading crosshair during route flight
**Files:**
- Modify: src/systems/ShipPhysics.ts (expose a `isFollowingRoute`/`hasQueuedRoute` flag
  derived from queued waypoints / active destination)
- Modify: src/presentation/flight/PlayerShipRenderer.ts (`updateTargetIndicator` hides
  the crosshair when a route is active)
- Create: src/tests/flight/routeCrosshair.test.ts

- [x] add the route-active signal to `ShipPhysics`
- [x] crosshair `visible = isMoving && distance > 20 && !route-active`
- [x] write tests: route active → crosshair hidden; (non-route move → unchanged)
- [x] run affected tests — must pass before next task

### Task 2: Local-delivery reward covers goods cost + margin
**Files:**
- Modify: src/systems/quests/QuestGenerator.ts (`buildLocalDelivery`: reward.credits =
  `round(basePrice(cargo.resource) × targetAmount × REWARD_MARGIN)`, with `REWARD_MARGIN`
  ≥ ~1.4 so buying near base price still nets profit; clarify the description text)
- Modify: src/config/balance.ts (add `LOCAL_DELIVERY_REWARD_MARGIN`)
- Create/Modify: src/tests/quests/localDeliveryReward.test.ts (new); adapt
  `localDeliveryQuest.test.ts` only under the ⚠️ waiver above

- [x] compute reward from `targetAmount` × base price × margin; compute `targetAmount`
      once and reuse it for both the objective and the reward
- [x] description reflects a real (small) profit, not "платят немного" implying a loss
- [x] write test: for every cargo type, reward.credits ≥ targetAmount × basePrice (the
      contract never loses money at base price)
- [x] ⚠️ if `localDeliveryQuest.test.ts` reds on the flat-reward assertion, STOP and flag;
      after authorization, update it to the profitable model — N/A: the existing test only
      asserts copy + mechanics (not the flat 120–220 reward), so it stayed green; no waiver
      needed and no existing assertion was changed
- [x] run affected tests — must pass before next task

### Task 3: Verify acceptance criteria
- [ ] verify Overview: no crosshair while flying a route; local-delivery contracts pay
      at least the goods' cost plus a margin
- [ ] run full unit suite — all green
- [ ] run `npm run test:e2e:regression`
- [ ] run `npm run lint` — clean
- [ ] confirm no existing test assertions changed except the authorized reward one

## Technical Details
- **Crosshair:** the route line (`RouteRenderer`) already communicates the destination,
  so the crosshair is redundant on a route. If it's *only* ever shown during navigation,
  gating it off on route flight effectively retires it — which matches the request.
- **Reward:** anchor to base price (stable, deterministic) not live market price, so the
  reward is reproducible and can't be gamed by market swings; `REWARD_MARGIN` guarantees
  profit even when the player buys somewhat above base. Keep `experience` as-is.

## Post-Completion
**Manual verification:** fly a route and confirm no crosshair appears; accept a "Местный
подряд", buy the cargo, deliver it, and confirm credits end up higher than what you paid.
