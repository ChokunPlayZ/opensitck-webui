package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

func terminalCommand(username string) (*exec.Cmd, error) {
	if !linuxUsernamePattern.MatchString(username) {
		return nil, errors.New("invalid terminal account")
	}
	// runuser's login mode uses the account's shell, home, UID/GID and supplementary
	// groups through Debian's PAM stack. Never fall back to the service's root shell.
	command := exec.Command("/usr/sbin/runuser", "--login", "--", username)
	command.Dir = "/"
	// Do not pass service credentials or root's environment to the user's shell.
	command.Env = []string{"TERM=xterm-256color", "COLORTERM=truecolor", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	return command, nil
}

// A real PTY supports interactive programs (top, nano, ssh), Ctrl-C and resizing.
// Authentication, CSRF and Origin checks run before the WebSocket upgrade.
func (a *app) terminal(w http.ResponseWriter, r *http.Request) {
	loginSession, valid := a.getSession(r)
	if !valid {
		fail(w, http.StatusUnauthorized, "Sign in to continue")
		return
	}
	command, err := terminalCommand(loginSession.Username)
	if err != nil {
		fail(w, http.StatusForbidden, "Invalid terminal account")
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: sameOrigin, ReadBufferSize: 4096, WriteBufferSize: 4096}
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer connection.Close()
	connection.SetReadLimit(64 << 10)
	terminal, err := pty.Start(command)
	if err != nil {
		connection.WriteMessage(websocket.TextMessage, []byte(err.Error()))
		return
	}
	a.audit("terminal.open", "login PTY user="+loginSession.Username, true)
	defer func() {
		terminal.Close()
		if command.Process != nil {
			syscall.Kill(-command.Process.Pid, syscall.SIGHUP)
		}
		forceStop := time.AfterFunc(2*time.Second, func() {
			if command.Process != nil {
				syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
			}
		})
		command.Wait()
		forceStop.Stop()
		a.audit("terminal.close", "login PTY user="+loginSession.Username, true)
	}()
	var writer sync.Mutex
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		buffer := make([]byte, 8192)
		for {
			n, err := terminal.Read(buffer)
			if n > 0 {
				writer.Lock()
				connection.SetWriteDeadline(time.Now().Add(10 * time.Second))
				writeErr := connection.WriteMessage(websocket.BinaryMessage, buffer[:n])
				writer.Unlock()
				if writeErr != nil {
					return
				}
			}
			if err != nil {
				connection.Close()
				return
			}
		}
	}()
	for {
		_, data, err := connection.ReadMessage()
		if err != nil {
			return
		}
		// Expired/logged-out sessions cannot keep an existing shell open.
		if _, valid := a.getSession(r); !valid {
			return
		}
		var message struct {
			Type string `json:"type"`
			Data string `json:"data"`
			Cols uint16 `json:"cols"`
			Rows uint16 `json:"rows"`
		}
		if json.Unmarshal(data, &message) != nil {
			continue
		}
		switch message.Type {
		case "input":
			terminal.Write([]byte(message.Data))
		case "resize":
			if message.Cols >= 10 && message.Cols <= 500 && message.Rows >= 2 && message.Rows <= 200 {
				pty.Setsize(terminal, &pty.Winsize{Cols: message.Cols, Rows: message.Rows})
			}
		}
	}
}
