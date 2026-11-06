package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
)

// The MF800H already has a trusted LAN bridge with USB, dnsmasq and NAT.
// AP-mode Wi-Fi joins that bridge; Wi-Fi client and cellular never do. Keeping
// management sockets bound to br0 therefore allows both downlinks, not uplinks.
func hotspotLANBridge() (string, error) {
	if !strings.Contains(readText("/proc/device-tree/model"), "MF800H") {
		return "", nil
	}
	if _, err := os.Stat("/sys/class/net/br0/bridge"); err != nil {
		return "", errors.New("MF800H LAN bridge br0 is unavailable; refusing an isolated hotspot without management access")
	}
	bridge, err := net.InterfaceByName("br0")
	if err != nil {
		return "", err
	}
	addresses, err := bridge.Addrs()
	if err != nil {
		return "", err
	}
	for _, address := range addresses {
		ip, _, err := net.ParseCIDR(address.String())
		if err == nil && ip.Equal(net.ParseIP("192.168.100.1")) {
			return "br0", nil
		}
	}
	return "", errors.New("MF800H LAN bridge has no 192.168.100.1 management address")
}

func hotspotAction(p map[string]string) ([]step, error) {
	if !validInterface(p["interface"]) {
		return nil, errors.New("invalid wireless interface")
	}
	if len(p["ssid"]) < 1 || len([]byte(p["ssid"])) > 32 {
		return nil, errors.New("SSID must be 1–32 bytes")
	}
	if len(p["password"]) < 8 || len(p["password"]) > 63 {
		return nil, errors.New("WPA password must be 8–63 characters")
	}
	bridge, err := hotspotLANBridge()
	if err != nil {
		return nil, err
	}
	var id [16]byte
	_, _ = rand.Read(id[:])
	id[6], id[8] = id[6]&0x0f|0x40, id[8]&0x3f|0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
	return hotspotSteps(p, bridge, uuid)
}

func hotspotSteps(p map[string]string, bridge, uuid string) ([]step, error) {
	if bridge == "" {
		// Preserve the legacy standalone/shared-AP behaviour on other devices.
		args := []string{"--wait", "30", "device", "wifi", "hotspot", "ifname", p["interface"], "con-name", "openstick-webui-ap", "ssid", p["ssid"], "password", p["password"]}
		if choice(p["band"], "bg", "a") {
			args = append(args, "band", p["band"])
		}
		return []step{{Name: "nmcli", Args: args}, wifiAutoconnectStep("", p["interface"], true)}, nil
	}
	if !validInterface(bridge) || bridge == p["interface"] || !validUUID(uuid) {
		return nil, errors.New("invalid hotspot LAN bridge or profile identity")
	}
	// Add a new UUID rather than modifying/deleting an unfamiliar saved profile.
	// Do not give the Wi-Fi port its own IP/DHCP service: it inherits br0's LAN.
	// Keep it inactive until explicitly started; enable autoconnect only after
	// successful activation, so incomplete/failed creations cannot take the radio.
	args := []string{"connection", "add", "type", "wifi", "ifname", p["interface"],
		"con-name", "openstick-webui-ap", "connection.uuid", uuid,
		"connection.master", bridge, "connection.slave-type", "bridge", "ssid", p["ssid"],
		"802-11-wireless.mode", "ap", "802-11-wireless-security.key-mgmt", "wpa-psk",
		"802-11-wireless-security.psk", p["password"], "connection.autoconnect", "no"}
	if choice(p["band"], "bg", "a") {
		args = append(args, "802-11-wireless.band", p["band"])
	}
	return []step{
		{Name: "nmcli", Args: args},
		{Name: "nmcli", Args: []string{"--wait", "30", "connection", "up", "uuid", uuid}},
		wifiAutoconnectStep(uuid, p["interface"], true),
	}, nil
}
