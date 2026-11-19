package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"grenvis/server/internal/id"
	"grenvis/server/internal/model"
)

// Supabase memakai PostgREST (tabel) dan Storage API.
// Service role key hanya dipakai di server, jangan pernah dikirim ke browser.
type Supabase struct {
	base   string
	key    string
	bucket string
	http   *http.Client
}

func NewSupabase(base, key, bucket string) *Supabase {
	return &Supabase{
		base:   strings.TrimRight(base, "/"),
		key:    key,
		bucket: bucket,
		http:   &http.Client{Timeout: 25 * time.Second},
	}
}

func (s *Supabase) Mode() string { return "supabase" }

type telemetryRow struct {
	DeviceID  string `json:"device_id"`
	SoilPct   int    `json:"soil_pct"`
	SoilRaw   int    `json:"soil_raw"`
	RainPct   int    `json:"rain_pct"`
	RainRaw   int    `json:"rain_raw"`
	RainWet   bool   `json:"rain_wet"`
	SyncAngle int    `json:"sync_angle"`
	AuxAngle  int    `json:"aux_angle"`
	CamOnline bool   `json:"cam_online"`
	CamArmed  bool   `json:"cam_armed"`
	CamBusy   bool   `json:"cam_busy"`
	CamTarget string `json:"cam_target"`
	RSSI      int    `json:"rssi"`
	Uptime    int64  `json:"uptime_s"`
	CreatedAt string `json:"created_at"`
}

type snapshotRow struct {
	ID         string  `json:"id"`
	DeviceID   string  `json:"device_id"`
	PlantName  string  `json:"plant_name"`
	ImagePath  string  `json:"image_path"`
	ImageURL   string  `json:"image_url"`
	ClassName  string  `json:"class_name"`
	Confidence float64 `json:"confidence"`
	CapturedAt string  `json:"captured_at"`
	CreatedAt  string  `json:"created_at"`
}

type detectionRow struct {
	ID              string  `json:"id"`
	DeviceID        string  `json:"device_id"`
	ClassName       string  `json:"class_name"`
	Confidence      float64 `json:"confidence"`
	PredictionCount int     `json:"prediction_count"`
	ImageURL        string  `json:"image_url"`
	CreatedAt       string  `json:"created_at"`
}

