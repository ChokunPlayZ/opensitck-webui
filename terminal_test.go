package main

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestTerminalCommandUsesLoginAccount(t *testing.T) {
	t.Setenv("OPENSTICK_SERVICE_SECRET", "must-not-reach-the-shell")
	for _, username := range []string{"user", "other-admin", "root"} {
		command, err := terminalCommand(username)
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"/usr/sbin/runuser", "--login", "--", username}
		if command.Path != want[0] || !reflect.DeepEqual(command.Args, want) {
			t.Fatalf("terminal must switch to the session account: %v", command.Args)
		}
		if command.Dir != "/" {
			t.Fatalf("terminal starts in privileged service directory: %s", command.Dir)
		}
		wantEnv := []string{"TERM=xterm-256color", "COLORTERM=truecolor", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
		if !reflect.DeepEqual(command.Env, wantEnv) {
			t.Fatalf("terminal inherited service environment: %v", command.Env)
		}
	}
}

func TestTerminalRejectsInvalidAccounts(t *testing.T) {
	for _, username := range []string{"", "-root", "../root", "user;id", "user\nroot", "user root"} {
		if command, err := terminalCommand(username); err == nil || command != nil {
			t.Fatalf("invalid terminal account accepted: %q", username)
		}
	}
}

func TestTerminalRequiresSessionBeforeUpgrade(t *testing.T) {
	application := testApp(t)
	request := httptest.NewRequest("GET", "/api/terminal", nil)
	recorder := httptest.NewRecorder()
	application.terminal(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated terminal: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestTerminalWebSocketSecurity(t *testing.T) {
	application := testApp(t)
	cookie, csrf := loginRequest(t, application)
	for _, test := range []struct {
		name, token, origin string
		authenticated       bool
		status              int
	}{
		{"no session", csrf, "", false, http.StatusUnauthorized},
		{"missing CSRF", "", "", true, http.StatusForbidden},
		{"wrong CSRF", "wrong", "", true, http.StatusForbidden},
		{"cross origin", csrf, "https://evil.example", true, http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/api/terminal?csrf="+test.token, nil)
			request.Header.Set("Origin", test.origin)
			if test.authenticated {
				request.AddCookie(cookie)
			}
			recorder := httptest.NewRecorder()
			application.secure(application.mux).ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("got %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
