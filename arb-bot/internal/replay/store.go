package replay

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"arb-bot/internal/types"
)

type Store struct {
	mu       sync.Mutex
	baseDir  string
	flushEvery int
	buffer   []types.ReplayRecord
}

func NewStore(baseDir string, flushEvery int) *Store {
	if flushEvery <= 0 {
		flushEvery = 1
	}
	return &Store{
		baseDir:    baseDir,
		flushEvery: flushEvery,
		buffer:     make([]types.ReplayRecord, 0, flushEvery),
	}
}

func (s *Store) Save(rec types.ReplayRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.buffer = append(s.buffer, rec)
	if len(s.buffer) >= s.flushEvery {
		return s.flushLocked()
	}
	return nil
}

func (s *Store) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.flushLocked()
}

func (s *Store) flushLocked() error {
	if len(s.buffer) == 0 {
		return nil
	}

	if err := os.MkdirAll(s.baseDir, 0o755); err != nil {
		return err
	}

	filename := filepath.Join(s.baseDir, time.Now().UTC().Format("2006-01-02")+".jsonl")
	f, err := os.OpenFile(filename, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	w := bufio.NewWriter(f)
	for _, rec := range s.buffer {
		line, err := json.Marshal(rec)
		if err != nil {
			return err
		}
		if _, err := w.Write(append(line, '\n')); err != nil {
			return err
		}
	}
	if err := w.Flush(); err != nil {
		return err
	}

	s.buffer = s.buffer[:0]
	return nil
}
