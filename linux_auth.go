package main

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"golang.org/x/crypto/ssh"
)

var errAuthUnavailable = errors.New("Debian authentication unavailable")
var linuxUsernamePattern = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)

// Use the stick's existing OpenSSH/PAM stack instead of copying /etc/shadow,
// implementing password hashing, or requiring a CGO/libpam build toolchain.
// The connection is loopback-only and its host key must match a local key file.
// No session or command is opened and no password is retained after this call.
func authenticateDebian(username, password string) error {
	if !linuxUsernamePattern.MatchString(username) || password == "" || len(password) > 512 {
		return errors.New("invalid credentials")
	}
	keys := []ssh.PublicKey{}
	paths, _ := filepath.Glob("/etc/ssh/ssh_host_*_key.pub")
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		key, _, _, _, err := ssh.ParseAuthorizedKey(data)
		if err == nil {
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return fmt.Errorf("%w: no local SSH host public keys", errAuthUnavailable)
	}
	configuration := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: func(_ string, _ net.Addr, received ssh.PublicKey) error {
			for _, expected := range keys {
				if bytes.Equal(expected.Marshal(), received.Marshal()) {
					return nil
				}
			}
			return errors.New("local SSH host key does not match /etc/ssh")
		},
	}
	connection, err := net.DialTimeout("tcp", "127.0.0.1:22", 5*time.Second)
	if err != nil {
		log.Printf("Debian auth connection: %v", err)
		return fmt.Errorf("%w: cannot reach local sshd", errAuthUnavailable)
	}
	defer connection.Close()
	connection.SetDeadline(time.Now().Add(20 * time.Second))
	authenticated, _, _, err := ssh.NewClientConn(connection, "127.0.0.1:22", configuration)
	if err != nil {
		return errors.New("Debian SSH/PAM authentication rejected")
	}
	authenticated.Close()

	// Successful system login is not sufficient: management APIs still run as root,
	// even though the terminal uses the signed-in account. Keep the admin-only gate.
	if output("id", "-u", username) == "0" {
		return nil
	}
	if _, err := run("sudo", "-n", "-l", "-U", username, "--", "/bin/sh"); err != nil {
		return errors.New("account is not authorized for a root shell")
	}
	return nil
}
