package main

import (
	"encoding/binary"
	"fmt"
	"image"
	"sort"

	"gocv.io/x/gocv"
)

const (
	hueBins       = 36
	minLineHeight = 9
)

type Component struct {
	Rect      image.Rectangle
	Area      int
	HueHist   [hueBins]int
	Chroma    int
	WhiteCore int
}

type Finding struct {
	Kind    string   `json:"kind"`
	BBox    [4]int   `json:"bbox"`
	Classes []string `json:"classes"`
	Glyphs  float64  `json:"estimatedGlyphs"`
	Score   float64  `json:"score"`
	Note    string   `json:"note"`
}

type Result struct {
	Width    int       `json:"width"`
	Height   int       `json:"height"`
	CharW    int       `json:"charWidth"`
	GlyphH   int       `json:"glyphHeight"`
	Findings []Finding `json:"findings"`
}

type Params struct {
	TopHatSize           int
	MinInk               float64
	MinChromaPixels      int
	MinSecondaryPixels   int
	MinSecondaryShare    float64
	MinHueSeparationBins int
	MaxBlobLines         int
	MaxBlobFill          float64
	EnableSolids         bool
	EnableExperimental   bool
}

func DefaultParams() Params {
	return Params{TopHatSize: 15, MinInk: 40, MinChromaPixels: 12, MinSecondaryPixels: 8, MinSecondaryShare: 0.2, MinHueSeparationBins: 3, MaxBlobLines: 3, MaxBlobFill: 0.7}
}

func median(values []int) int {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]int(nil), values...)
	sort.Ints(sorted)
	return sorted[len(sorted)/2]
}

func inkMask(src gocv.Mat, p Params) gocv.Mat {
	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(src, &gray, gocv.ColorBGRToGray)
	kernel := gocv.GetStructuringElement(gocv.MorphRect, image.Pt(p.TopHatSize, p.TopHatSize))
	defer kernel.Close()
	tophat := gocv.NewMat()
	defer tophat.Close()
	gocv.MorphologyEx(gray, &tophat, gocv.MorphTophat, kernel)
	mask := gocv.NewMat()
	gocv.Threshold(tophat, &mask, float32(p.MinInk), 255, gocv.ThresholdBinary)
	return mask
}

func extractComponents(src, mask gocv.Mat) ([]Component, error) {
	labels := gocv.NewMat()
	defer labels.Close()
	stats := gocv.NewMat()
	defer stats.Close()
	centroids := gocv.NewMat()
	defer centroids.Close()
	count := gocv.ConnectedComponentsWithStats(mask, &labels, &stats, &centroids)
	width, height := src.Cols(), src.Rows()
	pixels := src.ToBytes()
	if src.Channels() != 3 {
		return nil, fmt.Errorf("expected 3 channels, got %d", src.Channels())
	}
	labelBytes := labels.ToBytes()
	if len(labelBytes) != width*height*4 {
		return nil, fmt.Errorf("unexpected label buffer size %d", len(labelBytes))
	}
	comps := make([]Component, count)
	for i := 1; i < count; i++ {
		x := int(stats.GetIntAt(i, 0))
		y := int(stats.GetIntAt(i, 1))
		w := int(stats.GetIntAt(i, 2))
		h := int(stats.GetIntAt(i, 3))
		comps[i] = Component{
			Rect: image.Rect(x, y, x+w, y+h),
			Area: int(stats.GetIntAt(i, 4)),
		}
	}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			id := int(int32(binary.LittleEndian.Uint32(labelBytes[(y*width+x)*4:])))
			if id <= 0 {
				continue
			}
			o := (y*width + x) * 3
			h, sat, val := rgbToHSV(pixels[o+2], pixels[o+1], pixels[o])
			switch {
			case sat >= minChromaSaturation && val >= minChromaValue:
				comps[id].HueHist[int(h/360*hueBins)%hueBins]++
				comps[id].Chroma++
			case sat < whiteCoreSat && val >= whiteCoreValue:
				comps[id].WhiteCore++
			}
		}
	}
	return comps[1:], nil
}

func glyphStats(comps []Component) (charW, glyphH int) {
	var widths, heights []int
	for _, c := range comps {
		w, h := c.Rect.Dx(), c.Rect.Dy()
		if c.Area < 6 || w < 3 || h < 5 || h > 40 || w > 40 {
			continue
		}
		widths = append(widths, w)
		heights = append(heights, h)
	}
	return median(widths), median(heights)
}

