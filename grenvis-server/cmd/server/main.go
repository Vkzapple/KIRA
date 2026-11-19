package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"grenvis/server/internal/config"
	"grenvis/server/internal/httpapi"
	"grenvis/server/internal/model"
	"grenvis/server/internal/session"
	"grenvis/server/internal/store"
	"grenvis/server/internal/ws"
)

func main() {
	cfg := config.Load()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	st, err := buildStore(cfg)
	if err != nil {
		logger.Error("gagal menyiapkan store", "err", err)
		os.Exit(1)
	}

	sessions := session.New(cfg.SessionTTL)
	telemetryCh := make(chan model.Telemetry, 128)

	hub := ws.NewHub(logger, cfg.CORSOrigins, ws.Hooks{
		OnTelemetry: func(t model.Telemetry) {
			select {
			case telemetryCh <- t:
			default: // backend lambat, sample dibuang
			}
		},
		OnDetection: func(d model.Detection) {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				if err := st.SaveDetection(ctx, d); err != nil {
					logger.Warn("gagal menyimpan detection", "err", err)
				}
			}()
		},
		OnDevice: func(d model.Device) {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				if err := st.UpsertDevice(ctx, d); err != nil {
					logger.Warn("gagal menyimpan device", "err", err)
				}
			}()
		},
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go persistTelemetry(ctx, logger, st, telemetryCh)
	go cleanupSessions(ctx, sessions)

	api := httpapi.New(cfg, logger, hub, st, sessions)
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	logger.Info("GRENVIS server jalan",
		"addr", cfg.Addr,
		"store", st.Mode(),
		"supabase", cfg.SupabaseEnabled(),
		"cors", cfg.CORSOrigins,
	)

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server berhenti", "err", err)
		os.Exit(1)
	}
}

func buildStore(cfg config.Config) (store.Store, error) {
	if cfg.SupabaseEnabled() {
		return store.NewSupabase(cfg.SupabaseURL, cfg.SupabaseServiceKey, cfg.SupabaseBucket), nil
	}
	return store.NewLocal(cfg.DataDir, cfg.PublicBaseURL)
}

func persistTelemetry(ctx context.Context, log *slog.Logger, st store.Store, ch <-chan model.Telemetry) {
	const minGap = 5 * time.Second
	var last time.Time

	for {
		select {
		case <-ctx.Done():
			return
		case t := <-ch:
			if time.Since(last) < minGap {
				continue
			}
			last = time.Now()
			saveCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := st.SaveTelemetry(saveCtx, t)
			cancel()
			if err != nil {
				log.Warn("gagal menyimpan telemetry", "err", err)
			}
		}
	}
}

func cleanupSessions(ctx context.Context, sessions *session.Store) {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sessions.Cleanup()
		}
	}
}
