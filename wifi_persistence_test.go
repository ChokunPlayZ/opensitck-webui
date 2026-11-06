package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
)

const testWiFiUUID = "c45ef127-9d41-4c28-87fb-49ad65463d78"
const testOtherWiFiUUID = "6d73d069-b482-41ec-bbc2-f769089700cb"

type nmcliReply struct {
	args []string
	out  string
	err  error
}

func fakeNMCLI(t *testing.T, replies ...nmcliReply) nmcliCommand {
	t.Helper()
	index := 0
	t.Cleanup(func() {
		if index != len(replies) {
			t.Errorf("executed %d nmcli commands, want %d", index, len(replies))
		}
	})
	return func(ctx context.Context, args ...string) (string, error) {
		t.Helper()
		if index >= len(replies) {
			t.Fatalf("unexpected nmcli command: %v", args)
		}
		reply := replies[index]
		index++
		if !reflect.DeepEqual(args, reply.args) {
			t.Fatalf("nmcli command %d: got %v, want %v", index, args, reply.args)
		}
		if err := ctx.Err(); err != nil {
			return "", err
		}
		return reply.out, reply.err
	}
}

func wifiTypeQuery(uuid string) []string {
	return []string{"-g", "connection.type", "connection", "show", "uuid", uuid}
}

func TestWiFiAutoconnectPersistsExplicitChoice(t *testing.T) {
	for _, kind := range []string{"802-11-wireless", "wifi"} {
		for _, enabled := range []bool{true, false} {
			t.Run(kind+"/"+map[bool]string{true: "connect", false: "disconnect"}[enabled], func(t *testing.T) {
				args := []string{"connection", "modify", "uuid", testWiFiUUID, "connection.autoconnect", "no"}
				if enabled {
					args[5] = "yes"
					args = append(args, "connection.autoconnect-priority", "999")
				}
				nmcli := fakeNMCLI(t,
					nmcliReply{args: wifiTypeQuery(testWiFiUUID), out: kind + "\n"},
					nmcliReply{args: args},
				)
				var log bytes.Buffer
				if err := persistWiFiAutoconnect(context.Background(), &log, nmcli, testWiFiUUID, "", enabled); err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(log.String(), "after reboot") {
					t.Fatalf("missing persistence feedback: %s", log.String())
				}
			})
		}
	}
}

