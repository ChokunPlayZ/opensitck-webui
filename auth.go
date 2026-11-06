package main

import (
	"crypto/hmac"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type session struct {
	Username string
	CSRF     string
	Expires  time.Time
}
type attempt struct {
	Count int
	Since time.Time
}
type app struct {
	state        string
	mux          *http.ServeMux
	mu           sync.Mutex
	sessions     map[string]session
	attempts     map[string]attempt
	jobs         map[string]*job
	authenticate func(username, password string) error
	samples      []sample
	latest       map[string]any
	lastCPU      []uint64
	lastNet      map[string][2]uint64
	lastSample   time.Time
	mutation     sync.Mutex
	speedtest    *speedtestResult
}

func newApp(state string) (*app, error) {
	a := &app{state: state, mux: http.NewServeMux(), sessions: map[string]session{}, attempts: map[string]attempt{}, jobs: map[string]*job{}, lastNet: map[string][2]uint64{}, authenticate: authenticateDebian}
	return a, nil
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func sameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return err == nil && u.Host == r.Host && u.Scheme == scheme
}

func (a *app) secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		if !sameOrigin(r) {
			fail(w, 403, "Cross-origin requests are not allowed")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
			if r.URL.Path != "/api/login" && r.URL.Path != "/api/session" {
				s, ok := a.getSession(r)
				if !ok {
					fail(w, 401, "Sign in to continue")
					return
				}
				if r.Method != "GET" && r.Method != "HEAD" && !hmac.Equal([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.CSRF)) {
					fail(w, 403, "Invalid security token. Sign in again.")
					return
				}
				if r.URL.Path == "/api/terminal" && !hmac.Equal([]byte(r.URL.Query().Get("csrf")), []byte(s.CSRF)) {
					fail(w, 403, "Invalid terminal token")
					return
				}
			}
			r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		}
		next.ServeHTTP(w, r)
	})
}

func (a *app) getSession(r *http.Request) (session, bool) {
	c, err := r.Cookie("openstick_session")
	if err != nil {
		return session{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[c.Value]
	if !ok || time.Now().After(s.Expires) {
		delete(a.sessions, c.Value)
		return session{}, false
	}
	return s, true
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var in struct {
		Username string
		Password string
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Username) > 32 || len(in.Password) > 512 {
		fail(w, 400, "Invalid credential length")
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	now := time.Now()
	a.mu.Lock()
	entry := a.attempts[ip]
	if now.Sub(entry.Since) > 15*time.Minute {
		entry = attempt{Since: now}
	}
	if entry.Count >= 8 {
		a.mu.Unlock()
		fail(w, 429, "Too many attempts. Try again in 15 minutes.")
		return
	}
	entry.Count++
	a.attempts[ip] = entry
	a.mu.Unlock()
	if err := a.authenticate(in.Username, in.Password); err != nil {
		a.audit("login.failed", ip+" user="+in.Username, false)
		if errors.Is(err, errAuthUnavailable) {
			fail(w, 503, "Debian authentication is unavailable. Check the local SSH service and console journal.")
		} else {
			fail(w, 401, "Incorrect Debian credentials, expired/locked account, or account lacks root-shell privileges")
		}
		return
	}
	token := randomToken(32)
	s := session{Username: in.Username, CSRF: randomToken(24), Expires: now.Add(12 * time.Hour)}
	a.mu.Lock()
	for key, value := range a.sessions {
		if now.After(value.Expires) {
			delete(a.sessions, key)
		}
	}
	for key, value := range a.attempts {
		if now.Sub(value.Since) > 15*time.Minute {
			delete(a.attempts, key)
		}
	}
	a.sessions[token] = s
	delete(a.attempts, ip)
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "openstick_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil, MaxAge: 43200})
	a.audit("login", ip+" user="+s.Username, true)
	respond(w, map[string]any{"authenticated": true, "username": s.Username, "csrf": s.CSRF, "version": version, "auth": "debian-ssh-pam"})
}

func (a *app) sessionInfo(w http.ResponseWriter, r *http.Request) {
	s, ok := a.getSession(r)
	respond(w, map[string]any{"authenticated": ok, "username": s.Username, "csrf": s.CSRF, "version": version, "auth": "debian-ssh-pam"})
}
func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("openstick_session")
	a.mu.Lock()
	if c != nil {
		delete(a.sessions, c.Value)
	}
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "openstick_session", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil})
	respond(w, map[string]bool{"ok": true})
}

func respond(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400, "Invalid request: "+err.Error())
		return false
	}
	return true
}
func (a *app) audit(action, detail string, success bool) {
	record, _ := json.Marshal(map[string]any{"time": time.Now().UTC(), "action": action, "detail": detail, "success": success})
	a.mu.Lock()
	defer a.mu.Unlock()
	path := filepath.Join(a.state, "audit.jsonl")
	if s, err := os.Stat(path); err == nil && s.Size() > 2<<20 {
		os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err == nil {
		fmt.Fprintln(f, string(record))
		f.Close()
	}
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".openstick-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}
