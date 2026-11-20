package store

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"kira/server/internal/id"
	"kira/server/internal/model"
)

// Local adalah mode tanpa Supabase: metadata disimpan di memori
// (hilang saat restart) dan file gambar disimpan di DATA_DIR.
// Cocok untuk development / demo di laptop.
type Local struct {
	mu         sync.RWMutex
	dir        string
	publicBase string
	telemetry  []model.Telemetry
	snapshots  []model.Snapshot
	detections []model.Detection
}

func NewLocal(dir, publicBase string) (*Local, error) {
	imgDir := filepath.Join(dir, "snapshots")
	if err := os.MkdirAll(imgDir, 0o755); err != nil {
		return nil, err
	}
	return &Local{dir: imgDir, publicBase: strings.TrimRight(publicBase, "/")}, nil
}

func (l *Local) Mode() string { return "local" }

func (l *Local) SaveTelemetry(_ context.Context, t model.Telemetry) error {
	if t.CreatedAt.IsZero() {
		t.CreatedAt = time.Now()
	}
	l.mu.Lock()
	l.telemetry = append(l.telemetry, t)
	if len(l.telemetry) > 2000 {
		l.telemetry = l.telemetry[len(l.telemetry)-2000:]
	}
	l.mu.Unlock()
	return nil
}

func (l *Local) SaveDetection(_ context.Context, d model.Detection) error {
	if d.CreatedAt.IsZero() {
		d.CreatedAt = time.Now()
	}
	l.mu.Lock()
	l.detections = append(l.detections, d)
	if len(l.detections) > 500 {
		l.detections = l.detections[len(l.detections)-500:]
	}
	l.mu.Unlock()
	return nil
}

func (l *Local) SaveSnapshot(_ context.Context, in SaveSnapshotInput) (model.Snapshot, error) {
	snapID := id.New()
	ext := ".jpg"
	if strings.Contains(in.ContentType, "png") {
		ext = ".png"
	}
	name := snapID + ext
	if err := os.WriteFile(filepath.Join(l.dir, name), in.Image, 0o644); err != nil {
		return model.Snapshot{}, err
	}
	if in.CapturedAt.IsZero() {
		in.CapturedAt = time.Now()
	}
	if in.PlantName == "" {
		in.PlantName = "Tanaman KIRA"
	}
	snap := model.Snapshot{
		ID:         snapID,
		DeviceID:   in.DeviceID,
		PlantName:  in.PlantName,
		ImageURL:   l.publicBase + "/media/" + name,
		Class:      in.Class,
		Confidence: in.Confidence,
		CapturedAt: in.CapturedAt,
		CreatedAt:  time.Now(),
	}
	l.mu.Lock()
	l.snapshots = append([]model.Snapshot{snap}, l.snapshots...)
	if len(l.snapshots) > 200 {
		l.snapshots = l.snapshots[:200]
	}
	l.mu.Unlock()
	return snap, nil
}

func (l *Local) LatestSnapshot(_ context.Context) (*model.Snapshot, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if len(l.snapshots) == 0 {
		return nil, ErrNotFound
	}
	s := l.snapshots[0]
	return &s, nil
}

func (l *Local) ListSnapshots(_ context.Context, limit int) ([]model.Snapshot, error) {
	if limit <= 0 || limit > 200 {
		limit = 20
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]model.Snapshot, 0, limit)
	for i := 0; i < len(l.snapshots) && len(out) < limit; i++ {
		out = append(out, l.snapshots[i])
	}
	return out, nil
}

func (l *Local) ListTelemetry(_ context.Context, limit int) ([]model.Telemetry, error) {
	if limit <= 0 || limit > 2000 {
		limit = 100
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	items := make([]model.Telemetry, len(l.telemetry))
	copy(items, l.telemetry)
	sort.SliceStable(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (l *Local) UpsertDevice(_ context.Context, _ model.Device) error { return nil }
