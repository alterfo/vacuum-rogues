# overlap-detect

Pixel-level UI defect finder on OpenCV (gocv). Reads game screenshots, reports geometry/colour collisions that vision-language models miss.

## Checks (default)

| kind | catches |
|---|---|
| `overlap` | one connected ink blob holding two text hues >= 30 degrees apart (orange subtitle on a cyan title; cyan "[Груз…]" fused with green-cyan "[Система…]") |
| `frame-crossing` | two bordered rectangles intersect without one containing the other (close button sticking out of its panel, a row running out of its card) |
| `text-crossing-frame` | a text run crosses a frame border (adjacent buttons colliding) |
| `frame-between-text` | a small bordered box (the ✕ button) sits inside a text line with text on both sides |
| `uneven-gap` | in a stack of same-width cards one gap differs from the typical gap by >= 25% and >= 3 px; gaps holding a section heading are ignored |
| `misaligned-sibling` | same-sized siblings in a row, one off the common top edge by 2-8 px |
| `text-touches-border` | text ink within 3 px of its container's left or right edge |

## Flags

- `-solids`: `solid-over-text`, a solid shape (arrow, bar) with text ink touching it. Finds the ▼ over the scroll hint but flags legitimate bars and icons on real screens.
- `-experimental`: `text-lines-merged`, a run much taller than a glyph. Fires on every large title, kept only for investigation.

Known misses are listed in `TestKnownMisses`: two same-colour text lines drawn over each other, same-colour phrases overlapped horizontally, text clipped under a button, the arrow without `-solids`. Dim text is deliberately not checked: disabled states are dim by design.

## Build and run

OpenCV is built from source into `~/opt/opencv` (Homebrew has no macOS 14 bottles):

```bash
export PKG_CONFIG_PATH=$HOME/opt/opencv/lib/pkgconfig CGO_CXXFLAGS="--std=c++11" CGO_LDFLAGS="-Wl,-rpath,$HOME/opt/opencv/lib"
cd tools/overlap-detect && go build -o /tmp/overlap-detect .
/tmp/overlap-detect [-json] [-solids] [-out marked/] screenshot.png ...
go test ./...
```

`-out` writes `*.marked.png` with the findings boxed (red = `overlap`, yellow = geometric kinds).

## Evaluation

- Synthetic panels in `testdata/` (HTML sources in `testdata/html/`) pair each defect kind with a clean control.
- `TestRealGameScreenshotsMatchFrozenFindings` runs every `e2e/screenshots/*.png` (25 real captures) and compares the findings to a frozen set. Real captures hold a few genuine defects: the colliding "Требовать сдаться" / "Позвать на помощь" buttons in combat planning and the uneven menu gap in `in-flight-feedback-button.png`. One frozen finding is a known false positive (portrait glow in `race-selection.png`).
- Recall on real UI is not measurable from so few real defects; thresholds were tuned on this corpus, so a new corpus will need a fresh false-positive pass.
