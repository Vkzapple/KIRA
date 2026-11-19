package model

import "time"

// Telemetry adalah kondisi terakhir robot (dikirim ESP32 Dev tiap ~2 detik).
type Telemetry struct {
	DeviceID    string    `json:"deviceId,omitempty"`
	Soil        int       `json:"soil"`
	SoilRaw     int       `json:"soilRaw"`
	Rain        int       `json:"rain"`
	RainRaw     int       `json:"rainRaw"`
	RainWet     bool      `json:"rainWet"`
	Sync        int       `json:"sync"`
	Aux         int       `json:"aux"`
	Motor       int       `json:"motor"`
	MotorTarget int       `json:"motorTarget,omitempty"`
	CamOnline   bool      `json:"camOnline"`
	CamArmed    bool      `json:"camArmed"`
	CamBusy     bool      `json:"camBusy"`
	CamTarget   string    `json:"camTarget"`
	RSSI        int       `json:"rssi"`
	Uptime      int64     `json:"uptime"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Detection adalah satu kejadian deteksi objek oleh Roboflow.
type Detection struct {
	ID         string    `json:"id,omitempty"`
	DeviceID   string    `json:"deviceId,omitempty"`
	Class      string    `json:"class"`
	Confidence float64   `json:"confidence"`
	Count      int       `json:"count,omitempty"`
	ImageURL   string    `json:"imageUrl,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Snapshot adalah foto yang lolos filter Roboflow dan disimpan ke storage.
type Snapshot struct {
	ID         string    `json:"id"`
	DeviceID   string    `json:"deviceId"`
	PlantName  string    `json:"plantName"`
	ImageURL   string    `json:"imageUrl"`
	Class      string    `json:"class,omitempty"`
	Confidence float64   `json:"confidence,omitempty"`
	CapturedAt time.Time `json:"capturedAt"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Device adalah metadata robot yang terhubung.
type Device struct {
	ID       string    `json:"id"`
	Name     string    `json:"name,omitempty"`
	Kind     string    `json:"kind,omitempty"`
	Firmware string    `json:"firmware,omitempty"`
	IP       string    `json:"ip,omitempty"`
	LastSeen time.Time `json:"lastSeen,omitempty"`
}
