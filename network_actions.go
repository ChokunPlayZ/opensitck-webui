package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
)

// NetworkManager profiles persist across reboots; ip route changes are explicitly
// temporary. Persistent routes are edited on the relevant connection profile.
var profileProperties = map[string]bool{
	"connection.id": true, "connection.autoconnect": true,
	"connection.autoconnect-priority": true, "connection.interface-name": true,
	"ipv4.method": true, "ipv4.addresses": true, "ipv4.gateway": true,
	"ipv4.dns": true, "ipv4.dns-search": true, "ipv4.ignore-auto-dns": true,
	"ipv4.routes": true, "ipv4.route-metric": true, "ipv4.never-default": true,
	"ipv4.may-fail": true, "ipv4.dhcp-client-id": true,
	"ipv6.method": true, "ipv6.addresses": true, "ipv6.gateway": true,
	"ipv6.dns": true, "ipv6.ignore-auto-dns": true, "ipv6.routes": true,
	"ipv6.route-metric": true, "ipv6.never-default": true,
	"802-11-wireless.ssid": true, "802-11-wireless.mode": true,
	"802-11-wireless.band": true, "802-11-wireless.channel": true,
	"802-11-wireless.hidden": true, "802-11-wireless.mtu": true,
	"802-11-wireless.cloned-mac-address": true,
	"802-11-wireless-security.key-mgmt":  true, "802-11-wireless-security.psk": true,
	"802-3-ethernet.mtu": true, "802-3-ethernet.cloned-mac-address": true,
	"gsm.apn": true, "gsm.username": true, "gsm.password": true,
	"gsm.auto-config": true, "gsm.home-only": true, "gsm.pin": true,
	"gsm.network-id": true, "gsm.number": true,
}

func networkAction(request actionRequest) ([]step, error) {
	p := request.Params
	switch request.Action {
	case "profile.reload":
		return []step{{Name: "nmcli", Args: []string{"connection", "reload"}}}, nil
	case "profile.up", "profile.down", "profile.delete":
		if !validUUID(p["uuid"]) {
			return nil, errors.New("a valid connection UUID is required")
		}
		verb := strings.TrimPrefix(request.Action, "profile.")
		change := step{Name: "nmcli", Args: []string{"--wait", "30", "connection", verb, "uuid", p["uuid"]}}
		switch verb {
		case "up":
			// Prefer only a successfully activated Wi-Fi profile at the next boot.
			return []step{change, wifiAutoconnectStep(p["uuid"], "", true)}, nil
		case "down":
			// Disable Wi-Fi autoconnect before disconnecting so it cannot race back.
			return []step{wifiAutoconnectStep(p["uuid"], "", false), change}, nil
		default:
			return []step{change}, nil
		}
	case "profile.save":
		if !validUUID(p["uuid"]) {
			return nil, errors.New("a valid connection UUID is required")
		}
		args := []string{"connection", "modify", "uuid", p["uuid"]}
		keys := []string{}
		for key := range p {
			if key == "uuid" {
				continue
			}
			if !profileProperties[key] {
				return nil, fmt.Errorf("unsupported profile property: %s", key)
			}
			keys = append(keys, key)
		}
		sort.Strings(keys)
		if len(keys) == 0 {
			return nil, errors.New("no profile properties supplied")
		}
		for _, key := range keys {
			args = append(args, key, p[key])
		}
		return []step{{Name: "nmcli", Args: args}}, nil
	case "profile.create":
		if err := require(p["name"], "Connection name"); err != nil {
			return nil, err
		}
		if !validInterface(p["interface"]) {
			return nil, errors.New("invalid interface name")
		}
		if !choice(p["type"], "ethernet", "wifi", "gsm", "bridge", "vlan") {
			return nil, errors.New("unsupported connection type")
		}
		args := []string{"connection", "add", "type", p["type"], "con-name", p["name"], "ifname", p["interface"]}
		if p["type"] == "wifi" {
			args = append(args, "ssid", p["ssid"])
		}
		if p["type"] == "gsm" {
			args = append(args, "apn", p["apn"])
		}
		if p["type"] == "vlan" {
			id, err := strconv.Atoi(p["vlan"])
			if err != nil || id < 1 || id > 4094 || !validInterface(p["parent"]) {
				return nil, errors.New("VLAN needs a parent interface and ID 1–4094")
			}
			args = append(args, "dev", p["parent"], "id", p["vlan"])
		}
		return []step{{Name: "nmcli", Args: args}}, nil
	case "wifi.scan":
		return []step{{Name: "nmcli", Args: []string{"device", "wifi", "rescan"}}}, nil
	case "wifi.radio":
		if !choice(p["state"], "on", "off") {
			return nil, errors.New("state must be on or off")
		}
		return []step{{Name: "nmcli", Args: []string{"radio", "wifi", p["state"]}}}, nil
	case "wifi.connect":
		if len(p["ssid"]) < 1 || len([]byte(p["ssid"])) > 32 {
			return nil, errors.New("SSID must be 1–32 bytes")
		}
		args := []string{"--wait", "35", "device", "wifi", "connect", p["ssid"]}
		if p["password"] != "" {
			args = append(args, "password", p["password"])
		}
		if p["interface"] != "" {
			if !validInterface(p["interface"]) {
				return nil, errors.New("invalid interface")
			}
			args = append(args, "ifname", p["interface"])
		}
		if p["hidden"] == "yes" {
			args = append(args, "hidden", "yes")
		}
		return []step{{Name: "nmcli", Args: args}, wifiAutoconnectStep("", p["interface"], true)}, nil
	case "wifi.hotspot":
		return hotspotAction(p)
	case "route.add", "route.delete":
		if p["destination"] != "default" {
			if _, _, err := net.ParseCIDR(p["destination"]); err != nil {
				return nil, errors.New("destination must be default or a CIDR network")
			}
		}
		args := []string{"route", strings.TrimPrefix(request.Action, "route."), p["destination"]}
		if p["gateway"] != "" {
			if net.ParseIP(p["gateway"]) == nil {
				return nil, errors.New("invalid gateway")
			}
			args = append(args, "via", p["gateway"])
		}
		if !validInterface(p["interface"]) {
			return nil, errors.New("invalid interface")
		}
		args = append(args, "dev", p["interface"])
		if p["metric"] != "" {
			if _, err := strconv.ParseUint(p["metric"], 10, 32); err != nil {
				return nil, errors.New("invalid metric")
			}
			args = append(args, "metric", p["metric"])
		}
		if p["ipv6"] == "yes" {
			args = append([]string{"-6"}, args...)
		}
		return []step{{Name: "ip", Args: args}}, nil
	case "forwarding":
		if !choice(p["value"], "0", "1") {
			return nil, errors.New("forwarding must be 0 or 1")
		}
		data := []byte("# Managed by OpenStick Console\nnet.ipv4.ip_forward=" + p["value"] + "\nnet.ipv6.conf.all.forwarding=" + p["value"] + "\n")
		if err := os.MkdirAll("/etc/sysctl.d", 0755); err != nil {
			return nil, err
		}
		if err := atomicWrite("/etc/sysctl.d/90-openstick-webui.conf", data, 0644); err != nil {
			return nil, err
		}
		return []step{{Name: "sysctl", Args: []string{"-p", "/etc/sysctl.d/90-openstick-webui.conf"}}}, nil
	}
	return nil, errUnknownAction
}
