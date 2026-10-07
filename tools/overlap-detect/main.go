package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"strings"

	"gocv.io/x/gocv"
)

func annotate(src gocv.Mat, res Result) gocv.Mat {
	out := src.Clone()
	for _, f := range res.Findings {
		c := color.RGBA{R: 255, G: 210, B: 0, A: 255}
		if f.Kind == "overlap" {
			c = color.RGBA{R: 255, G: 40, B: 40, A: 255}
		}
		rect := image.Rect(f.BBox[0]-2, f.BBox[1]-2, f.BBox[2]+2, f.BBox[3]+2)
		gocv.Rectangle(&out, rect, c, 1)
	}
	return out
}

func main() {
	asJSON := flag.Bool("json", false, "machine-readable output")
	outDir := flag.String("out", "", "directory for annotated PNGs")
	experimental := flag.Bool("experimental", false, "also run text-lines-merged and ink-too-dense; false positives on large titles and bold fonts")
	solids := flag.Bool("solids", false, "experimental: flag solid shapes (arrows, bars) touching text; noisy on real UI")
	flag.Parse()
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: overlap-detect [-json] [-out dir] screenshot.png ...")
		os.Exit(2)
	}
	type fileResult struct {
		Image string `json:"image"`
		Result
	}
	var results []fileResult
	failed := false
	for _, path := range flag.Args() {
		src := gocv.IMRead(path, gocv.IMReadColor)
		if src.Empty() {
			fmt.Fprintf(os.Stderr, "%s: cannot read image\n", path)
			failed = true
			continue
		}
		params := DefaultParams()
		params.EnableSolids = *solids
		params.EnableExperimental = *experimental
		res, err := Analyze(src, params)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", path, err)
			failed = true
			src.Close()
			continue
		}
		if *outDir != "" {
			if err := os.MkdirAll(*outDir, 0o755); err == nil {
				marked := annotate(src, res)
				name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)) + ".marked.png"
				gocv.IMWrite(filepath.Join(*outDir, name), marked)
				marked.Close()
			}
		}
		src.Close()
		results = append(results, fileResult{Image: path, Result: res})
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(results)
	} else {
		for _, r := range results {
			fmt.Printf("== %s (%dx%d, charW=%d glyphH=%d): %d finding(s)\n", r.Image, r.Width, r.Height, r.CharW, r.GlyphH, len(r.Findings))
			for _, f := range r.Findings {
				fmt.Printf("[%s] %v classes=%v glyphs=%.1f score=%.1f %s\n", f.Kind, f.BBox, f.Classes, f.Glyphs, f.Score, f.Note)
			}
		}
	}
	if failed {
		os.Exit(1)
	}
}
