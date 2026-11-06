package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
)

type nmcliCommand func(context.Context, ...string) (string, error)

// Run inside the serialized mutation job, not while planning the action: the
// connection created by wifi.connect/hotspot does not exist until activation.
func wifiAutoconnectStep(uuid, iface string, enabled bool) step {
	return step{Name: "Save Wi-Fi boot preference", Run: func(ctx context.Context, w io.Writer) error {
		return persistWiFiAutoconnect(ctx, w, func(ctx context.Context, args ...string) (string, error) {
			return command(ctx, "", "nmcli", args...)
		}, uuid, iface, enabled)
	}}
}

func persistWiFiAutoconnect(ctx context.Context, w io.Writer, nmcli nmcliCommand, uuid, iface string, enabled bool) error {
	if uuid == "" {
		// nmcli device wifi connect may choose the interface itself. Resolve the
		// actual active profile rather than guessing from a non-unique SSID/name.
		out, err := nmcli(ctx, "-t", "-f", "UUID,TYPE,DEVICE", "connection", "show", "--active")
		if err != nil {
			return fmt.Errorf("read active Wi-Fi connection: %s: %w", strings.TrimSpace(out), err)
		}
		for _, row := range nmRows(out) {
			if len(row) != 3 || !validUUID(row[0]) || !choice(row[1], "802-11-wireless", "wifi") || iface != "" && row[2] != iface {
				continue
			}
			if uuid != "" {
				return errors.New("multiple active Wi-Fi connections; specify an interface to save its boot preference")
			}
			uuid = row[0]
		}
		if uuid == "" {
			return errors.New("no active Wi-Fi connection found to save its boot preference")
		}
	}
	if !validUUID(uuid) {
		return errors.New("a valid connection UUID is required")
	}
	out, err := nmcli(ctx, "-g", "connection.type", "connection", "show", "uuid", uuid)
	if err != nil {
		return fmt.Errorf("read connection type: %s: %w", strings.TrimSpace(out), err)
	}
	if !choice(strings.TrimSpace(out), "802-11-wireless", "wifi") {
		// Generic profile controls must not alter USB, bridge or cellular boot policy.
		return nil
	}
	value := "no"
	if enabled {
		value = "yes"
	}
	args := []string{"connection", "modify", "uuid", uuid, "connection.autoconnect", value}
	if enabled {
		// NetworkManager's highest priority makes the user's explicit choice win
		// over default saved profiles. Among equal priorities NM chooses the most
		// recently activated profile, so switching back to client mode wins too.
		args = append(args, "connection.autoconnect-priority", "999")
	}
	out, err = nmcli(ctx, args...)
	fmt.Fprint(w, out)
	if err != nil {
		return fmt.Errorf("save Wi-Fi boot preference: %w", err)
	}
	if enabled {
		fmt.Fprintln(w, "Wi-Fi autoconnect enabled; this profile is preferred after reboot.")
	} else {
		fmt.Fprintln(w, "Wi-Fi autoconnect disabled; this profile will stay disconnected after reboot.")
	}
	return nil
}
