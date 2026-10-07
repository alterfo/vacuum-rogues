package main

import (
	"image"
	"image/color"
	"sort"

	"gocv.io/x/gocv"
)

type Box struct {
	Rect image.Rectangle
	Kind string
}

type BoxParams struct {
	MinBoxSide       int
	MinFill          float64
	DedupeSlack      int
	NestSlack        int
	MinOverlapFrac   float64
	MaxOverlapFrac   float64
	MinRunInkFill    float64
	RunDilateChars   float64
	MaxInlineFrame   int
	MinRunHeight     int
	MinCrossRunWidth int
}

func DefaultBoxParams() BoxParams {
	return BoxParams{
		MinBoxSide:       16,
		MinFill:          0.85,
		DedupeSlack:      3,
		NestSlack:        3,
		MinOverlapFrac:   0.03,
		MaxOverlapFrac:   0.97,
		MinRunInkFill:    0.1,
		RunDilateChars:   1.2,
		MaxInlineFrame:   64,
		MinRunHeight:     7,
		MinCrossRunWidth: 24,
	}
}

func near(a, b image.Rectangle, slack int) bool {
	abs := func(v int) int {
		if v < 0 {
			return -v
		}
		return v
	}
	return abs(a.Min.X-b.Min.X) <= slack && abs(a.Min.Y-b.Min.Y) <= slack &&
		abs(a.Max.X-b.Max.X) <= slack && abs(a.Max.Y-b.Max.Y) <= slack
}

const concentricSizeDelta = 10

func concentric(a, b image.Rectangle, centerSlack, sizeDelta int) bool {
	ca := image.Pt((a.Min.X+a.Max.X)/2, (a.Min.Y+a.Max.Y)/2)
	cb := image.Pt((b.Min.X+b.Max.X)/2, (b.Min.Y+b.Max.Y)/2)
	return absInt(ca.X-cb.X) <= centerSlack && absInt(ca.Y-cb.Y) <= centerSlack &&
		absInt(a.Dx()-b.Dx()) <= sizeDelta && absInt(a.Dy()-b.Dy()) <= sizeDelta
}

func contains(outer, inner image.Rectangle, slack int) bool {
	return inner.Min.X >= outer.Min.X-slack && inner.Min.Y >= outer.Min.Y-slack &&
		inner.Max.X <= outer.Max.X+slack && inner.Max.Y <= outer.Max.Y+slack
}

func frameBoxes(src gocv.Mat, p BoxParams) []Box {
	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(src, &gray, gocv.ColorBGRToGray)
	edges := gocv.NewMat()
	defer edges.Close()
	gocv.Canny(gray, &edges, 20, 60)
	kernel := gocv.GetStructuringElement(gocv.MorphRect, image.Pt(3, 3))
	defer kernel.Close()
	closed := gocv.NewMat()
	defer closed.Close()
	gocv.Dilate(edges, &closed, kernel)
	contours := gocv.FindContours(closed, gocv.RetrievalList, gocv.ChainApproxSimple)
	defer contours.Close()
	var boxes []Box
	for i := 0; i < contours.Size(); i++ {
		c := contours.At(i)
		rect := gocv.BoundingRect(c)
		if rect.Dx() < p.MinBoxSide || rect.Dy() < p.MinBoxSide {
			continue
		}
		if float64(gocv.ContourArea(c)) < p.MinFill*float64(rect.Dx()*rect.Dy()) {
			continue
		}
		boxes = append(boxes, Box{Rect: rect, Kind: "frame"})
	}
	return dedupeBoxes(boxes, p.DedupeSlack)
}

func dedupeBoxes(boxes []Box, slack int) []Box {
	sort.Slice(boxes, func(i, j int) bool {
		return boxes[i].Rect.Dx()*boxes[i].Rect.Dy() > boxes[j].Rect.Dx()*boxes[j].Rect.Dy()
	})
	var out []Box
	for _, b := range boxes {
		dup := false
		for _, o := range out {
			if near(b.Rect, o.Rect, slack) || concentric(b.Rect, o.Rect, slack, concentricSizeDelta) {
				dup = true
				break
			}
		}
		if !dup {
			out = append(out, b)
		}
	}
	return out
}

func eraseFrames(mask gocv.Mat, frames []Box) gocv.Mat {
	cleaned := mask.Clone()
	black := color.RGBA{}
	for _, f := range frames {
		gocv.Rectangle(&cleaned, f.Rect, black, 4)
	}
	return cleaned
}

