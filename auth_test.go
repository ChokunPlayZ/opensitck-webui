package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func testApp(t *testing.T) *app {
	t.Helper()
	application, err := newApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	application.authenticate = func(username, password string) error {
		if username == "user" && password == "test-debian-password" {
			return nil
		}
		return errors.New("Debian rejected credentials")
	}
	application.routes(fstest.MapFS{"index.html": {Data: []byte("console")}})
	return application
}

func loginRequest(t *testing.T, application *app) (*http.Cookie, string) {
	t.Helper()
	request := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"user","password":"test-debian-password"}`))
	recorder := httptest.NewRecorder()
	application.secure(application.mux).ServeHTTP(recorder, request)
	if recorder.Code != 200 {
		t.Fatalf("login failed: %s", recorder.Body.String())
	}
	var result map[string]any
	json.Unmarshal(recorder.Body.Bytes(), &result)
	if result["username"] != "user" || result["auth"] != "debian-ssh-pam" {
		t.Fatal("Debian account identity not returned")
	}
	return recorder.Result().Cookies()[0], result["csrf"].(string)
}

func TestAuthenticationAndCSRF(t *testing.T) {
	application := testApp(t)
	handler := application.secure(application.mux)
	for _, path := range []string{"/api/status", "/api/network", "/api/files", "/api/wireguard", "/api/terminal", "/api/download", "/api/backup", "/api/users", "/api/speedtest", "/api/hardware"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest("GET", path, nil))
		if recorder.Code != 401 {
			t.Errorf("%s accessible without authentication: %d", path, recorder.Code)
		}
	}
	cookie, csrf := loginRequest(t, application)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("session cookie lacks protections")
	}
	for _, test := range []struct {
		name, csrf, origin string
		status             int
	}{
		{"missing CSRF", "", "", 403},
		{"wrong CSRF", "wrong", "", 403},
		{"cross origin", csrf, "https://evil.example", 403},
		{"valid logout", csrf, "", 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/api/logout", strings.NewReader("{}"))
			request.AddCookie(cookie)
			request.Header.Set("X-CSRF-Token", test.csrf)
			request.Header.Set("Origin", test.origin)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestSessionExpiry(t *testing.T) {
	application := testApp(t)
	application.sessions["expired"] = session{CSRF: "token", Expires: time.Now().Add(-time.Second)}
	request := httptest.NewRequest("GET", "/api/status", nil)
	request.AddCookie(&http.Cookie{Name: "openstick_session", Value: "expired"})
	if _, ok := application.getSession(request); ok {
		t.Fatal("expired session was accepted")
	}
}

func TestLoginRateLimit(t *testing.T) {
	application := testApp(t)
	application.attempts["192.0.2.1"] = attempt{Count: 8, Since: time.Now()}
	request := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"admin","password":"wrong"}`))
	request.RemoteAddr = "192.0.2.1:1234"
	recorder := httptest.NewRecorder()
	application.login(recorder, request)
	if recorder.Code != 429 {
		t.Fatalf("rate limit not applied: %d", recorder.Code)
	}
}

func TestDebianCredentialRejection(t *testing.T) {
	application := testApp(t)
	for _, credentials := range []string{`{"username":"user","password":"wrong"}`, `{"username":"admin","password":"test-debian-password"}`} {
		recorder := httptest.NewRecorder()
		application.login(recorder, httptest.NewRequest("POST", "/api/login", strings.NewReader(credentials)))
		if recorder.Code != 401 {
			t.Fatal("non-Debian credentials accepted")
		}
	}
}
