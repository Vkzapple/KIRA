package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"grenvis/server/internal/id"
	"grenvis/server/internal/model"
)

type Role string

const (
	RoleDashboard Role = "dashboard"
	RoleDevice    Role = "device"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 70 * time.Second
	pingPeriod = 25 * time.Second
	maxMsgSize = 1 << 20
	sendBuffer = 64
)

type Hooks struct {
	OnTelemetry func(model.Telemetry)
	OnDetection func(model.Detection)
	OnDevice    func(model.Device)
}

// Hub menyimpan koneksi dashboard (browser) dan device (ESP32),
// meneruskan perintah, dan menyiarkan telemetry/deteksi.
type Hub struct {
	log      *slog.Logger
	hooks    Hooks
	origins  []string
	upgrader websocket.Upgrader

	mu         sync.RWMutex
	clients    map[*Client]struct{}
	devices    map[string]*Client
	latest     model.Telemetry
	hasLatest  bool
	lastSeen   map[string]time.Time
	deviceInfo map[string]model.Device

	// Status kamera dikelola terpisah supaya telemetry Dev tidak menimpanya.
	camOnline bool
	camArmed  bool
	camBusy   bool
	camTarget string
}

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	role     Role
	deviceID string

	sendMu sync.Mutex
	closed bool
	send   chan []byte
}

func NewHub(log *slog.Logger, origins []string, hooks Hooks) *Hub {
	h := &Hub{
		log:        log,
		hooks:      hooks,
		origins:    origins,
		clients:    make(map[*Client]struct{}),
		devices:    make(map[string]*Client),
		lastSeen:   make(map[string]time.Time),
		deviceInfo: make(map[string]model.Device),
	}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin:     h.checkOrigin,
	}
	return h
}

func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // bukan browser (ESP32 / tools)
	}
	for _, allowed := range h.origins {
		if allowed == "*" || strings.EqualFold(strings.TrimRight(allowed, "/"), strings.TrimRight(origin, "/")) {
			return true
		}
	}
	return false
}

func (h *Hub) ServeDashboard(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Warn("ws dashboard upgrade gagal", "err", err)
		return
	}
	c := &Client{hub: h, conn: conn, role: RoleDashboard, send: make(chan []byte, sendBuffer)}
	h.register(c)
	h.sendReady(c)
	go c.writePump()
	c.readPump()
}

func (h *Hub) ServeDevice(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Warn("ws device upgrade gagal", "err", err)
		return
	}
	c := &Client{hub: h, conn: conn, role: RoleDevice, send: make(chan []byte, sendBuffer)}
	h.register(c)
	go c.writePump()
	c.readPump()
}

func (h *Hub) register(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; !ok {
		h.mu.Unlock()
		return
	}
	delete(h.clients, c)
	deviceID := c.deviceID
	isCurrent := deviceID != "" && h.devices[deviceID] == c
	if isCurrent {
		delete(h.devices, deviceID)
	}
	last := h.lastSeen[deviceID]
	info := h.deviceInfo[deviceID]
	camGone := isCurrent && info.Kind == "esp32cam"
	var camState model.Telemetry
	if camGone {
		// Kamera yang putus tidak boleh tetap tampil "online" di dashboard.
		h.camOnline = false
		h.camBusy = false
		if h.hasLatest {
			h.latest.CamOnline = false
			h.latest.CamBusy = false
			h.latest.CreatedAt = time.Now().UTC()
			camState = h.latest
		}
	}
	h.mu.Unlock()

	c.closeSend()
	_ = c.conn.Close()

	if camGone {
		h.broadcast(map[string]any{"type": "telemetry", "telemetry": camState, "deviceOnline": len(h.devices) > 0})
		h.log.Info("kamera terputus", "id", deviceID)
	}

	if isCurrent {
		h.broadcast(map[string]any{
			"type":         "device_status",
			"deviceId":     deviceID,
			"online":       false,
			"deviceOnline": len(h.devices) > 0,
			"lastSeen":     last.UTC(),
		})
	}
	h.log.Info("ws client keluar", "role", c.role, "device", deviceID)
}