func TestWiFiAutoconnectPreservesOtherProfileTypes(t *testing.T) {
	for _, kind := range []string{"802-3-ethernet", "bridge", "gsm", "wireguard"} {
		for _, enabled := range []bool{true, false} {
			t.Run(kind+"/"+map[bool]string{true: "up", false: "down"}[enabled], func(t *testing.T) {
				nmcli := fakeNMCLI(t, nmcliReply{args: wifiTypeQuery(testWiFiUUID), out: kind + "\n"})
				if err := persistWiFiAutoconnect(context.Background(), io.Discard, nmcli, testWiFiUUID, "", enabled); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestWiFiAutoconnectResolvesOnlyTheSelectedRadio(t *testing.T) {
	query := []string{"-t", "-f", "UUID,TYPE,DEVICE", "connection", "show", "--active"}
	active := testOtherWiFiUUID + ":802-11-wireless:wlan1\n" + testWiFiUUID + ":802-11-wireless:wlan0\n"
	for _, iface := range []string{"wlan0", ""} {
		t.Run("interface="+iface, func(t *testing.T) {
			replies := []nmcliReply{{args: query, out: active}}
			if iface != "" {
				replies = append(replies,
					nmcliReply{args: wifiTypeQuery(testWiFiUUID), out: "802-11-wireless\n"},
					nmcliReply{args: []string{"connection", "modify", "uuid", testWiFiUUID, "connection.autoconnect", "yes", "connection.autoconnect-priority", "999"}},
				)
			}
			err := persistWiFiAutoconnect(context.Background(), io.Discard, fakeNMCLI(t, replies...), "", iface, true)
			if iface == "" {
				if err == nil || !strings.Contains(err.Error(), "multiple active Wi-Fi") {
					t.Fatalf("ambiguous radios must not modify any profile: %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestWiFiAutoconnectResolvesAnAutomaticallyChosenRadio(t *testing.T) {
	nmcli := fakeNMCLI(t,
		nmcliReply{args: []string{"-t", "-f", "UUID,TYPE,DEVICE", "connection", "show", "--active"}, out: testOtherWiFiUUID + ":bridge:br0\n" + testWiFiUUID + ":802-11-wireless:wlan0\n"},
		nmcliReply{args: wifiTypeQuery(testWiFiUUID), out: "802-11-wireless\n"},
		nmcliReply{args: []string{"connection", "modify", "uuid", testWiFiUUID, "connection.autoconnect", "yes", "connection.autoconnect-priority", "999"}},
	)
	if err := persistWiFiAutoconnect(context.Background(), io.Discard, nmcli, "", "", true); err != nil {
		t.Fatal(err)
	}
}

func TestWiFiAutoconnectMissingProfileAndReadFailures(t *testing.T) {
	for _, test := range []struct {
		name  string
		uuid  string
		reply []nmcliReply
	}{
		{name: "invalid UUID", uuid: "--help"},
		{name: "active query failure", reply: []nmcliReply{{args: []string{"-t", "-f", "UUID,TYPE,DEVICE", "connection", "show", "--active"}, err: errors.New("NetworkManager unavailable")}}},
		{name: "no active Wi-Fi", reply: []nmcliReply{{args: []string{"-t", "-f", "UUID,TYPE,DEVICE", "connection", "show", "--active"}, out: testOtherWiFiUUID + ":bridge:br0\n"}}},
		{name: "profile query failure", uuid: testWiFiUUID, reply: []nmcliReply{{args: wifiTypeQuery(testWiFiUUID), err: errors.New("profile disappeared")}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := persistWiFiAutoconnect(context.Background(), io.Discard, fakeNMCLI(t, test.reply...), test.uuid, "wlan0", true); err == nil {
				t.Fatal("must report failure without modifying an unrelated profile")
			}
		})
	}
}

func TestWiFiAutoconnectSaveFailureIsNotReportedAsSuccess(t *testing.T) {
	failure := errors.New("read-only filesystem")
	nmcli := fakeNMCLI(t,
		nmcliReply{args: wifiTypeQuery(testWiFiUUID), out: "802-11-wireless\n"},
		nmcliReply{args: []string{"connection", "modify", "uuid", testWiFiUUID, "connection.autoconnect", "yes", "connection.autoconnect-priority", "999"}, out: "Cannot save profile\n", err: failure},
	)
	var log bytes.Buffer
	err := persistWiFiAutoconnect(context.Background(), &log, nmcli, testWiFiUUID, "", true)
	if !errors.Is(err, failure) || strings.Contains(log.String(), "preferred after reboot") || !strings.Contains(log.String(), "Cannot save profile") {
		t.Fatalf("save error not surfaced correctly: %v, log %q", err, log.String())
	}
}

func TestWiFiPersistenceActionOrdering(t *testing.T) {
	for _, action := range []string{"profile.up", "profile.down", "profile.delete", "wifi.connect"} {
		t.Run(action, func(t *testing.T) {
			steps, err := networkAction(actionRequest{Action: action, Params: map[string]string{"uuid": testWiFiUUID, "ssid": "Client network", "interface": "wlan0"}})
			if err != nil {
				t.Fatal(err)
			}
			if action == "profile.delete" {
				if len(steps) != 1 || steps[0].Run != nil {
					t.Fatal("deleting a profile must not run boot-preference updates")
				}
				return
			}
			if len(steps) != 2 {
				t.Fatalf("expected activation/disconnection and persistence, got %d steps", len(steps))
			}
			persist, change := 1, 0
			if action == "profile.down" {
				persist, change = 0, 1
			}
			if steps[persist].Run == nil || steps[change].Name != "nmcli" || steps[change].Run != nil {
				t.Fatal("save preference after a successful connection, but before disconnection")
			}
		})
	}
}

func TestFailedHotspotActivationDoesNotSaveBootPreference(t *testing.T) {
	steps, err := hotspotSteps(map[string]string{"interface": "wlan0", "ssid": "Test", "password": "not-a-real-password"}, "br0", testWiFiUUID)
	if err != nil {
		t.Fatal(err)
	}
	// Exercise job short-circuiting without creating profiles or switching a radio.
	steps[0].Run = func(context.Context, io.Writer) error { return nil }
	steps[1].Run = func(context.Context, io.Writer) error { return errors.New("AP activation failed") }
	persisted := false
	steps[2].Run = func(context.Context, io.Writer) error { persisted = true; return nil }
	a, err := newApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, err := a.startJob("wifi.hotspot", steps)
	if err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	j := a.jobs[id]
	a.mu.Unlock()
	<-j.done
	if persisted || j.Status != "failed" {
		t.Fatal("failed hotspot must not replace the saved boot preference")
	}
}
