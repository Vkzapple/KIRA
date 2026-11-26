package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"kira/server/internal/config"
	"kira/server/internal/model"
	"kira/server/internal/session"
	"kira/server/internal/store"
	"kira/server/internal/ws"
)

type API struct {
	cfg      config.Config
	log      *slog.Logger
	hub      *ws.Hub
	store    store.Store
	sessions *session.Store
	cam      *camFeed
}

func New(cfg config.Config, log *slog.Logger, hub *ws.Hub, st store.Store, sessions *session.Store) *API {
	return &API{cfg: cfg, log: log, hub: hub, store: st, sessions: sessions, cam: newCamFeed()}
}

func (a *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(a.recoverer)
	r.Use(a.logRequests)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   a.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Device-Token", "X-Device-Id"},
		ExposedHeaders:   []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/api/health", a.health)
	r.Post("/api/auth/login", a.login)
	r.Handle("/media/*", http.StripPrefix("/media/", http.FileServer(http.Dir(filepath.Join(a.cfg.DataDir, "snapshots")))))

	// Baca-saja publik: kartu "Foto terakhir" di beranda tampil
	// sebelum pengguna menghubungkan robot. Isinya bukan data sensitif.
	r.Get("/api/snapshots/latest", a.snapshotLatest)
	r.Get("/api/snapshots", a.snapshotList)
	r.Get("/api/telemetry/latest", a.telemetryLatest)

	r.Group(func(r chi.Router) {
		r.Use(a.sessionAuth)

		r.Post("/api/auth/logout", a.logout)
		r.Get("/api/state", a.state)
		r.Get("/api/telemetry", a.telemetryList)
		r.Get("/ws/dashboard", a.hub.ServeDashboard)

		// Debug kamera realtime (token boleh lewat ?token= supaya bisa dipakai <img src>)
		r.Get("/api/cam/stream", a.camStream)
		r.Get("/api/cam/latest.jpg", a.camLatest)
		r.Get("/api/cam/state", a.camState)
	})

	r.Group(func(r chi.Router) {
		r.Use(a.deviceAuth)

		r.Post("/api/snapshots", a.uploadSnapshot)
		r.Post("/api/detections", a.createDetection)
		r.Post("/api/cam/frame", a.camFrame)
		r.Get("/ws/device", a.hub.ServeDevice)
	})

	return r
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"store": a.store.Mode(),
		"time":  time.Now().UTC(),
	})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body JSON tidak valid")
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Password), []byte(a.cfg.RobotPassword)) != 1 {
		writeError(w, http.StatusUnauthorized, "Password robot salah.")
		return
	}
	token, exp, err := a.sessions.Issue()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "gagal membuat sesi")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"expiresAt": exp.UTC(),
	})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	a.sessions.Revoke(tokenFrom(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) state(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	t, has, online, last, deviceID := a.hub.Snapshot()
	if !has {
		if list, err := a.store.ListTelemetry(ctx, 1); err == nil && len(list) > 0 {
			t = list[0]
			has = true
			deviceID = t.DeviceID
		}
	}
	if deviceID == "" {
		deviceID = a.cfg.DeviceID
	}

	device := map[string]any{
		"id":     deviceID,
		"online": online,
	}
	if !last.IsZero() {
		device["lastSeen"] = last.UTC()
	}

	var snap *model.Snapshot
	if s, err := a.store.LatestSnapshot(ctx); err == nil {
		snap = s
	} else if !errors.Is(err, store.ErrNotFound) {
		a.log.Warn("gagal mengambil snapshot terakhir", "err", err)
	}

	resp := map[string]any{
		"device":    device,
		"telemetry": nil,
		"snapshot":  nil,
	}
	if has {
		resp["telemetry"] = t
	}
	if snap != nil {
		resp["snapshot"] = snap
	}
	writeJSON(w, http.StatusOK, resp)
}

func (a *API) telemetryLatest(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if t, has, _, _, _ := a.hub.Snapshot(); has {
		writeJSON(w, http.StatusOK, t)
		return
	}
	list, err := a.store.ListTelemetry(ctx, 1)
	if err != nil {
		a.log.Warn("gagal membaca telemetry", "err", err)
		writeError(w, http.StatusBadGateway, "gagal membaca telemetry")
		return
	}
	if len(list) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, list[0])
}

func (a *API) telemetryList(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 100, 1, 1000)
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	list, err := a.store.ListTelemetry(ctx, limit)
	if err != nil {
		a.log.Warn("gagal membaca riwayat telemetry", "err", err)
		writeError(w, http.StatusBadGateway, "gagal membaca telemetry")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"telemetry": list})
}