func circularBinDistance(a, b int) int {
	d := a - b
	if d < 0 {
		d = -d
	}
	if d > hueBins/2 {
		d = hueBins - d
	}
	return d
}

func massAround(hist [hueBins]int, center, radius int) int {
	sum := 0
	for i, n := range hist {
		if circularBinDistance(i, center) <= radius {
			sum += n
		}
	}
	return sum
}

func dominantHues(c Component, p Params) []ColorClass {
	if c.Chroma < p.MinChromaPixels {
		return nil
	}
	peak1 := 0
	for i, n := range c.HueHist {
		if n > c.HueHist[peak1] {
			peak1 = i
		}
	}
	out := []ColorClass{ColorClass(fmt.Sprintf("hue%d", peak1*360/hueBins))}
	var rest [hueBins]int
	for i, n := range c.HueHist {
		if circularBinDistance(i, peak1) > p.MinHueSeparationBins {
			rest[i] = n
		}
	}
	peak2 := -1
	for i, n := range rest {
		if n > 0 && (peak2 < 0 || n > rest[peak2]) {
			peak2 = i
		}
	}
	if peak2 >= 0 {
		mass := massAround(c.HueHist, peak2, 2)
		if mass >= p.MinSecondaryPixels && float64(mass) >= p.MinSecondaryShare*float64(c.Chroma) {
			out = append(out, ColorClass(fmt.Sprintf("hue%d", peak2*360/hueBins)))
		}
	}
	return out
}

func Analyze(src gocv.Mat, p Params) (Result, error) {
	mask := inkMask(src, p)
	defer mask.Close()
	comps, err := extractComponents(src, mask)
	if err != nil {
		return Result{}, err
	}
	charW, glyphH := glyphStats(comps)
	if charW == 0 || glyphH == 0 {
		return Result{}, fmt.Errorf("no text-like components found, cannot calibrate glyph size")
	}
	res := Result{Width: src.Cols(), Height: src.Rows(), CharW: charW, GlyphH: glyphH, Findings: []Finding{}}
	for _, c := range comps {
		w, h := c.Rect.Dx(), c.Rect.Dy()
		if c.Area < 6 || w <= 3 || h <= 3 || h > p.MaxBlobLines*max(glyphH, minLineHeight) {
			continue
		}
		if float64(c.Area) > p.MaxBlobFill*float64(w*h) {
			continue
		}
		hues := dominantHues(c, p)
		if len(hues) < 2 {
			continue
		}
		names := make([]string, len(hues))
		for i, k := range hues {
			names[i] = string(k)
		}
		sort.Strings(names)
		res.Findings = append(res.Findings, Finding{
			Kind:    "overlap",
			BBox:    [4]int{c.Rect.Min.X, c.Rect.Min.Y, c.Rect.Max.X, c.Rect.Max.Y},
			Classes: names,
			Glyphs:  float64(w) / float64(max(charW, 1)),
			Score:   float64(c.Chroma),
			Note:    "one connected ink blob contains two distinct text colours",
		})
	}
	if p.EnableSolids {
		res.Findings = append(res.Findings, solidShapesInText(mask, glyphH, DefaultSolidParams())...)
	}
	frames := frameBoxes(src, DefaultBoxParams())
	runs := textRuns(mask, frames, charW, glyphH, DefaultBoxParams())
	res.Findings = append(res.Findings, boxConflicts(frames, runs, DefaultBoxParams())...)
	res.Findings = append(res.Findings, framesBetweenText(frames, runs, charW, DefaultBoxParams())...)
	res.Findings = append(res.Findings, unevenGaps(frames, mask, DefaultLayoutParams())...)
	cleaned := eraseFrames(mask, frames)
	defer cleaned.Close()
	res.Findings = append(res.Findings, textTouchingBorder(frames, runs, cleaned, DefaultTextParams())...)
	if p.EnableExperimental {
		res.Findings = append(res.Findings, mergedLines(runs, comps, glyphH, DefaultTextParams())...)
	}
	res.Findings = append(res.Findings, misalignedSiblings(frames, DefaultLayoutParams())...)
	return res, nil
}
