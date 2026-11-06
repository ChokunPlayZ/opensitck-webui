package main

import (
	"context"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestHotspotLANPlan(t *testing.T) {
	p := map[string]string{"interface": "wlan0", "ssid": "Test AP", "password": "not-a-real-password", "band": "bg"}
	id := "c45ef127-9d41-4c28-87fb-49ad65463d78"
	steps, err := hotspotSteps(p, "br0", id)
	if err != nil || len(steps) != 3 {
		t.Fatalf("bad bridged AP plan: %v %v", steps, err)
	}
	joined := strings.Join(steps[0].Args, " ")
	for _, required := range []string{"connection.master br0 connection.slave-type bridge", "802-11-wireless.mode ap", "802-11-wireless-security.key-mgmt wpa-psk", "connection.autoconnect no", "connection.uuid " + id} {
		if !strings.Contains(joined, required) {
			t.Errorf("bridged AP plan missing %q", required)
		}
	}
	if strings.Contains(joined, "ipv4.method") || strings.Contains(joined, " delete ") || strings.Contains(joined, " modify ") {
		t.Fatal("AP must inherit LAN addressing without changing existing profiles")
	}
	if !reflect.DeepEqual(steps[1].Args, []string{"--wait", "30", "connection", "up", "uuid", id}) {
		t.Fatal("must activate the exact newly created profile UUID")
	}
	if steps[2].Run == nil {
		t.Fatal("must persist the hotspot boot preference after successful activation")
	}
}

func TestHotspotLegacyPlan(t *testing.T) {
	steps, err := hotspotSteps(map[string]string{"interface": "wlan0", "ssid": "AP", "password": "testpass123", "band": "bg"}, "", "")
	if err != nil || len(steps) != 2 || !strings.Contains(strings.Join(steps[0].Args, " "), "device wifi hotspot") || steps[1].Run == nil {
		t.Fatal("other devices must retain their standalone AP behaviour")
	}
}

func TestHotspotRejectsUnsafeBridge(t *testing.T) {
	p := map[string]string{"interface": "wlan0"}
	for _, bridge := range []string{"-bad", "br0;reboot", "wlan0"} {
		if _, err := hotspotSteps(p, bridge, "c45ef127-9d41-4c28-87fb-49ad65463d78"); err == nil {
			t.Fatalf("unsafe bridge %q accepted", bridge)
		}
	}
}

// Opt-in on the MF800H: create/inspect/delete only our own inactive profile.
// This validates the real NetworkManager command without switching the radio.
func TestHotspotLANNetworkManager(t *testing.T) {
	if os.Getenv("OPENSTICK_LIVE_HOTSPOT_PLAN_TEST") != "1" {
		t.Skip("opt-in real-device inactive profile test")
	}
	if !strings.Contains(readText("/proc/device-tree/model"), "MF800H") {
		t.Fatal("live hotspot plan test is specific to MF800H")
	}
	steps, err := hotspotAction(map[string]string{"interface": "wlan0", "ssid": "OpenStick-inactive-test", "password": "not-a-real-password", "band": "bg"})
	if err != nil || len(steps) != 3 {
		t.Fatalf("expected MF800H bridged plan: %v", err)
	}
	id := steps[1].Args[len(steps[1].Args)-1]
	if !validUUID(id) {
		t.Fatal("invalid test profile identity")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if output, err := command(ctx, "", steps[0].Name, steps[0].Args...); err != nil {
		t.Fatalf("NetworkManager rejected bridged AP plan: %s %v", output, err)
	}
	defer func() {
		if output, err := run("nmcli", "connection", "delete", "uuid", id); err != nil {
			t.Errorf("failed to remove our own temporary profile %s: %s %v", id, output, err)
		}
	}()
	output, err := run("nmcli", "-g", "connection.master,connection.slave-type,802-11-wireless.mode,connection.autoconnect", "connection", "show", "uuid", id)
	if err != nil {
		t.Fatalf("cannot inspect temporary profile: %s %v", output, err)
	}
	fields := cleanLines(output)
	if len(fields) != 4 || fields[1] != "bridge" || fields[2] != "ap" || fields[3] != "no" {
		t.Fatalf("wrong AP/LAN role: %q", output)
	}
	if fields[0] != "br0" {
		t.Fatalf("not attached to the management LAN: %q", fields[0])
	}
}
