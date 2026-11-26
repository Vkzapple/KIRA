package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const maxCamFrame = 1 << 20 // 1 MB

// camFeed menyimpan frame terakhir dari ESP32-CAM supaya bisa ditonton
// realtime (MJPEG) dan dipakai halaman debug /camera.
type camFeed struct {
	mu       sync.RWMutex
	frame    []byte
	seq      uint64
	id       uint32 // id scan/frame dari firmware (dicocokkan dengan hasil AI)
	w, h     int
	src      string // "scan" atau "preview"
	deviceID string
	at       time.Time
	total    uint64
	recent   []time.Time
	subs     map[chan struct{}]struct{}
}

func newCamFeed() *camFeed {
	return &camFeed{subs: make(map[chan struct{}]struct{})}
}

func (c *camFeed) put(img []byte, id uint32, w, h int, src, deviceID string) (seq uint64) {
	now := time.Now()
	c.mu.Lock()
	c.frame = img
	c.seq++
	c.total++
	c.id, c.w, c.h, c.src, c.deviceID, c.at = id, w, h, src, deviceID, now
	seq = c.seq

	cut := now.Add(-5 * time.Second)
	keep := c.recent[:0]
	for _, t := range c.recent {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	c.recent = append(keep, now)

	subs := make([]chan struct{}, 0, len(c.subs))
	for ch := range c.subs {
		subs = append(subs, ch)
	}
	c.mu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	return seq
}

func (c *camFeed) subscribe() chan struct{} {
	ch := make(chan struct{}, 1)
	c.mu.Lock()
	c.subs[ch] = struct{}{}
	c.mu.Unlock()
	return ch
}

func (c *camFeed) unsubscribe(ch chan struct{}) {
	c.mu.Lock()
	delete(c.subs, ch)
	c.mu.Unlock()
}

func (c *camFeed) current() (img []byte, seq uint64) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.frame, c.seq
}

// fps rata-rata 5 detik terakhir.
func (c *camFeed) fps() float64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	cut := time.Now().Add(-5 * time.Second)
	n := 0
	for _, t := range c.recent {
		if t.After(cut) {
			n++
		}
	}
	return float64(n) / 5.0
}

// POST /api/cam/frame (device) — body JPEG mentah.
func (a *API) camFrame(w http.ResponseWriter, r *http.Request) {
	img, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCamFrame))
	if err != nil || len(img) < 4 {
		writeError(w, http.StatusBadRequest, "body gambar kosong atau terlalu besar")
		return
	}
	if img[0] != 0xFF || img[1] != 0xD8 {
		writeError(w, http.StatusBadRequest, "bukan JPEG")
		return
	}

	q := r.URL.Query()
	id64, _ := strconv.ParseUint(q.Get("id"), 10, 32)
	fw, _ := strconv.Atoi(q.Get("w"))
	fh, _ := strconv.Atoi(q.Get("h"))
	src := q.Get("src")
	if src == "" {
		src = "preview"
	}
	devID := firstNonEmpty(q.Get("device_id"), a.cfg.DeviceID)

	seq := a.cam.put(img, uint32(id64), fw, fh, src, devID)

	a.hub.Broadcast(map[string]any{
		"type": "cam_frame",
		"seq":  seq,
		"id":   uint32(id64),
		"size": len(img),
		"w":    fw,
		"h":    fh,
		"src":  src,
		"ts":   time.Now().UnixMilli(),
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "seq": seq})
}

// GET /api/cam/latest.jpg (sesi, token boleh lewat ?token=) — satu frame.
func (a *API) camLatest(w http.ResponseWriter, r *http.Request) {
	img, _ := a.cam.current()
	if len(img) == 0 {
		writeError(w, http.StatusNotFound, "belum ada frame dari ESP32-CAM")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(img)))
	_, _ = w.Write(img)
}

// GET /api/cam/stream (sesi, ?token=) — MJPEG realtime untuk <img src>.
func (a *API) camStream(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary=frame")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Connection", "close")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := a.cam.subscribe()
	defer a.cam.unsubscribe(ch)

	var last uint64
	write := func() bool {
		img, seq := a.cam.current()
		if len(img) == 0 || seq == last {
			return true
		}
		last = seq
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprintf(w, "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", len(img)); err != nil {
			return false
		}
		if _, err := w.Write(img); err != nil {
			return false
		}
		if _, err := w.Write([]byte("\r\n")); err != nil {
			return false
		}
		return rc.Flush() == nil
	}

	if !write() {
		return
	}
	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ch:
			if !write() {
				return
			}
		case <-keepalive.C:
			// kirim ulang frame terakhir supaya proxy/browser tidak menutup koneksi
			last = 0
			if !write() {
				return
			}
		}
	}
}

// GET /api/cam/state (sesi) — ringkasan untuk halaman debug.
func (a *API) camState(w http.ResponseWriter, r *http.Request) {
	a.cam.mu.RLock()
	frame := map[string]any{
		"seq":      a.cam.seq,
		"id":       a.cam.id,
		"size":     len(a.cam.frame),
		"w":        a.cam.w,
		"h":        a.cam.h,
		"src":      a.cam.src,
		"deviceId": a.cam.deviceID,
		"total":    a.cam.total,
		"hasFrame": len(a.cam.frame) > 0,
	}
	if !a.cam.at.IsZero() {
		frame["at"] = a.cam.at.UTC()
		frame["ageMs"] = time.Since(a.cam.at).Milliseconds()
	}
	a.cam.mu.RUnlock()

	result, status := a.hub.CamLast()
	out := map[string]any{
		"frame": frame,
		"fps":   a.cam.fps(),
	}
	if len(result) > 0 {
		out["result"] = json.RawMessage(result)
	}
	if len(status) > 0 {
		out["status"] = json.RawMessage(status)
	}
	writeJSON(w, http.StatusOK, out)
}
