package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type Finding struct {
	Kind     string `json:"kind"`
	Severity string `json:"severity"`
	Region   string `json:"region"`
	Evidence string `json:"evidence"`
	BBox     []int  `json:"bbox"`
	Issue    string `json:"issue"`
	Fix      string `json:"fix"`
}

type Report struct {
	Image    string    `json:"image"`
	Findings []Finding `json:"findings"`
}

type chatMessage struct {
	Role    string   `json:"role"`
	Content string   `json:"content"`
	Images  []string `json:"images,omitempty"`
}

type chatRequest struct {
	Model    string         `json:"model"`
	Messages []chatMessage  `json:"messages"`
	Stream   bool           `json:"stream"`
	Format   string         `json:"format"`
	Options  map[string]any `json:"options"`
}

type chatResponse struct {
	Message chatMessage `json:"message"`
	Error   string      `json:"error"`
}

const systemPrompt = `You are a strict UI/visual QA reviewer for a 2D game interface (space RPG, dark theme, Russian text).
You receive one screenshot. Report ONLY defects that are unmistakably visible. A false alarm is worse than a missed defect, so when in doubt report nothing.
Defect classes:
- misplaced: a control sits outside its container, or is visibly off-axis compared with its sibling controls (a bottom-centre Back button is normal, do not flag it)
- overlap: two elements or two text runs physically cover each other
- clipped: text is cut off, touches or crosses the edge of its panel
- spacing: in a repeated group (rows, cards, buttons) the gaps are measurably different from each other
- alignment: items that should share an edge or baseline visibly do not
- contrast: text that is hard to read against its background
Every finding MUST include "evidence": the exact visible text or element label you are talking about (copy it from the image), and "bbox": [x1,y1,x2,y2] pixel box of the defect in the image. A finding without exact evidence text and a bbox is invalid. Do not use generic statements.
If the screen looks clean, return {"findings":[]}.
Answer with JSON only: {"findings":[{"kind":"misplaced|overlap|clipped|spacing|alignment|contrast","severity":"high|medium|low","region":"where on the screen","evidence":"exact text/label","bbox":[0,0,0,0],"issue":"one sentence","fix":"one sentence"}]}`

func encodeImage(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func parseFindings(raw string) ([]Finding, error) {
	raw = strings.TrimSpace(raw)
	var wrapped struct {
		Findings []Finding `json:"findings"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapped); err == nil {
		return wrapped.Findings, nil
	}
	var bare []Finding
	if err := json.Unmarshal([]byte(raw), &bare); err != nil {
		return nil, fmt.Errorf("model returned non-JSON findings: %w", err)
	}
	return bare, nil
}

func reviewImage(ctx context.Context, client *http.Client, host, model, path, focus string) (Report, error) {
	encoded, err := encodeImage(path)
	if err != nil {
		return Report{}, err
	}
	user := "Review this screenshot."
	if focus != "" {
		user += " Pay special attention to: " + focus
	}
	body, err := json.Marshal(chatRequest{
		Model: model,
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: user, Images: []string{encoded}},
		},
		Stream:  false,
		Format:  "json",
		Options: map[string]any{"temperature": 0, "num_ctx": 8192},
	})
	if err != nil {
		return Report{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(host, "/")+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return Report{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return Report{}, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return Report{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return Report{}, fmt.Errorf("ollama %d: %s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}
	var parsed chatResponse
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return Report{}, err
	}
	if parsed.Error != "" {
		return Report{}, fmt.Errorf("ollama: %s", parsed.Error)
	}
	findings, err := parseFindings(parsed.Message.Content)
	if err != nil {
		return Report{}, err
	}
	return Report{Image: path, Findings: keepSupported(findings)}, nil
}

func newClient(timeout time.Duration) *http.Client {
	transport := &http.Transport{Proxy: nil}
	return &http.Client{Timeout: timeout, Transport: transport}
}

func keepSupported(findings []Finding) []Finding {
	kept := make([]Finding, 0, len(findings))
	for _, f := range findings {
		if strings.TrimSpace(f.Evidence) == "" || len(f.BBox) != 4 {
			continue
		}
		if f.BBox[2] <= f.BBox[0] || f.BBox[3] <= f.BBox[1] {
			continue
		}
		kept = append(kept, f)
	}
	return kept
}