func (h *Hub) sendReady(c *Client) {
	h.mu.RLock()
	online := len(h.devices) > 0
	var latest model.Telemetry
	hasLatest := h.hasLatest
	if hasLatest {
		latest = h.latest
		latest.CamOnline = h.camOnline
		latest.CamArmed = h.camArmed
		latest.CamBusy = h.camBusy
		latest.CamTarget = h.camTarget
	}
	var last time.Time
	deviceID := ""
	for did, d := range h.devices {
		deviceID = did
		_ = d
	}
	for _, t := range h.lastSeen {
		if t.After(last) {
			last = t
		}
	}
	h.mu.RUnlock()

	msg := map[string]any{
		"type":         "ready",
		"serverTime":   time.Now().UTC(),
		"deviceOnline": online,
	}
	if deviceID != "" {
		msg["deviceId"] = deviceID
	}
	if !last.IsZero() {
		msg["lastSeen"] = last.UTC()
	}
	if hasLatest {
		msg["telemetry"] = latest
	}
	c.enqueue(msg)
}

// Snapshot mengembalikan kondisi terakhir untuk REST /api/state.
func (h *Hub) Snapshot() (t model.Telemetry, has bool, online bool, last time.Time, deviceID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	has = h.hasLatest
	t = h.latest
	t.CamOnline = h.camOnline
	t.CamArmed = h.camArmed
	t.CamBusy = h.camBusy
	t.CamTarget = h.camTarget
	online = len(h.devices) > 0
	for did := range h.devices {
		deviceID = did
	}
	for _, ts := range h.lastSeen {
		if ts.After(last) {
			last = ts
		}
	}
	return
}

// Broadcast mengirim event ke semua dashboard.
func (h *Hub) Broadcast(v any) {
	h.broadcast(v)
}

