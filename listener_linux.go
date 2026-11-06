package main

import (
	"syscall"

	"golang.org/x/sys/unix"
)

func bindManagementDevice(raw syscall.RawConn, device string) error {
	var bindError error
	if err := raw.Control(func(fd uintptr) {
		bindError = unix.SetsockoptString(int(fd), unix.SOL_SOCKET, unix.SO_BINDTODEVICE, device)
	}); err != nil {
		return err
	}
	// Fail closed: a missing interface or unavailable privilege must not silently
	// fall back to an unbound socket.
	return bindError
}
