//go:build linux

package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/user"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// Opt in on the device as root with OPENSTICK_TERMINAL_TEST_USER=user. No account
// or system configuration is changed; only a real login PTY is opened and closed.
func TestTerminalLoginIdentity(t *testing.T) {
	username := os.Getenv("OPENSTICK_TERMINAL_TEST_USER")
	if os.Geteuid() != 0 || username == "" {
		t.Skip("requires root and OPENSTICK_TERMINAL_TEST_USER")
	}
	account, err := user.Lookup(username)
	if err != nil {
		t.Fatal(err)
	}
	if account.Uid == "0" {
		t.Fatal("use a non-root account to verify privilege dropping")
	}
	t.Setenv("OPENSTICK_TERMINAL_TEST_SECRET", "must-not-reach-the-shell")
	application := testApp(t)
	cookie, csrf := loginRequest(t, application)
	application.mu.Lock()
	loginSession := application.sessions[cookie.Value]
	loginSession.Username = username
	application.sessions[cookie.Value] = loginSession
	application.mu.Unlock()
	server := httptest.NewServer(application.secure(application.mux))
	defer server.Close()
	header := http.Header{"Cookie": []string{cookie.String()}}
	// Client-supplied account names must not override the authenticated session.
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/api/terminal?csrf="+csrf+"&username=root", header)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	connection.SetReadDeadline(time.Now().Add(20 * time.Second))
	if err := connection.WriteJSON(map[string]any{"type": "resize", "cols": 101, "rows": 33}); err != nil {
		t.Fatal(err)
	}
	script := `printf '\nWEBUI_%s\n' IDENTITY_START; id -un; id -u; id -g; id -G; printf '%s\n' "$HOME" "$PWD" "$USER" "$LOGNAME" "$SHELL" "$TERM" "${OPENSTICK_TERMINAL_TEST_SECRET-unset}"; stty size; printf 'WEBUI_%s\n' IDENTITY_END` + "\r"
	if err := connection.WriteJSON(map[string]string{"type": "input", "data": script}); err != nil {
		t.Fatal(err)
	}
	var output string
	for !strings.Contains(output, "WEBUI_IDENTITY_END") {
		_, data, err := connection.ReadMessage()
		if err != nil {
			t.Fatalf("terminal read: %v\n%s", err, output)
		}
		output += string(data)
	}
	output = strings.ReplaceAll(output, "\r", "")
	_, identity, ok := strings.Cut(output, "WEBUI_IDENTITY_START\n")
	if !ok {
		t.Fatalf("missing identity output: %s", output)
	}
	identity, _, _ = strings.Cut(identity, "WEBUI_IDENTITY_END")
	lines := strings.Split(strings.TrimSpace(identity), "\n")
	if len(lines) != 12 {
		t.Fatalf("unexpected identity output: %q", lines)
	}
	want := map[int]string{0: username, 1: account.Uid, 2: account.Gid, 4: account.HomeDir, 5: account.HomeDir, 6: username, 7: username, 9: "xterm-256color", 10: "unset", 11: "33 101"}
	for index, expected := range want {
		if lines[index] != expected {
			t.Errorf("identity field %d: got %q, want %q", index, lines[index], expected)
		}
	}
	groups, err := account.GroupIds()
	if err != nil {
		t.Fatal(err)
	}
	gotGroups := strings.Fields(lines[3])
	sort.Strings(groups)
	sort.Strings(gotGroups)
	if strings.Join(groups, " ") != strings.Join(gotGroups, " ") {
		t.Errorf("supplementary groups: got %v, want %v", gotGroups, groups)
	}
	if !strings.HasPrefix(lines[8], "/") {
		t.Errorf("invalid login shell: %q", lines[8])
	}
	// Existing sessions must still be closed after revocation, not just new ones.
	application.mu.Lock()
	delete(application.sessions, cookie.Value)
	application.mu.Unlock()
	if err := connection.WriteJSON(map[string]string{"type": "heartbeat"}); err != nil {
		t.Fatal(err)
	}
	for {
		if _, _, err := connection.ReadMessage(); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
				t.Fatalf("revoked terminal was not closed: %v", err)
			}
			break
		}
	}
}

func TestTerminalMissingAccountFailsClosed(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("requires root for runuser")
	}
	const username = "webui_no_such_account"
	if _, err := user.Lookup(username); err == nil {
		t.Skip("test account unexpectedly exists")
	}
	command, err := terminalCommand(username)
	if err != nil {
		t.Fatal(err)
	}
	terminal, err := pty.Start(command)
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	if err := command.Wait(); err == nil {
		t.Fatal("missing account unexpectedly opened a shell")
	}
}
