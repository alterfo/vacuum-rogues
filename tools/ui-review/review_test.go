package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseFindingsAcceptsWrappedAndBare(t *testing.T) {
	wrapped, err := parseFindings(`{"findings":[{"kind":"overlap","severity":"high","region":"top","issue":"a","fix":"b"}]}`)
	if err != nil || len(wrapped) != 1 || wrapped[0].Kind != "overlap" {
		t.Fatalf("wrapped: %v %v", wrapped, err)
	}
	bare, err := parseFindings(`[{"kind":"spacing"}]`)
	if err != nil || len(bare) != 1 {
		t.Fatalf("bare: %v %v", bare, err)
	}
	if _, err := parseFindings("not json"); err == nil {
		t.Fatal("expected error")
	}
}

func TestReviewImageSendsImageAndParsesReply(t *testing.T) {
	var got chatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(chatResponse{Message: chatMessage{Content: `{"findings":[{"kind":"clipped","severity":"medium","region":"left","evidence":"Склад","bbox":[1,2,30,40],"issue":"x","fix":"y"},{"kind":"overlap","evidence":"","bbox":[0,0,0,0]}]}`}})
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "shot.png")
	if err := os.WriteFile(path, []byte("png-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	report, err := reviewImage(ctx, newClient(5*time.Second), server.URL, "m", path, "close button")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Findings) != 1 || report.Findings[0].Kind != "clipped" {
		t.Fatalf("findings: %+v", report.Findings)
	}
	if got.Model != "m" || got.Format != "json" || len(got.Messages) != 2 || len(got.Messages[1].Images) != 1 {
		t.Fatalf("request: %+v", got)
	}
}

func TestReviewImageSurfacesServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "model not found", http.StatusNotFound)
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "shot.png")
	_ = os.WriteFile(path, []byte("x"), 0o600)
	_, err := reviewImage(context.Background(), newClient(5*time.Second), server.URL, "m", path, "")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestKeepSupportedDropsFindingsWithoutEvidenceOrBox(t *testing.T) {
	kept := keepSupported([]Finding{
		{Evidence: "Назад", BBox: []int{1, 1, 5, 5}},
		{Evidence: "", BBox: []int{1, 1, 5, 5}},
		{Evidence: "x", BBox: []int{1, 1}},
		{Evidence: "x", BBox: []int{5, 5, 1, 1}},
	})
	if len(kept) != 1 || kept[0].Evidence != "Назад" {
		t.Fatalf("kept: %+v", kept)
	}
}
