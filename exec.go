package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

type cappedBuffer struct {
	mu    sync.Mutex
	data  []byte
	limit int
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = b.data[len(b.data)-b.limit:]
	}
	return n, nil
}
func (b *cappedBuffer) String() string { b.mu.Lock(); defer b.mu.Unlock(); return string(b.data) }

func command(ctx context.Context, input string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "SYSTEMD_PAGER=cat", "DEBIAN_FRONTEND=noninteractive")
	if input != "" {
		cmd.Stdin = strings.NewReader(input)
	}
	var out cappedBuffer
	out.limit = 4 << 20
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	if ctx.Err() != nil {
		return out.String(), ctx.Err()
	}
	return out.String(), err
}
func run(name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return command(ctx, "", name, args...)
}
func output(name string, args ...string) string {
	s, _ := run(name, args...)
	return strings.TrimSpace(s)
}
func available(name string) bool { _, err := exec.LookPath(name); return err == nil }

type job struct {
	ID       string     `json:"id"`
	Label    string     `json:"label"`
	Started  time.Time  `json:"started"`
	Finished *time.Time `json:"finished,omitempty"`
	Status   string     `json:"status"`
	Output   string     `json:"output"`
	buf      *cappedBuffer
	cancel   context.CancelFunc
	done     chan struct{}
}
type step struct {
	Name  string
	Args  []string
	Input string
	Run   func(context.Context, io.Writer) error
}

func (a *app) startJob(label string, steps []step) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	id := randomToken(9)
	j := &job{ID: id, Label: label, Started: time.Now(), Status: "running", buf: &cappedBuffer{limit: 512 << 10}, cancel: cancel, done: make(chan struct{})}
	a.mu.Lock()
	active := 0
	for _, existing := range a.jobs {
		if existing.Status == "running" {
			active++
			if label == "speedtest.run" && existing.Label == label {
				a.mu.Unlock()
				cancel()
				return "", errors.New("a speed test is already queued or running")
			}
		}
	}
	if active >= 8 {
		a.mu.Unlock()
		cancel()
		return "", errors.New("the operation queue is full; wait for current jobs to finish")
	}
	if len(a.jobs) >= 40 {
		for k, v := range a.jobs {
			if v.Status != "running" {
				delete(a.jobs, k)
				break
			}
		}
	}
	a.jobs[id] = j
	a.mu.Unlock()
	go func() {
		defer cancel()
		defer close(j.done)
		status := "success"
		// Serialize long-running system mutations, including package manager access.
		a.mutation.Lock()
		defer a.mutation.Unlock()
		for _, s := range steps {
			if ctx.Err() != nil {
				status = "cancelled"
				break
			}
			fmt.Fprintf(j.buf, "→ %s\n", s.Name)
			if s.Run != nil {
				if err := s.Run(ctx, j.buf); err != nil {
					fmt.Fprintf(j.buf, "\nError: %v\n", err)
					status = "failed"
					break
				}
				continue
			}
			cmd := exec.CommandContext(ctx, s.Name, s.Args...)
			cmd.Env = append(os.Environ(), "LC_ALL=C", "DEBIAN_FRONTEND=noninteractive", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
			cmd.Stdout = j.buf
			cmd.Stderr = j.buf
			if s.Input != "" {
				cmd.Stdin = bytes.NewBufferString(s.Input)
			}
			cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
			cmd.Cancel = func() error {
				if cmd.Process != nil {
					return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
				}
				return nil
			}
			cmd.WaitDelay = 5 * time.Second
			if err := cmd.Run(); err != nil {
				fmt.Fprintf(j.buf, "\nError: %v\n", err)
				status = "failed"
				break
			}
		}
		now := time.Now()
		a.mu.Lock()
		j.Status = status
		j.Finished = &now
		if status == "success" && (label == "system.linux-password" || strings.HasPrefix(label, "user.") && label != "user.create") {
			a.sessions = map[string]session{}
		}
		a.mu.Unlock()
		a.audit("job", label, status == "success")
	}()
	return id, nil
}
func (a *app) stopJobs() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, j := range a.jobs {
		j.cancel()
	}
}
