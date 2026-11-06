package main

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBatteryReadOnlyTelemetry(t *testing.T) {
	directory := t.TempDir()
	for name, value := range map[string]string{
		"voltage_now": "4123000", "health": "Good", "status": "Discharging",
		"capacity": "94", "charge_full_design": "2100000", "energy_full_design": "7980000", "voltage_max_design": "4350000",
	} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(value+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	info := batteryStatus(directory)
	if !info.Available || info.Voltage == nil || *info.Voltage != 4.123 || *info.DesignCapacity != 2100 || *info.DesignMaxVoltage != 4.35 {
		t.Fatalf("wrong battery conversion: %+v", info)
	}
	if info.ChargingVerified || info.ChargeControlAvailable || info.UncalibratedCapacity == nil || *info.UncalibratedCapacity != 94 {
		t.Fatal("must not present an unvalidated capacity/charging claim")
	}
	if missing := batteryStatus(filepath.Join(directory, "missing")); missing.Available || missing.Voltage != nil {
		t.Fatal("missing data must not become a zero-voltage battery")
	}
	os.WriteFile(filepath.Join(directory, "voltage_now"), []byte("bad"), 0600)
	if batteryStatus(directory).Voltage != nil {
		t.Fatal("invalid voltage was accepted")
	}
}

func TestHardwareRequestValidation(t *testing.T) {
	valid := map[string]string{"screen_sleep_seconds": "60", "double_click_ms": "350", "single_click": "display.toggle", "double_click": "display.next_page"}
	if _, err := hardwareRequest(actionRequest{Action: "hardware.configure", Params: valid}); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{"screen_sleep_seconds": "-1", "double_click_ms": "900", "single_click": "reboot; rm -rf /", "double_click": "sh"} {
		params := map[string]string{}
		for k, v := range valid {
			params[k] = v
		}
		params[key] = value
		if _, err := hardwareRequest(actionRequest{Action: "hardware.configure", Params: params}); err == nil {
			t.Errorf("accepted invalid %s", key)
		}
	}
	for _, operation := range []string{"hook", "reboot", "wake;reboot", ""} {
		if _, err := hardwareRequest(actionRequest{Action: "hardware.screen", Params: map[string]string{"operation": operation}}); err == nil {
			t.Errorf("accepted invalid operation %q", operation)
		}
	}
}

func TestDeviceSocketProtocol(t *testing.T) {
	// Keep below the Unix socket pathname limit, including on macOS.
	directory, err := os.MkdirTemp("", "device-socket-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(directory)
	path := filepath.Join(directory, "s")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			done <- err
			return
		}
		defer connection.Close()
		var request map[string]any
		if err := json.NewDecoder(connection).Decode(&request); err != nil {
			done <- err
			return
		}
		if request["op"] != "status" {
			done <- context.Canceled
			return
		}
		done <- json.NewEncoder(connection).Encode(map[string]any{"ok": true, "state": map[string]any{"awake": false}})
	}()
	state, err := deviceRequestAt(context.Background(), path, map[string]any{"op": "status"})
	if err != nil || state["awake"] != false {
		t.Fatalf("bad daemon status: %v %v", state, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := deviceRequestAt(context.Background(), path+"missing", map[string]any{"op": "status"}); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatal("missing daemon must be an explicit error")
	}
}
