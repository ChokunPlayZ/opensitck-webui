package main

import (
	"context"
	"errors"
	"net"
	"syscall"
)

// Device binding applies only to the management listeners, not to outbound
// speed tests, DNS diagnostics, or local SSH/PAM authentication connections.
func managementListener(address, device string) (net.Listener, error) {
	var config net.ListenConfig
	if device != "" {
		if !validInterface(device) {
			return nil, errors.New("invalid management interface")
		}
		config.Control = func(_, _ string, raw syscall.RawConn) error {
			return bindManagementDevice(raw, device)
		}
	}
	return config.Listen(context.Background(), "tcp", address)
}
