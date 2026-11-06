package main

import "testing"

func TestManagementListenerLoopback(t *testing.T) {
	listener, err := managementListener("127.0.0.1:0", "")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if listener.Addr().String() == "" {
		t.Fatal("missing listener address")
	}
}

func TestManagementListenerRejectsInvalidDevice(t *testing.T) {
	for _, device := range []string{"-br0", "../br0", "br0;reboot", "interface-name-too-long"} {
		if listener, err := managementListener("127.0.0.1:0", device); err == nil {
			listener.Close()
			t.Fatalf("invalid interface %q accepted", device)
		}
	}
}

func TestManagementListenerFailsClosed(t *testing.T) {
	if listener, err := managementListener("127.0.0.1:0", "no-such-iface"); err == nil {
		listener.Close()
		t.Fatal("nonexistent interface must not fall back to a normal listener")
	}
}
