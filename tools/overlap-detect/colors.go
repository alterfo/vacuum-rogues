package main

import "math"

type ColorClass string

const (
	ClassNone    ColorClass = ""
	ClassNeutral ColorClass = "neutral"
	ClassRed     ColorClass = "red"
	ClassOrange  ColorClass = "orange"
	ClassYellow  ColorClass = "yellow"
	ClassGreen   ColorClass = "green"
	ClassCyan    ColorClass = "cyan"
	ClassBlue    ColorClass = "blue"
	ClassPurple  ColorClass = "purple"
)

const (
	whiteCoreSat        = 0.12
	whiteCoreValue      = 0.85
	minChromaSaturation = 0.35
	minChromaValue      = 0.5
	maxNeutralSat       = 0.2
	minNeutralValue     = 0.55
)

func rgbToHSV(r, g, b uint8) (h, s, v float64) {
	rf, gf, bf := float64(r)/255, float64(g)/255, float64(b)/255
	maxc := math.Max(rf, math.Max(gf, bf))
	minc := math.Min(rf, math.Min(gf, bf))
	v = maxc
	d := maxc - minc
	if maxc == 0 {
		return 0, 0, 0
	}
	s = d / maxc
	if d == 0 {
		return 0, s, v
	}
	switch maxc {
	case rf:
		h = math.Mod((gf-bf)/d, 6)
	case gf:
		h = (bf-rf)/d + 2
	default:
		h = (rf-gf)/d + 4
	}
	h *= 60
	if h < 0 {
		h += 360
	}
	return h, s, v
}

func classifyPixel(r, g, b uint8) ColorClass {
	h, s, v := rgbToHSV(r, g, b)
	if s < maxNeutralSat {
		if v >= minNeutralValue {
			return ClassNeutral
		}
		return ClassNone
	}
	if s < minChromaSaturation || v < minChromaValue {
		return ClassNone
	}
	switch {
	case h < 12 || h >= 345:
		return ClassRed
	case h < 40:
		return ClassOrange
	case h < 70:
		return ClassYellow
	case h < 165:
		return ClassGreen
	case h < 205:
		return ClassCyan
	case h < 265:
		return ClassBlue
	default:
		return ClassPurple
	}
}