func (a *API) snapshotLatest(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	snap, err := a.store.LatestSnapshot(ctx)
	if errors.Is(err, store.ErrNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		a.log.Warn("gagal membaca snapshot", "err", err)
		writeError(w, http.StatusBadGateway, "gagal membaca snapshot")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (a *API) snapshotList(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 20, 1, 100)
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	list, err := a.store.ListSnapshots(ctx, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, "gagal membaca snapshot")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshots": list})
}

func (a *API) uploadSnapshot(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 12<<20)

	var img []byte
	var contentType string
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(12 << 20); err != nil {
			writeError(w, http.StatusBadRequest, "multipart tidak valid")
			return
		}
		file, header, err := r.FormFile("image")
		if err != nil {
			writeError(w, http.StatusBadRequest, "field image wajib ada")
			return
		}
		defer file.Close()
		img, err = io.ReadAll(file)
		if err != nil {
			writeError(w, http.StatusBadRequest, "gagal membaca image")
			return
		}
		contentType = header.Header.Get("Content-Type")
	} else {
		var err error
		img, err = io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "gagal membaca body")
			return
		}
		contentType = r.Header.Get("Content-Type")
	}

	if len(img) == 0 {
		writeError(w, http.StatusBadRequest, "image kosong")
		return
	}
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(img)
	}
	if !strings.HasPrefix(contentType, "image/jpeg") && !strings.HasPrefix(contentType, "image/png") {
		writeError(w, http.StatusUnsupportedMediaType, "hanya JPEG/PNG")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	deviceID := firstNonEmpty(r.URL.Query().Get("device_id"), r.Header.Get("X-Device-Id"), a.cfg.DeviceID)
	plantName := firstNonEmpty(r.URL.Query().Get("plant_name"), a.cfg.PlantName)
	className := r.URL.Query().Get("class")
	confidence, _ := strconv.ParseFloat(r.URL.Query().Get("confidence"), 64)

	capturedAt := time.Now()
	if v := r.URL.Query().Get("captured_at"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			capturedAt = t
		}
	}

	snap, err := a.store.SaveSnapshot(ctx, store.SaveSnapshotInput{
		DeviceID:    deviceID,
		PlantName:   plantName,
		Class:       className,
		Confidence:  confidence,
		CapturedAt:  capturedAt,
		Image:       img,
		ContentType: contentType,
	})
	if err != nil {
		a.log.Error("gagal menyimpan snapshot", "err", err)
		writeError(w, http.StatusBadGateway, "gagal menyimpan snapshot")
		return
	}

	// Hash foto (SHA256) untuk referensi tanpa kirim raw ke AI service.
	hash := sha256.Sum256(img)
	snap.Hash = hex.EncodeToString(hash[:])

	a.hub.Broadcast(map[string]any{"type": "snapshot", "snapshot": snap})

	// Analisis AI berjalan di background supaya upload dari ESP32-CAM tidak
	// menunggu (timeout firmware 15 detik). Hasilnya disiarkan ulang dengan id sama.
	if a.cfg.AIServiceURL != "" {
		go a.analyzeSnapshot(snap, img)
	}
	a.log.Info("snapshot baru", "id", snap.ID, "class", snap.Class, "hash", snap.Hash, "bytes", len(img), "device", snap.DeviceID)
	writeJSON(w, http.StatusCreated, map[string]any{"snapshot": snap})
}

func (a *API) createDetection(w http.ResponseWriter, r *http.Request) {
	var d model.Detection
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&d); err != nil {
		writeError(w, http.StatusBadRequest, "body JSON tidak valid")
		return
	}
	if d.Class == "" {
		writeError(w, http.StatusBadRequest, "class wajib ada")
		return
	}
	if d.DeviceID == "" {
		d.DeviceID = firstNonEmpty(r.URL.Query().Get("device_id"), a.cfg.DeviceID)
	}
	if d.CreatedAt.IsZero() {
		d.CreatedAt = time.Now()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if err := a.store.SaveDetection(ctx, d); err != nil {
		a.log.Warn("gagal menyimpan detection", "err", err)
	}

	a.hub.Broadcast(map[string]any{"type": "detection", "detection": d})
	writeJSON(w, http.StatusCreated, map[string]any{"detection": d})
}

func (a *API) sessionAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.sessions.Valid(tokenFrom(r)) {
			writeError(w, http.StatusUnauthorized, "sesi tidak valid atau sudah kedaluwarsa")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) deviceAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := r.Header.Get("X-Device-Token")
		if provided == "" {
			provided = tokenFrom(r)
		}
		if subtle.ConstantTimeCompare([]byte(provided), []byte(a.cfg.DeviceToken)) != 1 {
			writeError(w, http.StatusUnauthorized, "device token salah")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		a.log.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"bytes", ww.BytesWritten(),
			"durasi", time.Since(start).Round(time.Millisecond).String(),
		)
	})
}

func (a *API) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				a.log.Error("panic", "recover", rec, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func tokenFrom(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func queryInt(r *http.Request, key string, fallback, min, max int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return fallback
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}

var aiClient = &http.Client{Timeout: 60 * time.Second}

// analyzeSnapshot mengirim foto ke kira-ml-service (/analyze) lalu menyiarkan
// snapshot yang sudah berisi hasil analisis.
func (a *API) analyzeSnapshot(snap model.Snapshot, img []byte) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", "snapshot.jpg")
	if err != nil {
		a.log.Warn("gagal buat form AI", "err", err)
		return
	}
	_, _ = part.Write(img)
	_ = mw.WriteField("hash", snap.Hash)
	if err := mw.Close(); err != nil {
		a.log.Warn("gagal menutup form AI", "err", err)
		return
	}

	req, err := http.NewRequest(http.MethodPost, a.cfg.AIServiceURL+"/analyze", &buf)
	if err != nil {
		a.log.Warn("gagal buat request AI", "err", err, "url", a.cfg.AIServiceURL)
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := aiClient.Do(req)
	if err != nil {
		a.log.Warn("gagal panggil AI service", "err", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		a.log.Warn("AI service menolak", "status", resp.StatusCode, "body", string(body))
		return
	}

	var res map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		a.log.Warn("respons AI bukan JSON", "err", err)
		return
	}
	snap.Analysis = res
	if list, ok := res["results"].([]any); ok && len(list) > 0 {
		if first, ok := list[0].(map[string]any); ok {
			if cls, ok := first["class"].(string); ok {
				snap.Class = cls
			}
			if conf, ok := first["confidence"].(float64); ok {
				snap.Confidence = conf
			}
		}
	}
	a.hub.Broadcast(map[string]any{"type": "snapshot", "snapshot": snap})
	a.log.Info("analisis AI selesai", "id", snap.ID, "class", snap.Class)
}
