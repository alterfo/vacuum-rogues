# EPIC-010: Visual & Controls Polish

> Canon: SOURCE-OF-TRUTH §3, §5 (faction names), §11.8 (ranks)  
> Status: **In Progress**

## Goal

Ensure the game is playable, navigable, and visually correct:
- Camera control (pan, zoom, minimap)
- Scene navigation completeness (no dead-ends, no English strings)
- Correct data display (factions, micromodule names)
- Loading feedback, trade quality, combat rendering

## User Stories

| ID | Title | Priority | UX Source | Status |
|----|-------|----------|-----------|--------|
| [US-071](../user-stories/US-071-free-pan-during-turn.md) | Free pan during turn | High | A3 | Planned |
| [US-072](../user-stories/US-072-minimap-center-on-player.md) | Camera return button on minimap | High | A8 | Planned |
| [US-073](../user-stories/US-073-moon-z-order.md) | Moons behind planet (z-depth) | Medium | — | Planned |
| [US-075](../user-stories/US-075-visual-assets.md) | Quality visual assets | Medium | — | Planned |
| [US-076](../user-stories/US-076-loading-state-transitions.md) | Loading state during transitions | High | H2 | Planned |
| [US-077](../user-stories/US-077-starmap-initial-zoom.md) | Star map zoom-to-fit on open | **Critical** | C1 | Planned |
| [US-078](../user-stories/US-078-ui-localisation-consistency.md) | Localisation consistency (no English strings) | **Critical** | C5 | Planned |
| [US-079](../user-stories/US-079-navigation-dead-ends.md) | Fix navigation dead-ends | **Critical** | C4, H9, H11 | Planned |
| [US-081](../user-stories/US-081-main-menu-quality.md) | Main menu quality fixes | High | H1 | Planned |
| [US-083](../user-stories/US-083-station-scene-quality.md) | Station scene quality fixes | **Critical** | C2, H12 | Planned |
| [US-084](../user-stories/US-084-planet-info-fixes.md) | Planet info faction display | High | H4 | Planned |

## Coding Rules for This Epic

- No `BlurFilter` on objects inside `gameLayer` (creates rectangular artefacts under camera scale)
- Procedural effects via `Graphics` concentric rings or GLSL Filter
- Moon z-order: two layers `backMoonsLayer` / `frontMoonsLayer` in `gameLayer`
- Minimap buttons: `stopPropagation()` mandatory
- All player-visible strings must be in Russian — no English titles or labels
- Faction names displayed via `FACTION_LABEL` map, never hardcoded strings

## Out of Scope (deferred to EPIC-011 / Sprint 3+)

- Tooltip on hover (US-077 tooltip variant → separate sprint)
- Trade price history sparkline
- NPC captain ranking
