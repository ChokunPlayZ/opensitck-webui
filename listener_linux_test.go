package main

import (
	"errors"
	"net"
	"testing"

	"golang.org/x/sys/unix"
)

func TestManagementListenerLinuxDeviceBinding(t *testing.T) {
	listener, err := managementListener("127.0.0.1:0", "lo")
	if errors.Is(err, unix.EPERM) || errors.Is(err, unix.EACCES) {
		t.Skip("requires permission to bind a socket to a device")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	raw, err := listener.(*net.TCPListener).SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var device string
	var optionError error
	if err := raw.Control(func(fd uintptr) {
		device, optionError = unix.GetsockoptString(int(fd), unix.SOL_SOCKET, unix.SO_BINDTODEVICE)
	}); err != nil {
		t.Fatal(err)
	}
	if optionError != nil || device != "lo" {
		t.Fatalf("socket not actually device-bound: %q, %v", device, optionError)
	}
}
