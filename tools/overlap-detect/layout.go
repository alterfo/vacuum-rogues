package main

import (
	"image"
	"sort"

	"gocv.io/x/gocv"
)

type LayoutParams struct {
	MinStack        int
	ColumnSlack     int
	MaxStackHeight  int
	MinStackWidth   int
	GapTolerance    float64
	GapMinDelta     int
	MaxAlignDelta   int
	MinAlignDelta   int
	SizeSlack       int
	MinRowFrameSide int
	GapInset        int
	GapTextPixels   int
}

func DefaultLayoutParams() LayoutParams {
	return LayoutParams{
		MinStack:        3,
		ColumnSlack:     3,
		MaxStackHeight:  140,
		MinStackWidth:   60,
		GapTolerance:    0.25,
		GapMinDelta:     3,
		MaxAlignDelta:   8,
		MinAlignDelta:   2,
		SizeSlack:       3,
		MinRowFrameSide: 20,
		GapInset:        3,
		GapTextPixels:   12,
	}
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func medianInt(values []int) int {
	return median(values)
}

func stackFrames(frames []Box, p LayoutParams) [][]Box {
	var candidates []Box
	for _, f := range frames {
		if f.Rect.Dx() >= p.MinStackWidth && f.Rect.Dy() <= p.MaxStackHeight {
			candidates = append(candidates, f)
		}
	}
	var groups [][]Box
	for _, f := range candidates {
		placed := false
		for gi := range groups {
			ref := groups[gi][0].Rect
			if absInt(ref.Min.X-f.Rect.Min.X) <= p.ColumnSlack && absInt(ref.Dx()-f.Rect.Dx()) <= p.ColumnSlack {
				groups[gi] = append(groups[gi], f)
				placed = true
				break
			}
		}
		if !placed {
			groups = append(groups, []Box{f})
		}
	}
	return groups
}

func unevenGaps(frames []Box, mask gocv.Mat, p LayoutParams) []Finding {
	var out []Finding
	for _, group := range stackFrames(frames, p) {
		if len(group) < p.MinStack {
			continue
		}
		sort.Slice(group, func(i, j int) bool { return group[i].Rect.Min.Y < group[j].Rect.Min.Y })
		gaps := make([]int, 0, len(group)-1)
		for i := 1; i < len(group); i++ {
			gaps = append(gaps, group[i].Rect.Min.Y-group[i-1].Rect.Max.Y)
		}
		ref := medianInt(gaps)
		for i, g := range gaps {
			delta := absInt(g - ref)
			if delta < p.GapMinDelta || float64(delta) < p.GapTolerance*float64(max(ref, 1)) {
				continue
			}
			upper, lower := group[i].Rect, group[i+1].Rect
			between := image.Rect(upper.Min.X, min(upper.Max.Y, lower.Min.Y), upper.Max.X, max(upper.Max.Y, lower.Min.Y))
			if gapHoldsText(mask, between, p) {
				continue
			}
			out = append(out, Finding{
				Kind:    "uneven-gap",
				BBox:    [4]int{between.Min.X, between.Min.Y, between.Max.X, between.Max.Y},
				Classes: []string{"frame", "frame"},
				Score:   float64(delta),
				Note:    "gap between stacked cards differs from the stack's typical gap",
			})
		}
	}
	return out
}

func misalignedSiblings(frames []Box, p LayoutParams) []Finding {
	var out []Finding
	used := make([]bool, len(frames))
	for i := range frames {
		if used[i] || frames[i].Rect.Dx() < p.MinRowFrameSide || frames[i].Rect.Dy() < p.MinRowFrameSide || frames[i].Rect.Dy() > p.MaxStackHeight {
			continue
		}
		group := []int{i}
		for j := i + 1; j < len(frames); j++ {
			a, b := frames[i].Rect, frames[j].Rect
			if used[j] || absInt(a.Dx()-b.Dx()) > p.SizeSlack || absInt(a.Dy()-b.Dy()) > p.SizeSlack {
				continue
			}
			if verticalOverlapFrac(a, b) < 0.5 || a.Overlaps(b) {
				continue
			}
			group = append(group, j)
		}
		if len(group) < 3 {
			continue
		}
		tops := make([]int, len(group))
		for k, idx := range group {
			tops[k] = frames[idx].Rect.Min.Y
			used[idx] = true
		}
		ref := medianInt(tops)
		for k, idx := range group {
			delta := absInt(tops[k] - ref)
			if delta < p.MinAlignDelta || delta > p.MaxAlignDelta {
				continue
			}
			r := frames[idx].Rect
			out = append(out, Finding{
				Kind:    "misaligned-sibling",
				BBox:    [4]int{r.Min.X, r.Min.Y, r.Max.X, r.Max.Y},
				Classes: []string{"frame"},
				Score:   float64(delta),
				Note:    "same-sized sibling is off the row's common top edge",
			})
		}
	}
	return out
}

func gapHoldsText(mask gocv.Mat, gap image.Rectangle, p LayoutParams) bool {
	inner := gap.Inset(p.GapInset).Intersect(image.Rect(0, 0, mask.Cols(), mask.Rows()))
	if inner.Empty() {
		return false
	}
	return countInk(mask, inner) >= p.GapTextPixels
}
