package main

import (
	"image"
	"path/filepath"
	"testing"

	"gocv.io/x/gocv"
)

func analyze(t *testing.T, path string) Result {
	t.Helper()
	src := gocv.IMRead(path, gocv.IMReadColor)
	if src.Empty() {
		t.Fatalf("cannot read %s", path)
	}
	defer src.Close()
	res, err := Analyze(src, DefaultParams())
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func kinds(res Result) map[string]int {
	out := map[string]int{}
	for _, f := range res.Findings {
		out[f.Kind]++
	}
	return out
}

func TestCleanScreensStaySilent(t *testing.T) {
	for _, name := range []string{"ok_clean", "ok_clean2"} {
		res := analyze(t, "testdata/"+name+".png")
		if len(res.Findings) != 0 {
			t.Errorf("%s: expected no findings, got %+v", name, res.Findings)
		}
	}
}

func TestCrookedCloseButtonCrossesPanelBorder(t *testing.T) {
	res := analyze(t, "testdata/bad_x_offset.png")
	if kinds(res)["frame-crossing"] != 1 {
		t.Fatalf("expected one frame-crossing, got %+v", res.Findings)
	}
	box := res.Findings[0].BBox
	want := image.Rect(1060, 90, 1105, 130)
	got := image.Rect(box[0], box[1], box[2], box[3])
	if !got.In(want) {
		t.Errorf("finding %v should be the close button inside %v", got, want)
	}
}

func TestRowStickingOutOfPanelIsFlagged(t *testing.T) {
	res := analyze(t, "testdata/bad_clipped.png")
	if kinds(res)["frame-crossing"] != 1 {
		t.Fatalf("expected one frame-crossing, got %+v", res.Findings)
	}
}

func TestBoxInsideTextLineIsFlagged(t *testing.T) {
	res := analyze(t, "testdata/bad_x_overlap_title.png")
	if kinds(res)["frame-between-text"] != 1 {
		t.Fatalf("expected one frame-between-text, got %+v", res.Findings)
	}
}

func regionOf(f Finding) image.Rectangle {
	return image.Rect(f.BBox[0], f.BBox[1], f.BBox[2], f.BBox[3])
}

func TestQuestBoardReportsTheTwoTextCollisions(t *testing.T) {
	res := analyze(t, "testdata/quest_board.png")
	if len(res.Findings) != 2 {
		t.Fatalf("expected exactly two findings, got %+v", res.Findings)
	}
	title := image.Rect(30, 25, 50, 55)
	fields := image.Rect(175, 790, 250, 806)
	var hitTitle, hitFields bool
	for _, f := range res.Findings {
		if f.Kind != "overlap" {
			t.Fatalf("unexpected kind in %+v", f)
		}
		hitTitle = hitTitle || regionOf(f).Overlaps(title)
		hitFields = hitFields || regionOf(f).Overlaps(fields)
	}
	if !hitTitle || !hitFields {
		t.Fatalf("title collision=%v, cargo/system collision=%v: %+v", hitTitle, hitFields, res.Findings)
	}
}

func TestUnevenGapBetweenStackedCards(t *testing.T) {
	res := analyze(t, "testdata/bad_spacing.png")
	if kinds(res)["uneven-gap"] != 1 || len(res.Findings) != 1 {
		t.Fatalf("expected one uneven-gap, got %+v", res.Findings)
	}
}

func TestMisalignedSiblingButton(t *testing.T) {
	res := analyze(t, "testdata/bad_misaligned_buttons.png")
	if kinds(res)["misaligned-sibling"] != 1 || len(res.Findings) != 1 {
		t.Fatalf("expected one misaligned-sibling, got %+v", res.Findings)
	}
}

func TestTextTouchingContainerEdge(t *testing.T) {
	res := analyze(t, "testdata/bad_text_touches_border.png")
	if kinds(res)["text-touches-border"] < 1 {
		t.Fatalf("expected text-touches-border, got %+v", res.Findings)
	}
}

func TestEqualGapsAndAlignedButtonsStaySilent(t *testing.T) {
	for _, name := range []string{"ok_cards_equal_gaps", "ok_buttons_aligned"} {
		if res := analyze(t, "testdata/"+name+".png"); len(res.Findings) != 0 {
			t.Errorf("%s: %+v", name, res.Findings)
		}
	}
}

func TestSolidsFlagFindsArrowOverHint(t *testing.T) {
	src := gocv.IMRead("testdata/quest_board.png", gocv.IMReadColor)
	defer src.Close()
	params := DefaultParams()
	params.EnableSolids = true
	res, err := Analyze(src, params)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range res.Findings {
		box := image.Rect(f.BBox[0], f.BBox[1], f.BBox[2], f.BBox[3])
		if f.Kind == "solid-over-text" && box.Overlaps(image.Rect(320, 1050, 340, 1070)) {
			found = true
		}
	}
	if !found {
		t.Fatalf("arrow over the scroll hint not reported: %+v", res.Findings)
	}
}

func TestRealGameScreenshotsMatchFrozenFindings(t *testing.T) {
	paths, _ := filepath.Glob("../../e2e/screenshots/*.png")
	if len(paths) == 0 {
		t.Skip("no real screenshots available")
	}
	want := map[string]map[string]int{
		"combat-planning-phase.png":     {"text-crossing-frame": 1},
		"dogfight-planning-phase.png":   {"text-crossing-frame": 1, "text-touches-border": 1},
		"in-flight-feedback-button.png": {"uneven-gap": 1},
		"micromodule-hangar-board.png":  {"text-touches-border": 1},
		"race-selection.png":            {"overlap": 1},
	}
	for _, path := range paths {
		name := filepath.Base(path)
		got := kinds(analyze(t, path))
		expected := want[name]
		if expected == nil {
			expected = map[string]int{}
		}
		if len(got) != len(expected) {
			t.Errorf("%s: got %v, want %v", name, got, expected)
			continue
		}
		for kind, n := range expected {
			if got[kind] != n {
				t.Errorf("%s: got %v, want %v", name, got, expected)
			}
		}
	}
}

func TestKnownMisses(t *testing.T) {
	t.Skip("known miss: dim or cut-off 'Занят' column")
	t.Skip("known miss: two same-colour text lines drawn over each other (bad_text_over_text_same)")
	t.Skip("known miss: same-colour phrases overlapped horizontally (bad_text_h_overlap_same)")
	t.Skip("known miss: scroll-hint arrow over text is only found with -solids, which is noisy")
	t.Skip("known false positive: orange pendant glow on the race-selection portrait reads as two text colours")
	t.Skip("known miss: log text clipped under the first button in combat planning")
}

func TestClassifyPixelSeparatesNeutralFromChroma(t *testing.T) {
	if classifyPixel(240, 240, 240) != ClassNeutral {
		t.Error("white should be neutral")
	}
	if classifyPixel(255, 140, 0) != ClassOrange {
		t.Error("orange misclassified")
	}
	if classifyPixel(0, 220, 230) != ClassCyan {
		t.Error("cyan misclassified")
	}
}
