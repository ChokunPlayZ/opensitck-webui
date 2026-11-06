package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type sample struct {
	Time        int64   `json:"time"`
	CPU         float64 `json:"cpu"`
	Memory      float64 `json:"memory"`
	RX          float64 `json:"rx"`
	TX          float64 `json:"tx"`
	Temperature float64 `json:"temperature"`
}

func readText(path string) string {
	b, _ := os.ReadFile(path)
	return strings.TrimSpace(strings.ReplaceAll(string(b), "\x00", ""))
}
func number(s string) float64 { n, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return n }
func jsonOutput(name string, args ...string) any {
	var v any
	json.Unmarshal([]byte(output(name, args...)), &v)
	return v
}
func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}
func asList(v any) []any       { a, _ := v.([]any); return a }
func stringValue(v any) string { s, _ := v.(string); return s }
func nested(v any, keys ...string) any {
	for _, key := range keys {
		v = asMap(v)[key]
	}
	return v
}
func cleanLines(s string) []string {
	lines := []string{}
	for _, line := range strings.Split(s, "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, strings.TrimSpace(line))
		}
	}
	return lines
}

func (a *app) monitor(ctx context.Context) {
	a.collect()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.collect()
		}
	}
}
func (a *app) collect() {
	now := time.Now()
	s := sample{Time: now.Unix()}
	memory := map[string]float64{}
	for _, line := range strings.Split(readText("/proc/meminfo"), "\n") {
		f := strings.Fields(line)
		if len(f) > 1 {
			memory[strings.TrimSuffix(f[0], ":")] = number(f[1]) * 1024
		}
	}
	if memory["MemTotal"] > 0 {
		s.Memory = 100 * (1 - memory["MemAvailable"]/memory["MemTotal"])
	}
	stat := strings.Split(readText("/proc/stat"), "\n")
	cpu := []uint64{}
	if len(stat) > 0 {
		f := strings.Fields(stat[0])
		for _, field := range f[1:] {
			n, _ := strconv.ParseUint(field, 10, 64)
			cpu = append(cpu, n)
		}
	}
	if len(cpu) >= 8 && len(a.lastCPU) >= 8 {
		var total, idle uint64
		for i := 0; i < 8; i++ {
			d := cpu[i] - a.lastCPU[i]
			total += d
			if i == 3 || i == 4 {
				idle += d
			}
		}
		if total > 0 {
			s.CPU = 100 * float64(total-idle) / float64(total)
		}
	}
	a.lastCPU = cpu
	interfaces := map[string]map[string]any{}
	elapsed := now.Sub(a.lastSample).Seconds()
	for _, line := range strings.Split(readText("/proc/net/dev"), "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		f := strings.Fields(parts[1])
		if len(f) < 16 {
			continue
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[8], 10, 64)
		var r, t float64
		if prev, ok := a.lastNet[name]; ok && elapsed > 0 && rx >= prev[0] && tx >= prev[1] {
			r = float64(rx-prev[0]) / elapsed
			t = float64(tx-prev[1]) / elapsed
		}
		a.lastNet[name] = [2]uint64{rx, tx}
		interfaces[name] = map[string]any{"rx": rx, "tx": tx, "rxRate": r, "txRate": t}
		if name != "lo" && name != "usb0" && name != "usb1" {
			s.RX += r
			s.TX += t
		}
	}
	a.lastSample = now
	thermal, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	for _, p := range thermal {
		v := number(readText(p)) / 1000
		if v > s.Temperature {
			s.Temperature = v
		}
	}
	var disk syscall.Statfs_t
	syscall.Statfs("/", &disk)
	uptime := strings.Fields(readText("/proc/uptime"))
	var up float64
	if len(uptime) > 0 {
		up = number(uptime[0])
	}
	info := map[string]any{"hostname": readText("/etc/hostname"), "model": readText("/proc/device-tree/model"), "kernel": readText("/proc/sys/kernel/osrelease"), "os": readText("/etc/os-release"), "uptime": up, "load": strings.Fields(readText("/proc/loadavg")), "memory": memory, "disk": map[string]any{"total": disk.Blocks * uint64(disk.Bsize), "available": disk.Bavail * uint64(disk.Bsize), "free": disk.Bfree * uint64(disk.Bsize)}, "interfaces": interfaces, "sample": s, "version": version, "time": now.Format(time.RFC3339)}
	a.mu.Lock()
	a.latest = info
	a.samples = append(a.samples, s)
	if len(a.samples) > 120 {
		a.samples = a.samples[len(a.samples)-120:]
	}
	a.mu.Unlock()
}