func textRuns(rawMask gocv.Mat, frames []Box, charW, glyphH int, p BoxParams) []Box {
	if charW == 0 {
		return nil
	}
	mask := eraseFrames(rawMask, frames)
	defer mask.Close()
	width := int(p.RunDilateChars*float64(charW)) + 1
	kernel := gocv.GetStructuringElement(gocv.MorphRect, image.Pt(width, 3))
	defer kernel.Close()
	dilated := gocv.NewMat()
	defer dilated.Close()
	gocv.Dilate(mask, &dilated, kernel)
	contours := gocv.FindContours(dilated, gocv.RetrievalExternal, gocv.ChainApproxSimple)
	defer contours.Close()
	var runs []Box
	for i := 0; i < contours.Size(); i++ {
		rect := gocv.BoundingRect(contours.At(i))
		if rect.Dx() < charW || rect.Dy() < p.MinRunHeight || rect.Dy() > 3*glyphH+6 {
			continue
		}
		roi := mask.Region(rect)
		ink := gocv.CountNonZero(roi)
		roi.Close()
		if float64(ink) < p.MinRunInkFill*float64(rect.Dx()*rect.Dy()) {
			continue
		}
		runs = append(runs, Box{Rect: rect, Kind: "text"})
	}
	return runs
}

func intersectionFrac(a, b image.Rectangle) float64 {
	in := a.Intersect(b)
	if in.Empty() {
		return 0
	}
	fracX := float64(in.Dx()) / float64(min(a.Dx(), b.Dx()))
	fracY := float64(in.Dy()) / float64(min(a.Dy(), b.Dy()))
	return min(fracX, fracY)
}

func verticalOverlapFrac(a, b image.Rectangle) float64 {
	lo, hi := max(a.Min.Y, b.Min.Y), min(a.Max.Y, b.Max.Y)
	if hi <= lo {
		return 0
	}
	shorter := min(a.Dy(), b.Dy())
	return float64(hi-lo) / float64(shorter)
}

func framesBetweenText(frames, runs []Box, charW int, p BoxParams) []Finding {
	var out []Finding
	reach := 2 * charW
	for _, f := range frames {
		if f.Rect.Dx() > p.MaxInlineFrame || f.Rect.Dy() > p.MaxInlineFrame {
			continue
		}
		var left, right *Box
		for i := range runs {
			r := &runs[i]
			if verticalOverlapFrac(r.Rect, f.Rect) < 0.3 {
				continue
			}
			if r.Rect.Max.X <= f.Rect.Min.X+p.NestSlack && f.Rect.Min.X-r.Rect.Max.X <= reach {
				if left == nil || r.Rect.Max.X > left.Rect.Max.X {
					left = r
				}
			}
			if r.Rect.Min.X >= f.Rect.Max.X-p.NestSlack && r.Rect.Min.X-f.Rect.Max.X <= reach {
				if right == nil || r.Rect.Min.X < right.Rect.Min.X {
					right = r
				}
			}
		}
		if left == nil || right == nil || verticalOverlapFrac(left.Rect, right.Rect) < 0.6 {
			continue
		}
		out = append(out, Finding{
			Kind:    "frame-between-text",
			BBox:    [4]int{f.Rect.Min.X, f.Rect.Min.Y, f.Rect.Max.X, f.Rect.Max.Y},
			Classes: []string{"frame", "text", "text"},
			Score:   1,
			Note:    "a bordered box sits inside a text line, with text on both sides",
		})
	}
	return out
}

func boxConflicts(frames, runs []Box, p BoxParams) []Finding {
	var out []Finding
	report := func(a, b Box, frac float64, kind string) {
		offender := a.Rect
		if b.Rect.Dx()*b.Rect.Dy() < a.Rect.Dx()*a.Rect.Dy() {
			offender = b.Rect
		}
		out = append(out, Finding{
			Kind:    kind,
			BBox:    [4]int{offender.Min.X, offender.Min.Y, offender.Max.X, offender.Max.Y},
			Classes: []string{a.Kind, b.Kind},
			Score:   frac,
			Note:    "rectangles intersect without one containing the other",
		})
	}
	for i := 0; i < len(frames); i++ {
		for j := i + 1; j < len(frames); j++ {
			a, b := frames[i], frames[j]
			frac := intersectionFrac(a.Rect, b.Rect)
			if frac < p.MinOverlapFrac || frac > p.MaxOverlapFrac {
				continue
			}
			if contains(a.Rect, b.Rect, p.NestSlack) || contains(b.Rect, a.Rect, p.NestSlack) {
				continue
			}
			report(a, b, frac, "frame-crossing")
		}
	}
	for _, r := range runs {
		if r.Rect.Dx() < p.MinCrossRunWidth {
			continue
		}
		for _, f := range frames {
			frac := intersectionFrac(r.Rect, f.Rect)
			if frac < p.MinOverlapFrac || frac > p.MaxOverlapFrac {
				continue
			}
			if contains(f.Rect, r.Rect, p.NestSlack) || contains(r.Rect, f.Rect, p.NestSlack) {
				continue
			}
			report(r, f, frac, "text-crossing-frame")
		}
	}
	return out
}
