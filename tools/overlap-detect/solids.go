package main

import (
	"image"

	"gocv.io/x/gocv"
)

type SolidParams struct {
	OpenSize     int
	MinSide      int
	MaxLines     float64
	MinFill      float64
	MaxFill      float64
	RingPx       int
	MinRingShare float64
	MinRingPx    int
}

func DefaultSolidParams() SolidParams {
	return SolidParams{OpenSize: 8, MinSide: 8, MaxLines: 1.8, MinFill: 0.45, MaxFill: 1.01, RingPx: 2, MinRingShare: 0.12, MinRingPx: 14}
}

func solidShapesInText(mask gocv.Mat, glyphH int, p SolidParams) []Finding {
	kernel := gocv.GetStructuringElement(gocv.MorphRect, image.Pt(p.OpenSize, p.OpenSize))
	defer kernel.Close()
	solid := gocv.NewMat()
	defer solid.Close()
	gocv.MorphologyEx(mask, &solid, gocv.MorphOpen, kernel)
	contours := gocv.FindContours(solid, gocv.RetrievalExternal, gocv.ChainApproxSimple)
	defer contours.Close()
	bounds := image.Rect(0, 0, mask.Cols(), mask.Rows())
	maxSide := int(p.MaxLines * float64(max(glyphH, minLineHeight)))
	var out []Finding
	for i := 0; i < contours.Size(); i++ {
		rect := gocv.BoundingRect(contours.At(i))
		if rect.Dx() < p.MinSide || rect.Dy() < p.MinSide || rect.Dx() > maxSide || rect.Dy() > maxSide {
			continue
		}
		fill := countInk(solid, rect)
		fillRatio := float64(fill) / float64(rect.Dx()*rect.Dy())
		if fillRatio < p.MinFill || fillRatio > p.MaxFill {
			continue
		}
		outer := rect.Inset(-p.RingPx).Intersect(bounds)
		ringInk := countInk(mask, outer) - countInk(mask, rect)
		ringArea := outer.Dx()*outer.Dy() - rect.Dx()*rect.Dy()
		if ringArea <= 0 || ringInk < p.MinRingPx || float64(ringInk) < p.MinRingShare*float64(ringArea) {
			continue
		}
		out = append(out, Finding{
			Kind:    "solid-over-text",
			BBox:    [4]int{rect.Min.X, rect.Min.Y, rect.Max.X, rect.Max.Y},
			Classes: []string{"solid", "text"},
			Score:   float64(ringInk) / float64(ringArea),
			Note:    "a solid filled shape (arrow, bar, icon) has text ink touching it on its sides",
		})
	}
	return out
}

func countInk(m gocv.Mat, rect image.Rectangle) int {
	region := m.Region(rect)
	defer region.Close()
	return gocv.CountNonZero(region)
}
