# Presentation Layer Rules

PixiJS scenes, sprites, rendering, input. No hardcoded pixel coords for hit detection — use
`eventMode='static'` + handlers, position UI in world/relative coords. Always
`event.stopPropagation()` in UI click handlers over gameLayer/stage.

Three most-hit PixiJS 8 traps:
- **`eventMode='none'` on Text over clickable areas** — Text defaults to `'auto'` and blocks
  clicks underneath; set `'none'` on labels so clicks pass through.
- **A Container whose children are ALL `eventMode='none'` needs an explicit `hitArea`**
  (`new Rectangle(...)`) — otherwise the event boundary prunes them and the button is
  mouse-dead even with `eventMode='static'`. Root cause of the 2026-06-10 regression.
- **Graphics mask must be `addChild()`'d to the masked object BEFORE assigning `.mask`** —
  else the mask is ignored (planets render as rectangles). A `TilingSprite` drops a child
  mask: wrap it + mask in a plain Container.

Full rule list (Rules 1–9, mouse-button codes, custom-filter `vTextureCoord`/equirect
gotchas), Scene Lifecycle, and Planet Backdrop / lazy-texture conventions: see `pixi-rules.md`.
