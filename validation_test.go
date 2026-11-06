package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestNetworkManagerEscaping(t *testing.T) {
	for _, test := range []struct {
		input    string
		expected []string
	}{
		{`*:Office\:WiFi:80:WPA2:6`, []string{"*", "Office:WiFi", "80", "WPA2", "6"}},
		{`a\\b::x`, []string{`a\b`, "", "x"}},
		{`::`, []string{"", "", ""}},
	} {
		if result := splitNM(test.input); !reflect.DeepEqual(result, test.expected) {
			t.Errorf("parse %q: got %#v", test.input, result)
		}
	}
}

func TestPrivilegedArgumentValidation(t *testing.T) {
	for _, test := range []struct {
		name    string
		request actionRequest
		allowed bool
	}{
		{"invalid UUID", actionRequest{Action: "profile.up", Params: map[string]string{"uuid": "; reboot"}}, false},
		{"profile property allowlist", actionRequest{Action: "profile.save", Params: map[string]string{"uuid": "6d73d069-b482-41ec-bbc2-f769089700cb", "bogus.property": "x"}}, false},
		{"legitimate profile", actionRequest{Action: "profile.save", Params: map[string]string{"uuid": "6d73d069-b482-41ec-bbc2-f769089700cb", "gsm.apn": "internet"}}, true},
		{"invalid gateway", actionRequest{Action: "route.add", Params: map[string]string{"destination": "default", "gateway": "bad", "interface": "usb0"}}, false},
		{"legitimate route", actionRequest{Action: "route.add", Params: map[string]string{"destination": "10.0.0.0/8", "gateway": "192.168.5.2", "interface": "usb0"}}, true},
		{"short AP password", actionRequest{Action: "wifi.hotspot", Params: map[string]string{"ssid": "AP", "password": "short", "interface": "wlan0"}}, false},
		{"option injection interface", actionRequest{Action: "route.add", Params: map[string]string{"destination": "default", "interface": "usb0;reboot"}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := networkAction(test.request)
			if (err == nil) != test.allowed {
				t.Fatalf("allowed=%v error=%v", test.allowed, err)
			}
		})
	}
}

func TestModemValidation(t *testing.T) {
	for _, request := range []actionRequest{
		{Action: "sim.pin", Params: map[string]string{"sim": "0", "pin": "12"}},
		{Action: "sim.puk", Params: map[string]string{"sim": "0", "pin": "1234", "puk": "BAD"}},
		{Action: "sms.send", Params: map[string]string{"sms": "--help"}},
		{Action: "modem.connect", Params: map[string]string{"apn": "internet,user=foo"}},
		{Action: "modem.modes", Params: map[string]string{"allowed": "4g;reboot"}},
	} {
		if _, err := modemAction(request); err == nil {
			t.Errorf("accepted invalid request: %s", request.Action)
		}
	}
	steps, err := networkAction(actionRequest{Action: "wifi.connect", Params: map[string]string{"ssid": "$(reboot)", "password": "safe password"}})
	if err != nil {
		t.Fatal(err)
	}
	if steps[0].Name != "nmcli" || steps[0].Args[5] != "$(reboot)" {
		t.Fatal("SSID was not passed as a literal argument")
	}
}

func TestFirewallScope(t *testing.T) {
	if err := validateFirewallScope(defaultFirewall); err != nil {
		t.Fatal(err)
	}
	for _, config := range []string{"flush ruleset", "include \"/etc/nftables.conf\"", "table inet another {\n}\n", "destroy table inet openstick_webui\n", defaultFirewall + "flush ruleset\n", "table inet openstick_webui {\n"} {
		if validateFirewallScope(config) == nil {
			t.Errorf("accepted unsafe configuration: %s", config)
		}
	}
}

func TestFilePathProtections(t *testing.T) {
	for _, path := range []string{"/", "relative", "/proc/sys/kernel/hostname", "/dev/mmcblk0", "/sys/class/net", "/etc/shadow", "/var/lib/openstick-webui/auth.json"} {
		if _, err := safePath(path); err == nil {
			t.Errorf("accepted protected path %s", path)
		}
	}
	link := filepath.Join(t.TempDir(), "shadow")
	if err := os.Symlink("/etc/shadow", link); err != nil {
		t.Fatal(err)
	}
	if _, err := safePath(link); err == nil {
		t.Fatal("symlink bypass accepted")
	}
}

func TestBackupAllowlist(t *testing.T) {
	for _, path := range []string{"../etc/hosts", "/etc/hosts", "etc/../etc/shadow", "etc/NetworkManager/system-connections/../../shadow", "etc/shadow", "usr/local/bin/evil", "var/lib/openstick-webui/auth.json"} {
		if allowedBackupPath(path) {
			t.Errorf("accepted %q", path)
		}
	}
	if !allowedBackupPath("etc/wireguard/wg0.conf") {
		t.Fatal("legitimate WireGuard backup rejected")
	}
}

func TestRestoreRejectsTraversalAndSymlinks(t *testing.T) {
	application, _ := newApp(t.TempDir())
	for _, header := range []*tar.Header{
		{Name: "../escape", Typeflag: tar.TypeReg, Mode: 0600, Size: 1},
		{Name: "etc/hosts", Typeflag: tar.TypeSymlink, Linkname: "/etc/shadow", Mode: 0600},
	} {
		var buffer bytes.Buffer
		gz := gzip.NewWriter(&buffer)
		archive := tar.NewWriter(gz)
		archive.WriteHeader(header)
		if header.Typeflag == tar.TypeReg {
			archive.Write([]byte("x"))
		}
		archive.Close()
		gz.Close()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("POST", "/api/restore?confirm=yes", &buffer)
		application.restore(recorder, request)
		if recorder.Code != 400 {
			t.Fatalf("unsafe archive accepted: %s", recorder.Body.String())
		}
	}
}

func TestCappedOutput(t *testing.T) {
	buffer := cappedBuffer{limit: 10}
	buffer.Write([]byte("123456789"))
	buffer.Write([]byte("ABCDE"))
	if got := buffer.String(); got != "56789ABCDE" {
		t.Fatalf("unexpected output %q", got)
	}
}

func TestActionRequiresConfirmation(t *testing.T) {
	application, _ := newApp(t.TempDir())
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/api/action", strings.NewReader(`{"action":"system.reboot","params":{}}`))
	application.action(recorder, request)
	if recorder.Code != 400 {
		t.Fatal("unconfirmed mutation accepted")
	}
}
