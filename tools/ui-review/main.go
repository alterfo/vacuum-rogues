package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	host := flag.String("host", "http://192.168.88.193:11434", "ollama base url")
	model := flag.String("model", "qwen2.5vl:7b", "vision model")
	focus := flag.String("focus", "", "extra things to check")
	asJSON := flag.Bool("json", false, "machine-readable output")
	timeout := flag.Duration("timeout", 5*time.Minute, "per-image timeout")
	flag.Parse()
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: ui-review [flags] screenshot.png ...")
		os.Exit(2)
	}
	client := newClient(*timeout)
	reports := make([]Report, 0, flag.NArg())
	failed := false
	for _, path := range flag.Args() {
		ctx, cancel := context.WithTimeout(context.Background(), *timeout)
		report, err := reviewImage(ctx, client, *host, *model, path, *focus)
		cancel()
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", path, err)
			failed = true
			continue
		}
		reports = append(reports, report)
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(reports)
	} else {
		for _, r := range reports {
			fmt.Printf("== %s: %d finding(s)\n", r.Image, len(r.Findings))
			for _, f := range r.Findings {
				fmt.Printf("[%s/%s] %s %v \"%s\": %s -> %s\n", f.Severity, f.Kind, f.Region, f.BBox, f.Evidence, f.Issue, f.Fix)
			}
		}
	}
	if failed {
		os.Exit(1)
	}
}
