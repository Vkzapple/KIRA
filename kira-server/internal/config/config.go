package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	Addr               string
	CORSOrigins        []string
	RobotPassword      string
	DeviceToken        string
	DeviceID           string
	SessionTTL         time.Duration
	DataDir            string
	PublicBaseURL      string
	SupabaseURL        string
	SupabaseServiceKey string
	SupabaseBucket     string
	PlantName          string
	AIServiceURL       string
}

func Load() Config {
	loadDotEnv(".env")

	return Config{
		Addr:               env("ADDR", ":8080"),
		CORSOrigins:        split(env("CORS_ORIGINS", "http://localhost:3000")),
		RobotPassword:      env("ROBOT_PASSWORD", "kira123"),
		DeviceToken:        env("DEVICE_TOKEN", "change-me-device-token"),
		DeviceID:           env("DEVICE_ID", "kira-01"),
		SessionTTL:         duration(env("SESSION_TTL", "12h"), 12*time.Hour),
		DataDir:            env("DATA_DIR", "./data"),
		PublicBaseURL:      strings.TrimRight(env("PUBLIC_BASE_URL", "http://localhost:8080"), "/"),
		SupabaseURL:        strings.TrimRight(env("SUPABASE_URL", ""), "/"),
		SupabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY", ""),
		SupabaseBucket:     env("SUPABASE_BUCKET", "kira-snapshots"),
		PlantName:          env("PLANT_NAME", "Hibiscus (A1)"),
		AIServiceURL:       strings.TrimRight(env("AI_SERVICE_URL", ""), "/"),
	}
}

func (c Config) SupabaseEnabled() bool {
	return c.SupabaseURL != "" && c.SupabaseServiceKey != ""
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func split(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		out = []string{"http://localhost:3000"}
	}
	return out
}

func duration(v string, fallback time.Duration) time.Duration {
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}
