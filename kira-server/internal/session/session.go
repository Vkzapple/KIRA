package session

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// Store menyimpan token sesi dashboard di memori.
// Cukup untuk satu instance; kalau backend di-scale, ganti dengan Redis/JWT.
type Store struct {
	mu     sync.Mutex
	ttl    time.Duration
	tokens map[string]time.Time
}

func New(ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}
	return &Store{ttl: ttl, tokens: make(map[string]time.Time)}
}

func (s *Store) Issue() (string, time.Time, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(b)
	exp := time.Now().Add(s.ttl)

	s.mu.Lock()
	s.tokens[token] = exp
	s.mu.Unlock()
	return token, exp, nil
}

func (s *Store) Valid(token string) bool {
	if token == "" {
		return false
	}
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.tokens[token]
	if !ok {
		return false
	}
	if now.After(exp) {
		delete(s.tokens, token)
		return false
	}
	return true
}

func (s *Store) Revoke(token string) {
	s.mu.Lock()
	delete(s.tokens, token)
	s.mu.Unlock()
}

func (s *Store) Cleanup() {
	now := time.Now()
	s.mu.Lock()
	for token, exp := range s.tokens {
		if now.After(exp) {
			delete(s.tokens, token)
		}
	}
	s.mu.Unlock()
}