func (s *Supabase) SaveTelemetry(ctx context.Context, t model.Telemetry) error {
	if t.CreatedAt.IsZero() {
		t.CreatedAt = time.Now()
	}
	row := telemetryRow{
		DeviceID:  t.DeviceID,
		SoilPct:   t.Soil,
		SoilRaw:   t.SoilRaw,
		RainPct:   t.Rain,
		RainRaw:   t.RainRaw,
		RainWet:   t.RainWet,
		SyncAngle: t.Sync,
		AuxAngle:  t.Aux,
		CamOnline: t.CamOnline,
		CamArmed:  t.CamArmed,
		CamBusy:   t.CamBusy,
		CamTarget: t.CamTarget,
		RSSI:      t.RSSI,
		Uptime:    t.Uptime,
		CreatedAt: t.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	_, err := s.postJSON(ctx, "/rest/v1/telemetry", row, "return=minimal")
	return err
}

func (s *Supabase) SaveDetection(ctx context.Context, d model.Detection) error {
	if d.CreatedAt.IsZero() {
		d.CreatedAt = time.Now()
	}
	if d.ID == "" {
		d.ID = id.New()
	}
	row := detectionRow{
		ID:              d.ID,
		DeviceID:        d.DeviceID,
		ClassName:       d.Class,
		Confidence:      d.Confidence,
		PredictionCount: d.Count,
		ImageURL:        d.ImageURL,
		CreatedAt:       d.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	_, err := s.postJSON(ctx, "/rest/v1/detections", row, "return=minimal")
	return err
}

func (s *Supabase) SaveSnapshot(ctx context.Context, in SaveSnapshotInput) (model.Snapshot, error) {
	if in.CapturedAt.IsZero() {
		in.CapturedAt = time.Now()
	}
	if in.PlantName == "" {
		in.PlantName = "Tanaman GRENVIS"
	}

	snapID := id.New()
	ext := ".jpg"
	contentType := in.ContentType
	if strings.Contains(contentType, "png") {
		ext = ".png"
		contentType = "image/png"
	} else {
		contentType = "image/jpeg"
	}

	path := fmt.Sprintf("%s/%s/%s%s", safeSegment(in.DeviceID), in.CapturedAt.UTC().Format("2006/01/02"), snapID, ext)
	if err := s.uploadObject(ctx, path, in.Image, contentType); err != nil {
		return model.Snapshot{}, err
	}

	publicURL := fmt.Sprintf("%s/storage/v1/object/public/%s/%s", s.base, url.PathEscape(s.bucket), path)
	row := snapshotRow{
		ID:         snapID,
		DeviceID:   in.DeviceID,
		PlantName:  in.PlantName,
		ImagePath:  path,
		ImageURL:   publicURL,
		ClassName:  in.Class,
		Confidence: in.Confidence,
		CapturedAt: in.CapturedAt.UTC().Format(time.RFC3339Nano),
		CreatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
	}
	if _, err := s.postJSON(ctx, "/rest/v1/snapshots", row, "return=minimal"); err != nil {
		return model.Snapshot{}, err
	}

	// Riwayat deteksi ditulis dari pesan `detection` yang dikirim ESP32-CAM,
	// supaya tidak dobel dengan snapshot yang sama.
	return model.Snapshot{
		ID:         snapID,
		DeviceID:   in.DeviceID,
		PlantName:  in.PlantName,
		ImageURL:   publicURL,
		Class:      in.Class,
		Confidence: in.Confidence,
		CapturedAt: in.CapturedAt,
		CreatedAt:  time.Now(),
	}, nil
}

func (s *Supabase) LatestSnapshot(ctx context.Context) (*model.Snapshot, error) {
	rows, err := s.getSnapshots(ctx, 1)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return &rows[0], nil
}

func (s *Supabase) ListSnapshots(ctx context.Context, limit int) ([]model.Snapshot, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return s.getSnapshots(ctx, limit)
}

func (s *Supabase) getSnapshots(ctx context.Context, limit int) ([]model.Snapshot, error) {
	q := "/rest/v1/snapshots?select=id,device_id,plant_name,image_path,image_url,class_name,confidence,captured_at,created_at&order=captured_at.desc&limit=" + fmt.Sprint(limit)
	body, err := s.get(ctx, q)
	if err != nil {
		return nil, err
	}
	var rows []snapshotRow
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("decode snapshots: %w", err)
	}
	out := make([]model.Snapshot, 0, len(rows))
	for _, r := range rows {
		out = append(out, model.Snapshot{
			ID:         r.ID,
			DeviceID:   r.DeviceID,
			PlantName:  r.PlantName,
			ImageURL:   r.ImageURL,
			Class:      r.ClassName,
			Confidence: r.Confidence,
			CapturedAt: parseTime(r.CapturedAt),
			CreatedAt:  parseTime(r.CreatedAt),
		})
	}
	return out, nil
}

func (s *Supabase) ListTelemetry(ctx context.Context, limit int) ([]model.Telemetry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	q := "/rest/v1/telemetry?select=device_id,soil_pct,soil_raw,rain_pct,rain_raw,rain_wet,sync_angle,aux_angle,cam_online,cam_armed,cam_busy,cam_target,rssi,uptime_s,created_at&order=created_at.desc&limit=" + fmt.Sprint(limit)
	body, err := s.get(ctx, q)
	if err != nil {
		return nil, err
	}
	var rows []telemetryRow
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("decode telemetry: %w", err)
	}
	out := make([]model.Telemetry, 0, len(rows))
	for _, r := range rows {
		out = append(out, model.Telemetry{
			DeviceID:  r.DeviceID,
			Soil:      r.SoilPct,
			SoilRaw:   r.SoilRaw,
			Rain:      r.RainPct,
			RainRaw:   r.RainRaw,
			RainWet:   r.RainWet,
			Sync:      r.SyncAngle,
			Aux:       r.AuxAngle,
			CamOnline: r.CamOnline,
			CamArmed:  r.CamArmed,
			CamBusy:   r.CamBusy,
			CamTarget: r.CamTarget,
			RSSI:      r.RSSI,
			Uptime:    r.Uptime,
			CreatedAt: parseTime(r.CreatedAt),
		})
	}
	return out, nil
}

func (s *Supabase) UpsertDevice(ctx context.Context, d model.Device) error {
	if d.LastSeen.IsZero() {
		d.LastSeen = time.Now()
	}
	row := map[string]any{
		"id":        d.ID,
		"name":      d.Name,
		"kind":      d.Kind,
		"firmware":  d.Firmware,
		"ip":        d.IP,
		"last_seen": d.LastSeen.UTC().Format(time.RFC3339Nano),
	}
	_, err := s.postJSON(ctx, "/rest/v1/devices?on_conflict=id", row, "resolution=merge-duplicates,return=minimal")
	return err
}

func (s *Supabase) uploadObject(ctx context.Context, path string, data []byte, contentType string) error {
	endpoint := fmt.Sprintf("%s/storage/v1/object/%s/%s", s.base, url.PathEscape(s.bucket), path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Cache-Control", "3600")
	req.Header.Set("x-upsert", "true")

	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("storage upload %d: %s", res.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}

func (s *Supabase) postJSON(ctx context.Context, path string, payload any, prefer string) ([]byte, error) {
	buf, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.base+path, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Content-Type", "application/json")
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}
	res, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 8192))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase POST %s: %d %s", path, res.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

func (s *Supabase) get(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Accept", "application/json")
	res, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase GET %s: %d %s", path, res.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

func parseTime(v string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return time.Time{}
	}
	return t
}

func safeSegment(v string) string {
	if v == "" {
		return "unknown"
	}
	var b strings.Builder
	for _, r := range v {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	return b.String()
}