func (h *Hub) broadcast(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.RLock()
	dashboards := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		if c.role == RoleDashboard {
			dashboards = append(dashboards, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range dashboards {
		c.enqueueRaw(b)
	}
}

func (h *Hub) sendToDevices(data []byte) int {
	h.mu.RLock()
	targets := make([]*Client, 0, len(h.devices))
	for _, d := range h.devices {
		targets = append(targets, d)
	}
	h.mu.RUnlock()
	for _, d := range targets {
		d.enqueueRaw(data)
	}
	return len(targets)
}

func (h *Hub) touch(c *Client) {
	h.mu.Lock()
	if c.deviceID != "" {
		h.lastSeen[c.deviceID] = time.Now()
	}
	h.mu.Unlock()
}

func (h *Hub) bindDevice(c *Client, deviceID string, info model.Device) {
	deviceID = sanitizeID(deviceID)
	if deviceID == "" {
		deviceID = "grenvis-device"
	}
	now := time.Now()
	info.ID = deviceID
	info.LastSeen = now

	h.mu.Lock()
	c.deviceID = deviceID
	h.devices[deviceID] = c
	h.lastSeen[deviceID] = now
	h.deviceInfo[deviceID] = info
	h.mu.Unlock()

	h.broadcast(map[string]any{
		"type":         "device_status",
		"deviceId":     deviceID,
		"online":       true,
		"deviceOnline": true,
		"lastSeen":     now.UTC(),
		"info":         info,
	})
	if h.hooks.OnDevice != nil {
		h.hooks.OnDevice(info)
	}
	h.log.Info("device terhubung", "id", deviceID, "ip", info.IP)
}

func (h *Hub) handleMessage(c *Client, data []byte) {
	var env struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		c.enqueue(map[string]any{"type": "error", "message": "JSON tidak valid"})
		return
	}
	if env.Type == "" {
		c.enqueue(map[string]any{"type": "error", "message": "field type wajib ada"})
		return
	}

	if c.role == RoleDashboard {
		h.handleDashboard(c, data, env.Type)
		return
	}
	h.handleDevice(c, data, env.Type)
}

func (h *Hub) handleDashboard(c *Client, data []byte, typ string) {
	switch typ {
	case "move", "probe", "camera", "servo", "ai", "capture":
	case "ping":
		c.enqueue(map[string]any{"type": "pong"})
		return
	default:
		c.enqueue(map[string]any{"type": "error", "message": "perintah tidak dikenal: " + typ})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		c.enqueue(map[string]any{"type": "error", "message": "payload tidak valid"})
		return
	}
	cmdID, _ := payload["id"].(string)
	if cmdID == "" {
		cmdID = id.New()
		payload["id"] = cmdID
	}
	payload["ts"] = time.Now().UnixMilli()
	out, err := json.Marshal(payload)
	if err != nil {
		c.enqueue(map[string]any{"type": "error", "message": "gagal encode perintah"})
		return
	}

	if h.sendToDevices(out) == 0 {
		c.enqueue(map[string]any{"type": "error", "message": "Robot sedang offline. Periksa koneksi ESP32."})
		return
	}
	c.enqueue(map[string]any{"type": "ack", "id": cmdID, "forwarded": true})
}

func (h *Hub) handleDevice(c *Client, data []byte, typ string) {
	h.touch(c)

	switch typ {
	case "hello":
		var hello struct {
			DeviceID string `json:"deviceId"`
			Name     string `json:"name"`
			Kind     string `json:"kind"`
			Firmware string `json:"firmware"`
			IP       string `json:"ip"`
		}
		_ = json.Unmarshal(data, &hello)
		h.bindDevice(c, hello.DeviceID, model.Device{
			Name:     hello.Name,
			Kind:     hello.Kind,
			Firmware: hello.Firmware,
			IP:       hello.IP,
		})
		c.enqueue(map[string]any{
			"type":       "hello_ack",
			"deviceId":   sanitizeID(hello.DeviceID),
			"serverTime": time.Now().UTC(),
		})

	case "telemetry":
		var t model.Telemetry
		if err := json.Unmarshal(data, &t); err != nil {
			return
		}
		if t.DeviceID == "" {
			t.DeviceID = c.deviceID
		}
		t.CreatedAt = time.Now().UTC()

		h.mu.Lock()
		// Status kamera hanya boleh ditulis oleh node CAM (ai_status),
		// supaya telemetry Dev tiap 2 detik tidak menimpa nilainya.
		t.CamOnline = h.camOnline
		t.CamArmed = h.camArmed
		t.CamBusy = h.camBusy
		t.CamTarget = h.camTarget
		h.latest = t
		h.hasLatest = true
		h.lastSeen[t.DeviceID] = time.Now()
		h.mu.Unlock()

		h.broadcast(map[string]any{
			"type":         "telemetry",
			"telemetry":    t,
			"deviceOnline": true,
		})
		if h.hooks.OnTelemetry != nil {
			h.hooks.OnTelemetry(t)
		}

	case "detection":
		var d model.Detection
		if err := json.Unmarshal(data, &d); err != nil {
			return
		}
		if d.DeviceID == "" {
			d.DeviceID = c.deviceID
		}
		d.CreatedAt = time.Now().UTC()
		if d.ID == "" {
			d.ID = id.New()
		}
		h.broadcast(map[string]any{"type": "detection", "detection": d})
		if h.hooks.OnDetection != nil {
			h.hooks.OnDetection(d)
		}

	case "ai_status":
		var ai struct {
			Armed  bool   `json:"armed"`
			Target string `json:"target"`
			Busy   bool   `json:"busy"`
		}
		_ = json.Unmarshal(data, &ai)
		h.mu.Lock()
		h.camOnline = true
		h.camArmed = ai.Armed
		h.camBusy = ai.Busy
		h.camTarget = ai.Target
		if h.hasLatest {
			h.latest.CamOnline = true
			h.latest.CamArmed = ai.Armed
			h.latest.CamTarget = ai.Target
			h.latest.CamBusy = ai.Busy
			h.latest.CreatedAt = time.Now().UTC()
		}
		t := h.latest
		has := h.hasLatest
		h.mu.Unlock()

		if has {
			h.broadcast(map[string]any{"type": "telemetry", "telemetry": t, "deviceOnline": true})
		}

	case "ack", "pong":
		// keep-alive / konfirmasi, tidak perlu diteruskan

	default:
		h.log.Debug("pesan device tidak dikenal", "type", typ)
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister(c)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMsgSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		c.hub.touch(c)
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		c.hub.handleMessage(c, data)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) enqueue(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.enqueueRaw(b)
}

func (c *Client) enqueueRaw(b []byte) {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if c.closed {
		return
	}
	select {
	case c.send <- b:
	default:
		// klien lambat: buang pesan daripada memblokir hub
	}
}

func (c *Client) closeSend() {
	c.sendMu.Lock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
	c.sendMu.Unlock()
}

func sanitizeID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range v {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
		if b.Len() >= 64 {
			break
		}
	}
	return b.String()
}