func capabilities() map[string]bool {
	m := map[string]bool{}
	for _, name := range []string{"nmcli", "mmcli", "wg", "wg-quick", "nft", "iptables", "apt-get", "journalctl", "systemctl", "ping", "traceroute", "tcpdump", "hostapd", "dnsmasq"} {
		m[name] = available(name)
	}
	return m
}

// nmcli uses backslash escaping for colons and backslashes in terse output.
func splitNM(line string) []string {
	fields := []string{}
	var b strings.Builder
	escaped := false
	for _, r := range line {
		if escaped {
			b.WriteRune(r)
			escaped = false
		} else if r == '\\' {
			escaped = true
		} else if r == ':' {
			fields = append(fields, b.String())
			b.Reset()
		} else {
			b.WriteRune(r)
		}
	}
	if escaped {
		b.WriteByte('\\')
	}
	return append(fields, b.String())
}
func nmRows(s string) [][]string {
	rows := [][]string{}
	for _, l := range cleanLines(s) {
		rows = append(rows, splitNM(l))
	}
	return rows
}

func networkData() map[string]any {
	bridge, bridgeError := hotspotLANBridge()
	managementURL := ""
	if bridge != "" {
		managementURL = "https://192.168.100.1"
	}
	profiles := []map[string]any{}
	for _, f := range nmRows(output("nmcli", "-t", "-f", "NAME,UUID,TYPE,DEVICE,AUTOCONNECT", "connection", "show")) {
		if len(f) >= 5 {
			profiles = append(profiles, map[string]any{"name": f[0], "uuid": f[1], "type": f[2], "device": f[3], "autoconnect": f[4]})
		}
	}
	return map[string]any{"hotspotBridge": bridge, "hotspotBridgeError": errorString(bridgeError), "managementURL": managementURL, "interfaces": jsonOutput("ip", "-s", "-j", "address"), "routes": jsonOutput("ip", "-j", "route", "show", "table", "all"), "routes6": jsonOutput("ip", "-6", "-j", "route"), "neighbors": jsonOutput("ip", "-j", "neigh"), "profiles": profiles, "devices": nmRows(output("nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device")), "wifi": nmRows(output("nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY,CHAN,FREQ,BSSID", "device", "wifi", "list", "--rescan", "no")), "radio": output("nmcli", "radio", "wifi"), "dns": readText("/etc/resolv.conf"), "forwarding": readText("/proc/sys/net/ipv4/ip_forward"), "leases": leaseData()}
}
func leaseData() []map[string]string {
	result := []map[string]string{}
	paths, _ := filepath.Glob("/var/lib/NetworkManager/*.leases")
	extra, _ := filepath.Glob("/var/lib/misc/dnsmasq*.leases")
	paths = append(paths, extra...)
	for _, path := range paths {
		for _, line := range cleanLines(readText(path)) {
			f := strings.Fields(line)
			if len(f) >= 4 {
				result = append(result, map[string]string{"expires": f[0], "mac": f[1], "ip": f[2], "hostname": f[3], "source": filepath.Base(path)})
			}
		}
	}
	return result
}
func modemData() map[string]any {
	list := jsonOutput("mmcli", "-L", "-J")
	result := map[string]any{"list": list, "modems": []any{}}
	modems := []any{}
	for _, v := range asList(asMap(list)["modem-list"]) {
		path := stringValue(v)
		if path == "" {
			continue
		}
		data := jsonOutput("mmcli", "-m", path, "-J")
		generic := nested(data, "modem", "generic")
		sim := stringValue(asMap(generic)["sim"])
		entry := map[string]any{"path": path, "data": data}
		if sim != "" && sim != "--" {
			entry["sim"] = jsonOutput("mmcli", "-i", sim, "-J")
		}
		entry["signal"] = jsonOutput("mmcli", "-m", path, "--signal-get", "-J")
		entry["sms"] = jsonOutput("mmcli", "-m", path, "--messaging-list-sms", "-J")
		modems = append(modems, entry)
	}
	result["modems"] = modems
	return result
}
