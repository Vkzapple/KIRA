package store

import (
	"context"
	"errors"
	"time"

	"grenvis/server/internal/model"
)

var ErrNotFound = errors.New("not found")

type SaveSnapshotInput struct {
	DeviceID    string
	PlantName   string
	Class       string
	Confidence  float64
	CapturedAt  time.Time
	Image       []byte
	ContentType string
}

// Store adalah abstraksi database. Implementasi:
//   - local.go    : mode development tanpa Supabase (file + memori)
//   - supabase.go : Postgres + Storage Supabase
type Store interface {
	SaveTelemetry(ctx context.Context, t model.Telemetry) error
	SaveDetection(ctx context.Context, d model.Detection) error
	SaveSnapshot(ctx context.Context, in SaveSnapshotInput) (model.Snapshot, error)
	LatestSnapshot(ctx context.Context) (*model.Snapshot, error)
	ListSnapshots(ctx context.Context, limit int) ([]model.Snapshot, error)
	ListTelemetry(ctx context.Context, limit int) ([]model.Telemetry, error)
	UpsertDevice(ctx context.Context, d model.Device) error
	Mode() string
}
