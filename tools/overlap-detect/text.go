package main

import (
	"image"

	"gocv.io/x/gocv"
)

type TextParams struct {
	PadMax        int
	PadMaxFrameH  int
	PadMinFrameW  int
	MinRunComps   int
	TallRunRatio  float64
	RunSlack      int
	MinInkHeight  int
	MinTallGlyphs float64
	MaxTallGlyphs float64
}

func DefaultTextParams() TextParams {
	return TextParams{
		PadMax:        3,
		PadMaxFrameH:  140,
		PadMinFrameW:  60,
		MinRunComps:   6,
		TallRunRatio:  1.9,
		RunSlack:      10,
		MinInkHeight:  6,
		MinTallGlyphs: 1.7,
		MaxTallGlyphs: 2.6,
	}
}

func inkExtent(mask gocv.Mat, rect image.Rectangle) (image.Rectangle, bool) {
	rect = rect.Intersect(image.Rect(0, 0, mask.Cols(), mask.Rows()))
	if rect.Empty() {
		return image.Rectangle{}, false
	}
	region := mask.Region(rect)
	defer region.Close()
	data := region.ToBytes()
	w, h := region.Cols(), region.Rows()
	minX, minY, maxX, maxY := w, h, -1, -1
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if data[y*w+x] != 0 {
				minX, maxX = min(minX, x), max(maxX, x)
				minY, maxY = min(minY, y), max(maxY, y)
			}
		}
	}
	if maxX < 0 {
		return image.Rectangle{}, false
	}
	return image.Rect(rect.Min.X+minX, rect.Min.Y+minY, rect.Min.X+maxX+1, rect.Min.Y+maxY+1), true
}

func textTouchingBorder(frames, runs []Box, cleaned gocv.Mat, p TextParams) []Finding {
	var out []Finding
	for _, f := range frames {
		if f.Rect.Dy() > p.PadMaxFrameH || f.Rect.Dx() < p.PadMinFrameW {
			continue
		}
		for _, r := range runs {
			if !contains(f.Rect, r.Rect, p.RunSlack) {
				continue
			}
			ink, ok := inkExtent(cleaned, r.Rect)
			if !ok || ink.Dy() < p.MinInkHeight {
				continue
			}
			left := ink.Min.X - f.Rect.Min.X
			right := f.Rect.Max.X - ink.Max.X
			if left > p.PadMax && right > p.PadMax {
				continue
			}
			out = append(out, Finding{
				Kind:    "text-touches-border",
				BBox:    [4]int{ink.Min.X, ink.Min.Y, ink.Max.X, ink.Max.Y},
				Classes: []string{"text", "frame"},
				Score:   float64(min(left, right)),
				Note:    "text sits within a few pixels of its container's edge",
			})
		}
	}
	return out
}

func componentsInside(comps []Component, rect image.Rectangle) []Component {
	var out []Component
	for _, c := range comps {
		center := image.Pt((c.Rect.Min.X+c.Rect.Max.X)/2, (c.Rect.Min.Y+c.Rect.Max.Y)/2)
		if center.In(rect) && c.Area >= 4 {
			out = append(out, c)
		}
	}
	return out
}

func mergedLines(runs []Box, comps []Component, glyphH int, p TextParams) []Finding {
	var out []Finding
	for _, r := range runs {
		inside := componentsInside(comps, r.Rect)
		if len(inside) == 0 {
			continue
		}
		heights := make([]int, len(inside))
		for i, c := range inside {
			heights[i] = c.Rect.Dy()
		}
		scale := min(median(heights), max(glyphH, minLineHeight))
		if scale == 0 {
			continue
		}
		ratio := float64(r.Rect.Dy()) / float64(scale)
		if ratio < p.MinTallGlyphs || ratio > p.MaxTallGlyphs {
			continue
		}
		out = append(out, Finding{
			Kind:    "text-lines-merged",
			BBox:    [4]int{r.Rect.Min.X, r.Rect.Min.Y, r.Rect.Max.X, r.Rect.Max.Y},
			Classes: []string{"text"},
			Score:   ratio,
			Note:    "a text run is much taller than a glyph: two lines or two phrases drawn over each other",
		})
	}
	return out
}
